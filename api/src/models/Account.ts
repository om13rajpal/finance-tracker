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
});

export const Account = model("Account", accountSchema);
