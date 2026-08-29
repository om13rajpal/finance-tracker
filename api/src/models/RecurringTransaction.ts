import { Schema, model } from "mongoose";

const recurringTransactionSchema = new Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  type: { type: String, enum: ["expense", "income"], required: true },
  amount: { type: Number, required: true },
  frequency: { type: String, enum: ["monthly", "weekly", "yearly", "custom"], required: true },
  nextDueDate: { type: Date, required: true },
  accountId: { type: String, required: true },
  categoryId: { type: String, required: true },
  linkedHoldingSymbol: { type: String, default: null },
  autoCreate: { type: Boolean, default: false },
  status: { type: String, enum: ["active", "paused", "cancelled"], default: "active" },
});

recurringTransactionSchema.index({ userId: 1, nextDueDate: 1 });

export const RecurringTransaction = model("RecurringTransaction", recurringTransactionSchema);
