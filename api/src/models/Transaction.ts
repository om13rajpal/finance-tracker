import { Schema, model } from "mongoose";

const transactionSchema = new Schema({
  userId: { type: String, required: true, index: true },
  accountId: { type: String, required: true },
  categoryId: { type: String, default: null },
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  note: { type: String, default: "" },
  merchant: { type: String, default: "" },
  source: { type: String, enum: ["manual", "csv_import", "email_parsed"], default: "manual" },
  status: { type: String, enum: ["confirmed", "pending_review"], default: "confirmed" },
});

transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, categoryId: 1, date: -1 });
transactionSchema.index({ userId: 1, accountId: 1 });

export const Transaction = model("Transaction", transactionSchema);
