import { Transaction } from "../../models/Transaction.js";
import { RecurringTransaction } from "../../models/RecurringTransaction.js";
import { advanceNextDueDate } from "./recurring.service.js";

export type RecurringSuggestion = {
  /** Not a real id — nothing persists a suggestion. A stable string the
   * frontend can use as a React `key` and echo back verbatim in the
   * "create from this suggestion" request. */
  key: string;
  merchant: string;
  accountId: string;
  type: "expense" | "income";
  amount: number;
  frequency: "weekly" | "monthly" | "yearly" | "custom";
  nextDueDate: string;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  /** Present only when every matched occurrence agreed on the same category. */
  categoryId: string | null;
};

const MIN_OCCURRENCES = 3;

/**
 * Classifies a sorted list of day-gaps between consecutive occurrences of the
 * same (account, merchant) pair as one of this app's recurring frequencies,
 * or `null` when the gaps aren't consistent enough to call "recurring" at
 * all (a merchant that happens to appear 3 times at wildly different
 * intervals is a coincidence, not a subscription).
 *
 * "Consistent" means every gap sits within a tolerance band of the median
 * gap — `max(3 days, 30% of the median)`, loose enough to absorb a bill
 * landing on a weekend, a subscription's billing date drifting by a day or
 * two, or a statement being read on slightly different days each month,
 * without being so loose that genuinely unrelated repeat purchases (e.g.
 * two unrelated ad-hoc Amazon orders eleven days apart, then another
 * random one two months later) get called recurring.
 *
 * A median outside the three fixed bands (weekly/monthly/yearly) but still
 * internally consistent is reported as `"custom"` — this app's
 * `RecurringTransaction.frequency` already has that enum value for exactly
 * this case (e.g. a genuinely bimonthly or 45-day biller), and `"custom"`
 * items advance by the calendar-month logic in `advanceNextDueDate` when
 * the person keeps it, same as today.
 */
function classifyFrequency(gaps: number[]): { frequency: RecurringSuggestion["frequency"]; medianGapDays: number } | null {
  if (gaps.length === 0) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return null;

  const tolerance = Math.max(3, median * 0.3);
  const consistent = gaps.every((gap) => Math.abs(gap - median) <= tolerance);
  if (!consistent) return null;

  if (median >= 5 && median <= 9) return { frequency: "weekly", medianGapDays: median };
  if (median >= 25 && median <= 35) return { frequency: "monthly", medianGapDays: median };
  if (median >= 350 && median <= 380) return { frequency: "yearly", medianGapDays: median };
  return { frequency: "custom", medianGapDays: median };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Scans this user's CONFIRMED transaction history for (account, merchant)
 * pairs that repeat at a regular interval and aren't already tracked as a
 * `RecurringTransaction`, and proposes each as a suggestion — this app has
 * no automatic detection today; every `RecurringTransaction` is currently
 * hand-entered (see `recurring.routes.ts`), even though real statement data
 * routinely contains obvious, unnoticed patterns (a subscription billed
 * monthly at a fixed amount, a NEFT payment recurring at a similar amount,
 * quarterly bank interest).
 *
 * Grouped by `merchant` (expected to already be the cleaned label from
 * `cleanMerchantLabel` for statement/CSV-derived transactions — matching
 * against raw, ID-laden bank narration would never find a stable group at
 * all) + `accountId`, since the same subscription paid from two different
 * accounts is two separate, separately-trackable commitments, not one.
 *
 * Deliberately suggests, never auto-creates: turning a detected pattern
 * into a real `RecurringTransaction` (optionally with `autoCreate: true`,
 * which would start creating real future transactions on its own) is a
 * decision only the person should make — see `recurring.routes.ts`'s
 * `POST /` for the endpoint the frontend calls once they accept one.
 */
export async function detectRecurringSuggestions(userId: string): Promise<RecurringSuggestion[]> {
  const transactions = await Transaction.find({ userId, status: "confirmed" })
    .select("accountId merchant amount date categoryId")
    .sort({ date: 1 })
    .lean();

  const groups = new Map<
    string,
    { accountId: string; merchant: string; amount: number; date: Date; categoryId: string | null }[]
  >();

  for (const tx of transactions) {
    const merchant = (tx.merchant ?? "").trim();
    if (!merchant) continue;
    const key = `${tx.accountId}::${merchant.toLowerCase()}`;
    const group = groups.get(key) ?? [];
    group.push({
      accountId: tx.accountId,
      merchant,
      amount: tx.amount,
      date: tx.date,
      categoryId: tx.categoryId ?? null,
    });
    groups.set(key, group);
  }

  const existingNames = new Set(
    (await RecurringTransaction.find({ userId, status: { $ne: "cancelled" } }).select("name").lean()).map((r) =>
      r.name.trim().toLowerCase()
    )
  );

  const suggestions: RecurringSuggestion[] = [];

  for (const [key, occurrences] of groups) {
    if (occurrences.length < MIN_OCCURRENCES) continue;

    const merchant = occurrences[0].merchant;
    if (existingNames.has(merchant.toLowerCase())) continue;

    // A merchant that's sometimes a debit and sometimes a credit on the same
    // account (a purchase AND its refund, say) isn't one coherent recurring
    // commitment — skip rather than guess which sign is "the real pattern".
    const allExpense = occurrences.every((o) => o.amount < 0);
    const allIncome = occurrences.every((o) => o.amount > 0);
    if (!allExpense && !allIncome) continue;

    const dates = occurrences.map((o) => o.date.getTime()).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(Math.round((dates[i] - dates[i - 1]) / DAY_MS));
    }

    const classification = classifyFrequency(gaps);
    if (!classification) continue;

    const last = occurrences.reduce((latest, o) => (o.date > latest.date ? o : latest));
    const first = occurrences.reduce((earliest, o) => (o.date < earliest.date ? o : earliest));

    const categoryIds = new Set(occurrences.map((o) => o.categoryId).filter((c): c is string => c !== null));
    const suggestedCategoryId = categoryIds.size === 1 ? [...categoryIds][0] : null;

    suggestions.push({
      key,
      merchant,
      accountId: last.accountId,
      type: allIncome ? "income" : "expense",
      amount: Math.abs(last.amount),
      frequency: classification.frequency,
      nextDueDate: advanceNextDueDate(last.date, classification.frequency).toISOString(),
      occurrenceCount: occurrences.length,
      firstSeen: first.date.toISOString(),
      lastSeen: last.date.toISOString(),
      categoryId: suggestedCategoryId,
    });
  }

  // Most-established pattern (most occurrences) first — the strongest
  // signal belongs at the top of whatever list the frontend renders.
  suggestions.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  return suggestions;
}
