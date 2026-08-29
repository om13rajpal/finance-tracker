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
