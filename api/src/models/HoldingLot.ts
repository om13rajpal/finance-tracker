import { Schema, model } from "mongoose";

const holdingLotSchema = new Schema({
  userId: { type: String, required: true, index: true },
  symbol: { type: String, required: true },
  platform: { type: String, enum: ["zerodha", "groww", "other"], required: true },
  instrumentType: { type: String, enum: ["stock", "mutual_fund"], required: true },
  buyDate: { type: Date, required: true },
  buyPrice: { type: Number, required: true },
  units: { type: Number, required: true },
  remainingUnits: { type: Number, required: true },
  // Needed by Task 5's Section 80C deduction auto-population (ELSS lock-in /
  // auto-derived 80C contribution). Additive and optional — existing lots
  // default to false, no backfill required.
  isElss: { type: Boolean, default: false },
});

holdingLotSchema.index({ userId: 1, symbol: 1 });
// FIFO sell-matching always sorts by buyDate ascending within a user+symbol —
// index the sort key directly rather than relying on the broader index above.
holdingLotSchema.index({ userId: 1, symbol: 1, buyDate: 1 });

export const HoldingLot = model("HoldingLot", holdingLotSchema);
