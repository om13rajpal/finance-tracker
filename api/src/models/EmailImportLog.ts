import { Schema, model } from "mongoose";

const emailImportLogSchema = new Schema({
  userId: { type: String, required: true, index: true },
  emailId: { type: String, required: true, unique: true },
  sourceId: { type: String, default: null },
  parsedAt: { type: Date, default: Date.now },
  resultingPendingTransactionId: { type: String, default: null },
  parseStatus: { type: String, enum: ["success", "failed", "unmatched"], required: true },
});

export const EmailImportLog = model("EmailImportLog", emailImportLogSchema);
