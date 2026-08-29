import { Schema, model } from "mongoose";

const slabConfigSchema = new Schema({
  financialYear: { type: String, required: true },
  regime: { type: String, enum: ["old", "new"], required: true },
  standardDeduction: { type: Number, required: true },
  slabs: [
    {
      upTo: { type: Number, default: null }, // null = no upper bound (top slab)
      rate: { type: Number, required: true }, // e.g. 0.05 = 5%
      _id: false,
    },
  ],
  section87ARebateLimit: { type: Number, required: true }, // taxable income at/below this = full rebate
  section87ARebateMaxTax: { type: Number, required: true }, // rebate caps at this tax amount
  section80CLimit: { type: Number, default: 150000 },
  capitalGains: {
    equity: {
      stcgHoldingDays: { type: Number, required: true }, // held <= this many days => STCG
      stcgRate: { type: Number, required: true },
      ltcgRate: { type: Number, required: true },
      ltcgExemptionLimit: { type: Number, default: 0 }, // LTCG up to this amount per FY is exempt
      _id: false,
    },
    debt: {
      stcgHoldingDays: { type: Number, required: true },
      stcgRate: { type: Number, default: null }, // null = taxed at slab rate, not a flat rate
      ltcgRate: { type: Number, default: null },
      ltcgExemptionLimit: { type: Number, default: 0 },
      _id: false,
    },
  },
});

slabConfigSchema.index({ financialYear: 1, regime: 1 }, { unique: true });

export const TaxSlabConfig = model("TaxSlabConfig", slabConfigSchema);
