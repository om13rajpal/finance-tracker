import { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

export const requireAuth: RequestHandler = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    (req as any).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
};
