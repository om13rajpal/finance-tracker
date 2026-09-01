import { Schema, model } from "mongoose";

const balanceSnapshotSchema = new Schema({
  accountId: { type: String, required: true, index: true },
  balance: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  // Audit trail for WHY the balance changed, not just what it changed to — added
  // alongside the staleness-guarded reconciliation system (`balance.service.ts`).
  // Additive and all optional/defaulted: every snapshot created before this field
  // existed (and any future one from a code path that doesn't pass it) still reads
  // back fine as `source: "manual"` with everything else `null`.
  source: {
    type: String,
    enum: ["manual", "statement_closing_balance", "email_balance"],
    default: "manual",
  },
  previousBalance: { type: Number, default: null },
  delta: { type: Number, default: null },
  // The reconciliation source's own as-of date (a statement's last transaction
  // date, an email alert's transaction date, or "now" for a manual correction) —
  // NOT this snapshot's own `date` (when the write happened), which can lag well
  // behind it (e.g. an old email confirmed long after it arrived).
  asOf: { type: Date, default: null },
});

balanceSnapshotSchema.index({ accountId: 1, date: -1 });

export const BalanceSnapshot = model("BalanceSnapshot", balanceSnapshotSchema);
