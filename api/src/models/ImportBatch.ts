import { Schema, model } from "mongoose";

const rowResultSchema = new Schema(
  {
    row: { type: Number, required: true },
    status: { type: String, enum: ["success", "failed"], required: true },
    reason: { type: String },
    transactionId: { type: String },
  },
  { _id: false }
);

const importBatchSchema = new Schema({
  userId: { type: String, required: true, index: true },
  source: { type: String, enum: ["zerodha_csv", "groww_csv", "bank_statement"], required: true },
  filename: { type: String, required: true },
  importedAt: { type: Date, default: Date.now },
  rowResults: { type: [rowResultSchema], default: [] },
  resultingIds: { type: [String], default: [] },
});

export const ImportBatch = model("ImportBatch", importBatchSchema);
