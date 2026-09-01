import { Transaction } from "../../models/Transaction.js";

// The hydrated Transaction document type, derived from the model itself rather than
// written out by hand (or widened to `any`), so it tracks the schema automatically.
type TransactionDoc = InstanceType<typeof Transaction>;

const WINDOW_DAYS = 2;

export async function findLikelyDuplicate(
  userId: string,
  params: { accountId: string; amount: number; date: Date }
): Promise<TransactionDoc | null> {
  const windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const from = new Date(params.date.getTime() - windowMs);
  const to = new Date(params.date.getTime() + windowMs);

  return Transaction.findOne({
    userId,
    accountId: params.accountId,
    amount: params.amount,
    date: { $gte: from, $lte: to },
  });
}

/**
 * The same "is there already a confirmed Transaction with this exact amount,
 * on this account, within `WINDOW_DAYS` days" check `findLikelyDuplicate`
 * does, but for a whole batch of candidates in a bounded number of queries
 * instead of one query per candidate — one `Transaction.find` per DISTINCT
 * `accountId` among `items`, not per item. Built for `GET
 * /pending-transactions`, which needs to flag every row in the review queue
 * up front (so the person can see it before trying to confirm, not be
 * surprised by a 409 or a bulk-confirm skip after the fact) without turning
 * a queue of hundreds of rows into hundreds of round-trips.
 *
 * Returns a `Set` of the input array's INDEXES (not ids — callers may not
 * have a stable id, e.g. a not-yet-created row) that are likely duplicates.
 */
export async function findLikelyDuplicatesBatch(
  userId: string,
  items: { accountId: string; amount: number; date: Date }[]
): Promise<Set<number>> {
  const duplicateIndexes = new Set<number>();
  if (items.length === 0) return duplicateIndexes;

  const windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const accountIds = [...new Set(items.map((i) => i.accountId))];

  const byAccount = new Map<string, { amount: number; date: Date }[]>();
  for (const accountId of accountIds) {
    const itemsForAccount = items.filter((i) => i.accountId === accountId);
    const minDate = new Date(Math.min(...itemsForAccount.map((i) => i.date.getTime())) - windowMs);
    const maxDate = new Date(Math.max(...itemsForAccount.map((i) => i.date.getTime())) + windowMs);
    const confirmed = await Transaction.find({
      userId,
      accountId,
      date: { $gte: minDate, $lte: maxDate },
    })
      .select("amount date")
      .lean();
    byAccount.set(accountId, confirmed.map((c) => ({ amount: c.amount, date: c.date })));
  }

  items.forEach((item, index) => {
    const candidates = byAccount.get(item.accountId) ?? [];
    const isDuplicate = candidates.some(
      (c) => c.amount === item.amount && Math.abs(c.date.getTime() - item.date.getTime()) <= windowMs
    );
    if (isDuplicate) duplicateIndexes.add(index);
  });

  return duplicateIndexes;
}
