import { Transaction } from "../../models/Transaction.js";
import { RecurringTransaction } from "../../models/RecurringTransaction.js";
import { advanceNextDueDate } from "./recurring.service.js";

export type RecurringSuggestion = {
  /** Not a real id: nothing persists a suggestion. A stable string the
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
 * gap, `max(3 days, 30% of the median)`, loose enough to absorb a bill
 * landing on a weekend, a subscription's billing date drifting by a day or
 * two, or a statement being read on slightly different days each month,
 * without being so loose that genuinely unrelated repeat purchases (e.g.
 * two unrelated ad-hoc Amazon orders eleven days apart, then another
 * random one two months later) get called recurring.
 *
 * A median outside the three fixed bands (weekly/monthly/yearly) but still
 * internally consistent is reported as `"custom"`. This app's
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

type Occurrence = { accountId: string; merchant: string; amount: number; date: Date; categoryId: string | null };

/**
 * Tries to classify one already-grouped set of occurrences as a single
 * recurring pattern: same sign throughout, and a day-gap sequence
 * `classifyFrequency` accepts. Returns `null` when it doesn't qualify,
 * rather than guessing. Shared by both the whole-(account,merchant)-group
 * pass and the by-amount fallback below, so "what counts as recurring"
 * is defined in exactly one place.
 */
function classifyOccurrences(
  occurrences: Occurrence[]
): Omit<RecurringSuggestion, "key" | "merchant" | "accountId"> | null {
  if (occurrences.length < MIN_OCCURRENCES) return null;

  const allExpense = occurrences.every((o) => o.amount < 0);
  const allIncome = occurrences.every((o) => o.amount > 0);
  if (!allExpense && !allIncome) return null;

  const dates = occurrences.map((o) => o.date.getTime()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(Math.round((dates[i] - dates[i - 1]) / DAY_MS));
  }

  const classification = classifyFrequency(gaps);
  if (!classification) return null;

  const last = occurrences.reduce((latest, o) => (o.date > latest.date ? o : latest));
  const first = occurrences.reduce((earliest, o) => (o.date < earliest.date ? o : earliest));

  const categoryIds = new Set(occurrences.map((o) => o.categoryId).filter((c): c is string => c !== null));
  const suggestedCategoryId = categoryIds.size === 1 ? [...categoryIds][0] : null;

  return {
    type: allIncome ? "income" : "expense",
    amount: Math.abs(last.amount),
    frequency: classification.frequency,
    nextDueDate: advanceNextDueDate(last.date, classification.frequency).toISOString(),
    occurrenceCount: occurrences.length,
    firstSeen: first.date.toISOString(),
    lastSeen: last.date.toISOString(),
    categoryId: suggestedCategoryId,
  };
}

/**
 * Scans this user's CONFIRMED transaction history for (account, merchant)
 * pairs that repeat at a regular interval and aren't already tracked as a
 * `RecurringTransaction`, and proposes each as a suggestion. This app has
 * no automatic detection today; every `RecurringTransaction` is currently
 * hand-entered (see `recurring.routes.ts`), even though real statement data
 * routinely contains obvious, unnoticed patterns (a subscription billed
 * monthly at a fixed amount, a NEFT payment recurring at a similar amount,
 * quarterly bank interest).
 *
 * Grouped by `merchant` (expected to already be the cleaned label from
 * `cleanMerchantLabel` for statement/CSV-derived transactions, matching
 * against raw, ID-laden bank narration would never find a stable group at
 * all) + `accountId`, since the same subscription paid from two different
 * accounts is two separate, separately-trackable commitments, not one.
 *
 * Two-tier: a (account, merchant) group is tried WHOLE first (tolerates a
 * subscription's amount drifting over time, e.g. a price hike, since
 * `classifyOccurrences` doesn't require identical amounts). Only when the
 * whole group DOESN'T qualify (mixed debit/credit, or gaps too irregular)
 * does it get re-tried split by exact `amount`. This matters for real,
 * confirmed production data: a truncated merchant name (a bank's own
 * narration cut short, or a statement-parsing edge case) silently merges
 * economically unrelated things under one identical label — a genuine fixed
 * monthly subscription, one-off purchases of other amounts, and same-day
 * debit/credit pairs. Without the second pass, that one noisy name poisons
 * the whole group and a real, obvious pattern sitting right inside it (the
 * same amount, the same ~30-day gap, every time) never surfaces at all.
 *
 * Deliberately suggests, never auto-creates: turning a detected pattern
 * into a real `RecurringTransaction` (optionally with `autoCreate: true`,
 * which would start creating real future transactions on its own) is a
 * decision only the person should make. See `recurring.routes.ts`'s
 * `POST /` for the endpoint the frontend calls once they accept one.
 */
export async function detectRecurringSuggestions(userId: string): Promise<RecurringSuggestion[]> {
  const transactions = await Transaction.find({ userId, status: "confirmed" })
    .select("accountId merchant amount date categoryId")
    .sort({ date: 1 })
    .lean();

  const groups = new Map<string, Occurrence[]>();

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
    const merchant = occurrences[0].merchant;
    if (existingNames.has(merchant.toLowerCase())) continue;

    const whole = classifyOccurrences(occurrences);
    if (whole) {
      suggestions.push({ key, merchant, accountId: occurrences[occurrences.length - 1].accountId, ...whole });
      continue;
    }

    // Fallback: the whole group wasn't one coherent pattern. Re-partition by
    // exact amount (which also makes the amount itself constant, so
    // `classifyOccurrences`' sign check is automatically satisfied) and
    // evaluate each amount-subgroup independently. A merchant can genuinely
    // contain more than one real recurring commitment this way (e.g. two
    // different fixed charges both mislabeled with the same truncated
    // name), so every qualifying subgroup becomes its own suggestion.
    const byAmount = new Map<number, Occurrence[]>();
    for (const occ of occurrences) {
      const sub = byAmount.get(occ.amount) ?? [];
      sub.push(occ);
      byAmount.set(occ.amount, sub);
    }
    for (const [amount, subOccurrences] of byAmount) {
      const result = classifyOccurrences(subOccurrences);
      if (!result) continue;
      suggestions.push({
        key: `${key}::${amount}`,
        merchant,
        accountId: subOccurrences[subOccurrences.length - 1].accountId,
        ...result,
      });
    }
  }

  // Most-established pattern (most occurrences) first: the strongest
  // signal belongs at the top of whatever list the frontend renders.
  suggestions.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  return suggestions;
}
