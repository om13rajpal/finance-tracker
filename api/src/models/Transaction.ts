import { Schema, model } from "mongoose";

const transactionSchema = new Schema({
  userId: { type: String, required: true, index: true },
  accountId: { type: String, required: true },
  categoryId: { type: String, default: null },
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  note: { type: String, default: "" },
  merchant: { type: String, default: "" },
  source: {
    type: String,
    enum: ["manual", "csv_import", "email_parsed", "pdf_statement_parsed"],
    default: "manual",
  },
  status: { type: String, enum: ["confirmed", "pending_review"], default: "confirmed" },
  // Whether CREATING this transaction applied its `amount` as an incremental
  // delta to the linked account's `currentBalance` (via `applyBalanceDelta`).
  // True for the ordinary path (manual entry, CSV import, recurring items,
  // investment buy/sell, a plain confirmed pending transaction). False when a
  // pending transaction's confirm instead reconciled the balance directly:
  // either to a statement's closing balance (see `PendingTransaction.
  // balanceReconciledAtImport`) or to an email alert's own stated balance
  // (`emailBalance`), because in both of those cases this transaction's
  // effect on the balance was already captured by the reconciliation, not by
  // a delta. `transactions.routes.ts`'s DELETE and amount-PATCH handlers read
  // this to decide whether reversing/adjusting by `amount` is even correct:
  // doing it unconditionally moved a reconciled account's balance in the
  // WRONG direction, since there was never a delta there to undo.
  balanceDeltaApplied: { type: Boolean, default: true },
});

transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, categoryId: 1, date: -1 });
transactionSchema.index({ userId: 1, accountId: 1 });
// Covers `findLikelyDuplicate`'s exact query shape (userId + accountId +
// exact amount + a date range): that check now runs once per parsed row,
// so a statement with thousands of rows runs it thousands of times per
// upload; without this, each of those falls back to the broader
// {userId, accountId} index above and scans every transaction on the
// account instead of narrowing straight to the matching amount first.
transactionSchema.index({ userId: 1, accountId: 1, amount: 1, date: 1 });

export const Transaction = model("Transaction", transactionSchema);
