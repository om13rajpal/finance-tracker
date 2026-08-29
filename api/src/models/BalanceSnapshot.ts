import { Schema, model } from "mongoose";

const balanceSnapshotSchema = new Schema({
  accountId: { type: String, required: true, index: true },
  balance: { type: Number, required: true },
  date: { type: Date, default: Date.now },
});

balanceSnapshotSchema.index({ accountId: 1, date: -1 });

export const BalanceSnapshot = model("BalanceSnapshot", balanceSnapshotSchema);
