import { Schema, model } from "mongoose";

/**
 * One row per {userId, category} of that month's total expense (absolute value).
 * `categoryId` is `null` for transactions with no category set — Task 10's
 * `Transaction.categoryId` is nullable (uncategorized transactions are allowed), and
 * that spend still needs to show up somewhere rather than silently vanishing from the
 * month's totals, so it gets its own row keyed by `null` instead of being dropped.
 */
const byCategorySchema = new Schema(
  {
    categoryId: { type: String, default: null },
    total: { type: Number, required: true },
  },
  { _id: false }
);

const monthlySummarySchema = new Schema({
  userId: { type: String, required: true },
  // "YYYY-MM", e.g. "2026-07".
  month: { type: String, required: true },
  totalIncome: { type: Number, required: true },
  totalExpense: { type: Number, required: true },
  byCategory: { type: [byCategorySchema], required: true, default: [] },
  netWorth: { type: Number, required: true },
});

// One summary per user per month — `rollupMonth` upserts against this, so re-running
// it for the same month (e.g. after a data correction) updates the existing document
// instead of erroring on a duplicate key or silently accumulating a second row.
monthlySummarySchema.index({ userId: 1, month: 1 }, { unique: true });

export const MonthlySummary = model("MonthlySummary", monthlySummarySchema);
