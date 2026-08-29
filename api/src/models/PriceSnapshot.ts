import { Schema, model } from "mongoose";

const priceSnapshotSchema = new Schema({
  instrumentType: { type: String, enum: ["stock", "mutual_fund"], required: true },
  symbol: { type: String, required: true },
  price: { type: Number, required: true },
  fetchedAt: { type: Date, default: Date.now, required: true },
});

// The latest-price lookup always queries by symbol and sorts by fetchedAt descending.
priceSnapshotSchema.index({ symbol: 1, fetchedAt: -1 });

export const PriceSnapshot = model("PriceSnapshot", priceSnapshotSchema);
