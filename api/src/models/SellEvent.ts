import { Schema, model } from "mongoose";

const sellEventSchema = new Schema({
  userId: { type: String, required: true, index: true },
  symbol: { type: String, required: true },
  lotId: { type: String, required: true },
  sellDate: { type: Date, required: true },
  buyDate: { type: Date, required: true },
  sellPrice: { type: Number, required: true },
  unitsSold: { type: Number, required: true }, // units from THIS lot, not the total sale
  costBasis: { type: Number, required: true },
  gainAmount: { type: Number, required: true },
  classification: { type: String, enum: ["STCG", "LTCG"], required: true },
  financialYear: { type: String, required: true },
  // True when this sale's STCG/LTCG classification used the built-in
  // statutory default (see `DEFAULT_EQUITY_CAPITAL_GAINS` in
  // tax-slab.service.ts) because no `TaxSlabConfig` existed for
  // `financialYear` at sell time, rather than a config someone explicitly
  // confirmed via POST /tax/slab-config. Worth surfacing wherever capital
  // gains are reported: the classification is very likely still correct
  // (the holding-period rule is stable law), but hasn't been confirmed.
  usedDefaultCapitalGainsConfig: { type: Boolean, default: false },
});

export const SellEvent = model("SellEvent", sellEventSchema);
