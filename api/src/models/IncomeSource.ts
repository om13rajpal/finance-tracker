import { Schema, model } from "mongoose";

const incomeSourceSchema = new Schema({
  userId: { type: String, required: true, index: true },
  type: { type: String, enum: ["salary", "other"], required: true },
  financialYear: { type: String, required: true },
  annualAmount: { type: Number, required: true },
  breakdown: {
    basic: { type: Number, default: null },
    hra: { type: Number, default: null },
    allowances: { type: Number, default: null },
    // Used only for the old-regime HRA exemption calculation (computeHraExemption
    // in tax-compute.service.ts) — never read by the new regime, which doesn't
    // allow the exemption at all. isMetro defaults to false (non-metro is the
    // lower-exemption, more conservative assumption when unspecified).
    rentPaidAnnual: { type: Number, default: null },
    isMetro: { type: Boolean, default: false },
    _id: false,
  },
});

export const IncomeSource = model("IncomeSource", incomeSourceSchema);
