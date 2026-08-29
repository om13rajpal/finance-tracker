import { Schema, model } from "mongoose";

const pendingTransactionSchema = new Schema({
  userId: { type: String, required: true, index: true },
  accountId: { type: String, default: null },
  categoryId: { type: String, default: null },
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  note: { type: String, default: "" },
  merchant: { type: String, default: "" },
  source: { type: String, enum: ["email_parsed"], default: "email_parsed" },
});

export const PendingTransaction = model("PendingTransaction", pendingTransactionSchema);
