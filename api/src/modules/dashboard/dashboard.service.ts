import { getCached, setCached, deleteCached } from "../../lib/cache.js";
import { Category } from "../../models/Category.js";
import { Transaction } from "../../models/Transaction.js";
import { computeFullNetWorth } from "./net-worth.service.js";
import { computeGuiltFreeMoney, GuiltFreeResult } from "./guilt-free.service.js";
import { monthRangeUtc } from "./month-range.js";

function cacheKey(userId: string): string {
  return `dashboard:${userId}`;
}

/**
 * Clears the cached dashboard aggregate for a user. Called by every mutation handler
 * that changes a Transaction, Account, or Holding: see the design spec's Caching &
 * Database Optimization section ("Computed aggregates ... invalidate-on-write when a
 * transaction/account/holding changes, not blind TTL, since stale numbers in a finance
 * app are actively misleading"). The full audited list of call sites is in
 * task-18-report.md.
 */
export async function invalidateDashboardCache(userId: string): Promise<void> {
  await deleteCached(cacheKey(userId));
}

export interface BudgetVsSpendRow {
  categoryId: string;
  name: string;
  budgetLimit: number;
  spent: number;
}

/**
 * Budget-vs-spend, one row per TOP-LEVEL expense category (`parentCategoryId` unset).
 * A transaction categorized under a CHILD (sub-)category rolls up into its parent's
 * `spent` total; sub-categories never get their own row here, matching the
 * per-top-level-category budget view.
 */
export async function computeBudgetVsSpend(userId: string, month: string): Promise<BudgetVsSpendRow[]> {
  const categories = await Category.find({ userId, type: "expense" }).lean();
  const topLevel = categories.filter((c) => !c.parentCategoryId);

  const childrenByParent = new Map<string, string[]>();
  for (const c of categories) {
    if (c.parentCategoryId) {
      const key = c.parentCategoryId.toString();
      childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), c._id.toString()]);
    }
  }

  const { start, end } = monthRangeUtc(month);

  const rows: BudgetVsSpendRow[] = [];
  for (const category of topLevel) {
    const categoryId = category._id.toString();
    const categoryIds = [categoryId, ...(childrenByParent.get(categoryId) ?? [])];

    const transactions = await Transaction.find({
      userId,
      categoryId: { $in: categoryIds },
      date: { $gte: start, $lt: end },
      amount: { $lt: 0 },
    }).lean();

    const spent = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    rows.push({ categoryId, name: category.name, budgetLimit: category.budgetLimit, spent });
  }

  return rows;
}

export interface DashboardResult {
  netWorth: number;
  guiltFreeMoney: GuiltFreeResult;
  budgetVsSpend: BudgetVsSpendRow[];
}

/**
 * Redis-cached with a 5-minute TTL as a safety net only: the primary freshness
 * mechanism is invalidate-on-write via `invalidateDashboardCache`, called from every
 * mutation handler that changes the underlying data. The TTL exists purely to bound
 * the damage of a missed invalidation call site, not as the main correctness
 * mechanism (per the design spec: stale numbers in a finance app are actively
 * misleading, so this must not rely on blind TTL alone).
 */
export async function getDashboard(userId: string): Promise<DashboardResult> {
  const key = cacheKey(userId);
  const cached = await getCached<DashboardResult>(key);
  if (cached) return cached;

  const month = new Date().toISOString().slice(0, 7);
  const [netWorth, guiltFreeMoney, budgetVsSpend] = await Promise.all([
    computeFullNetWorth(userId),
    computeGuiltFreeMoney(userId, month),
    computeBudgetVsSpend(userId, month),
  ]);

  const result: DashboardResult = { netWorth, guiltFreeMoney, budgetVsSpend };
  await setCached(key, result, 300);
  return result;
}
