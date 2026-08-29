import { Schema, model } from "mongoose";

const otpCodeSchema = new Schema({
  email: { type: String, required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

otpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpCode = model("OtpCode", otpCodeSchema);
