import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { requestOtp, verifyOtp } from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";
import { User } from "../../models/User.js";

const otpRequestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 100 : 30 });

export const authRouter = Router();

const requestSchema = z.object({ email: z.string().email() });
authRouter.post("/otp/request", otpRequestLimiter, async (req, res, next) => {
  try {
    const { email } = requestSchema.parse(req.body);
    await requestOtp(email);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const verifySchema = z.object({ email: z.string().email(), code: z.string().length(6) });
authRouter.post("/otp/verify", otpRequestLimiter, async (req, res, next) => {
  try {
    const { email, code } = verifySchema.parse(req.body);
    const { token } = await verifyOtp(email, code);
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById((req as any).userId);
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json({ email: user.email });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("token");
  res.status(200).json({ ok: true });
});
