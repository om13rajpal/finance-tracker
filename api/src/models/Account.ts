import { Schema, model } from "mongoose";

const accountSchema = new Schema({
  userId: { type: String, required: true, index: true },
  type: { type: String, enum: ["bank", "credit_card", "ppf", "cash"], required: true },
  institution: { type: String, required: true },
  nickname: { type: String, required: true },
  currentBalance: { type: Number, required: true, default: 0 },
  isLiability: { type: Boolean, required: true, default: false },
  dueDate: { type: Date, default: null },
  lastUpdated: { type: Date, default: Date.now },
  // The real-world date this account's `currentBalance` is KNOWN ACCURATE as of:
  // distinct from `lastUpdated`, which just tracks when this document was last
  // written for any reason (including a plain per-transaction delta, which does NOT
  // touch this field). Only a reconciliation SET touches `balanceAsOf`: the manual
  // "update balance" button (always "now", see accounts.routes.ts) and
  // `reconcileBalance` (a statement's closing balance, or an email's embedded
  // "Avl Bal" figure), which uses it as a staleness guard so an older statement or
  // out-of-order email can never regress a more current figure. `null` until the
  // first such reconciliation ever happens.
  balanceAsOf: { type: Date, default: null },
});

export const Account = model("Account", accountSchema);
