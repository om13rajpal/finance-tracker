import { Schema, model } from "mongoose";

const gmailConnectionSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  refreshTokenEncrypted: { type: String, default: null },
  watchExpiration: { type: Date, default: null },
  historyId: { type: String, default: null },
  connectedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["connected", "disconnected"], default: "disconnected" },
});

export const GmailConnection = model("GmailConnection", gmailConnectionSchema);
