import { Schema, model } from "mongoose";

const taxDeductionSchema = new Schema({
  userId: { type: String, required: true, index: true },
  section: { type: String, required: true }, // "80C", "80D", etc. — free text, not a closed enum, since sections vary
  amount: { type: Number, required: true },
  financialYear: { type: String, required: true },
  source: { type: String, enum: ["auto_ppf", "auto_elss", "manual"], required: true },
});

export const TaxDeduction = model("TaxDeduction", taxDeductionSchema);
