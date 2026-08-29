import { RecurringTransaction } from "../../models/RecurringTransaction.js";
import { Transaction } from "../../models/Transaction.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";

/**
 * Adds `monthsToAdd` calendar months to `date` (all in UTC, since dates coming out of Mongo
 * and off `new Date("YYYY-MM-DD")` literals are UTC-midnight), clamping the resulting day of
 * month to the last valid day of the target month.
 *
 * This avoids JS's native `Date.setMonth`/`setFullYear` overflow behavior: naively adding a
 * month to Jan 31 rolls over into March 3 (Feb only has 28/29 days), which would silently
 * corrupt a monthly recurring schedule pinned to the 31st over time. Instead this clamps to
 * Feb 28/29, matching how real-world subscription billing (Netflix, credit cards, etc.)
 * actually handles month-end anchors.
 */
function addMonthsClamped(date: Date, monthsToAdd: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonthIndex = month + monthsToAdd;

  // Day 0 of the month *after* the target month is the last day of the target month.
  const lastDayOfTargetMonth = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  const result = new Date(date);
  result.setUTCFullYear(year, targetMonthIndex, clampedDay);
  return result;
}

export function advanceNextDueDate(current: Date, frequency: string): Date {
  switch (frequency) {
    case "weekly": {
      const next = new Date(current);
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    }
    case "yearly":
      // +12 months, clamped, rather than a naive setFullYear - handles a Feb 29 anchor
      // rolling into a non-leap year (would otherwise become March 1).
      return addMonthsClamped(current, 12);
    case "monthly":
    case "custom":
    default:
      return addMonthsClamped(current, 1);
  }
}

export async function processDueRecurringTransactions(): Promise<void> {
  const now = new Date();
  // Only ACTIVE items are ever processed - paused/cancelled items are left completely
  // untouched (including their nextDueDate) even if it's long past-due.
  const dueItems = await RecurringTransaction.find({ status: "active", nextDueDate: { $lte: now } });

  for (const item of dueItems) {
    if (item.autoCreate) {
      // For SIP-linked items (linkedHoldingSymbol set), only the expense Transaction is
      // created here - never a HoldingLot. Actual unit purchase requires a real price and
      // gets reconciled later via CSV/manual import, so fabricating a lot here would invent
      // a purchase price/unit count that was never real.
      await Transaction.create({
        userId: item.userId,
        accountId: item.accountId,
        categoryId: item.categoryId,
        amount: item.type === "expense" ? -Math.abs(item.amount) : Math.abs(item.amount),
        date: item.nextDueDate,
        note: `Recurring: ${item.name}`,
        merchant: item.name,
        source: "manual",
        status: "confirmed",
      });
      // This is a real Transaction changing (an auto-created recurring bill/income),
      // just triggered by the scheduled recurringDue worker instead of an HTTP
      // handler — the dashboard cache is just as stale here as after any other
      // Transaction write, so it must be invalidated the same way.
      await invalidateDashboardCache(item.userId);
    }
    // For autoCreate:false items this is informational only - no Transaction is created,
    // but nextDueDate still advances so the "upcoming" view reflects the next occurrence.

    // Deliberately advances only ONE cycle per call, even if nextDueDate is several cycles
    // in the past (e.g. the app was down for months). A still-overdue item is picked up
    // again on the next run of this function (the hourly worker), so a long backlog is
    // caught up incrementally across runs rather than all at once in a single burst that
    // could otherwise create many Transactions in one shot. See recurring.test.ts's
    // "advances an item only ONE cycle per run" test for the asserted behavior.
    item.nextDueDate = advanceNextDueDate(item.nextDueDate, item.frequency);
    await item.save();
  }
}
