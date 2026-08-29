import { Transaction } from "../../models/Transaction.js";
import { MonthlySummary } from "../../models/MonthlySummary.js";
import { computeFullNetWorth } from "./net-worth.service.js";
import { monthRangeUtc } from "./month-range.js";

interface TotalsRow {
  totalIncome: number;
  totalExpense: number;
}

interface ByCategoryRow {
  categoryId: string | null;
  total: number;
}

interface RollupAggregateResult {
  totals: TotalsRow[];
  byCategory: ByCategoryRow[];
}

/**
 * Aggregates one user's ENTIRE month of transactions into `{totalIncome, totalExpense,
 * byCategory}` in a single Mongoose aggregation pipeline that runs inside MongoDB,
 * rather than a `Transaction.find(...)` followed by a JS-side reduce/loop over every
 * document. The design spec's Caching & Database Optimization section calls out
 * `Transaction {userId, date}` as an existing index specifically so a month's worth of
 * transactions can be selected and summed server-side without pulling the full
 * (potentially large, unbounded-growth) transaction set across the wire into Node just
 * to add it up.
 *
 * `$facet` runs both branches against the same `$match`ed set in one round trip:
 *  - `totals`: a single group over ALL matched transactions, splitting by sign — a
 *    non-negative `amount` counts as income, negative counts as expense (absolute
 *    value), matching the sign convention established since Task 10 (see
 *    `recurring.service.ts`'s income/expense transaction creation).
 *  - `byCategory`: restricted to expense transactions (mirrors
 *    `computeBudgetVsSpend`/`computeGuiltFreeMoney`'s "categorized spend" rows — income
 *    isn't a "spend by category" concept), grouped by `categoryId` as-is. A `null`
 *    `categoryId` (Task 10 explicitly allows uncategorized transactions) groups under
 *    its own `null` row rather than crashing the aggregation or being dropped, so
 *    uncategorized spend still shows up in the month's totals.
 */
async function aggregateMonth(userId: string, month: string): Promise<RollupAggregateResult> {
  const { start, end } = monthRangeUtc(month);

  const [result] = await Transaction.aggregate<RollupAggregateResult>([
    { $match: { userId, date: { $gte: start, $lt: end } } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalIncome: { $sum: { $cond: [{ $gte: ["$amount", 0] }, "$amount", 0] } },
              totalExpense: { $sum: { $cond: [{ $lt: ["$amount", 0] }, { $abs: "$amount" }, 0] } },
            },
          },
        ],
        byCategory: [
          { $match: { amount: { $lt: 0 } } },
          { $group: { _id: "$categoryId", total: { $sum: { $abs: "$amount" } } } },
          { $project: { _id: 0, categoryId: "$_id", total: 1 } },
        ],
      },
    },
  ]);

  const totalsRow = result?.totals[0] ?? { totalIncome: 0, totalExpense: 0 };
  return {
    totals: [totalsRow],
    byCategory: result?.byCategory ?? [],
  };
}

/**
 * Rolls up a single completed month for one user into `MonthlySummary`: aggregate
 * totals via `aggregateMonth` above, plus net worth AS OF NOW (Task 18's
 * `computeFullNetWorth`) captured at rollup time — matching the design spec's rollup
 * shape (`userId, month, totalIncome, totalExpense, byCategory, netWorth`).
 *
 * Upserts on `{userId, month}` rather than inserting: this must be safe to call more
 * than once for the same month (e.g. a manual re-run after a data correction to a
 * transaction) — a second call updates the existing document's totals in place instead
 * of throwing on the unique `{userId, month}` index or silently duplicating the row.
 */
export async function rollupMonth(userId: string, month: string): Promise<void> {
  const { totals, byCategory } = await aggregateMonth(userId, month);
  const { totalIncome, totalExpense } = totals[0];
  const netWorth = await computeFullNetWorth(userId);

  await MonthlySummary.findOneAndUpdate(
    { userId, month },
    { $set: { totalIncome, totalExpense, byCategory, netWorth } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
