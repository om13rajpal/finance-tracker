import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { User } from "../../models/User.js";
import { OtpCode } from "../../models/OtpCode.js";
import { sendEmail } from "../../lib/resend.js";

export function hashOtp(code: string, email: string): string {
  return crypto.createHash("sha256").update(`${email}:${code}:${env.JWT_SECRET}`).digest("hex");
}

export async function requestOtp(email: string): Promise<void> {
  if (email !== env.ALLOWED_LOGIN_EMAIL) {
    const err = new Error("Email not allowed");
    (err as any).status = 403;
    throw err;
  }

  const code = crypto.randomInt(100000, 999999).toString();
  await OtpCode.deleteMany({ email });
  await OtpCode.create({
    email,
    codeHash: hashOtp(code, email),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  await sendEmail({
    to: email,
    subject: "Your Finance Tracker login code",
    text: `Your login code is ${code}. It expires in 10 minutes.`,
  });
}

export async function verifyOtp(email: string, code: string): Promise<{ token: string }> {
  const candidateHash = hashOtp(code, email);
  const record = await OtpCode.findOne({ email, codeHash: candidateHash }).sort({ _id: -1 });

  if (!record) {
    const err = new Error("Invalid or expired code");
    (err as any).status = 401;
    throw err;
  }

  await OtpCode.deleteOne({ _id: record._id });

  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({ email });
  }

  const token = jwt.sign({ userId: user._id.toString() }, env.JWT_SECRET, { expiresIn: "30d" });
  return { token };
}
