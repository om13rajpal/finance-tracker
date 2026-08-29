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
});

export const SellEvent = model("SellEvent", sellEventSchema);
