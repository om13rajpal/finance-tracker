import { Category } from "../../models/Category.js";
import { RecurringTransaction } from "../../models/RecurringTransaction.js";
import { Transaction } from "../../models/Transaction.js";
import { monthRangeUtc } from "./month-range.js";

export interface GuiltFreeResult {
  planned: number;
  spent: number;
  remaining: number;
}

/**
 * Guilt-free money (design spec's Guilt-Free Money section):
 *   planned  = Σ recurring income − Σ recurring `fixed_costs`/`investments`/`savings`
 *              bucket expenses
 *   spent    = Σ this month's actual `guilt_free`-bucket Transaction amounts
 *   remaining = planned − spent
 *
 * - Only `status: "active"` recurring items count toward "planned"; paused/cancelled
 *   items aren't part of the live plan.
 * - A recurring item counts as income purely off `item.type === "income"`, never off
 *   its category's `bucket`: an income category's bucket (if it has one at all) isn't
 *   meaningful for this calculation.
 * - "spent" is restricted to categories that are BOTH `bucket: "guilt_free"` AND
 *   `type: "expense"`. `bucket` is a required field on every `Category` document
 *   regardless of `type`, so an income category (e.g. "Salary") can technically carry
 *   `bucket: "guilt_free"` too (it has to hold *some* bucket value) without that being
 *   a real guilt-free spending category; the `type: "expense"` guard keeps such a
 *   category from ever being counted as spend.
 */
export async function computeGuiltFreeMoney(userId: string, month: string): Promise<GuiltFreeResult> {
  const categories = await Category.find({ userId }).lean();
  const bucketByCategoryId = new Map(categories.map((c) => [c._id.toString(), c.bucket]));

  const recurringItems = await RecurringTransaction.find({ userId, status: "active" }).lean();

  let income = 0;
  let fixedCosts = 0;
  let investments = 0;
  let savings = 0;

  for (const item of recurringItems) {
    if (item.type === "income") {
      income += item.amount;
      continue;
    }
    const bucket = bucketByCategoryId.get(item.categoryId);
    if (bucket === "fixed_costs") fixedCosts += item.amount;
    else if (bucket === "investments") investments += item.amount;
    else if (bucket === "savings") savings += item.amount;
  }

  const planned = income - fixedCosts - investments - savings;

  const guiltFreeCategoryIds = categories
    .filter((c) => c.bucket === "guilt_free" && c.type === "expense")
    .map((c) => c._id.toString());

  const { start, end } = monthRangeUtc(month);

  const guiltFreeTransactions = guiltFreeCategoryIds.length
    ? await Transaction.find({
        userId,
        categoryId: { $in: guiltFreeCategoryIds },
        date: { $gte: start, $lt: end },
        amount: { $lt: 0 },
      }).lean()
    : [];

  const spent = guiltFreeTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  return { planned, spent, remaining: planned - spent };
}
