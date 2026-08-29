import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { requireAuth } from "../../src/modules/auth/auth.middleware.js";

describe("requireAuth middleware", () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get("/protected", requireAuth, (req, res) => {
    res.json({ userId: (req as unknown as { userId: string }).userId });
  });

  it("rejects requests with no cookie", async () => {
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
  });

  it("rejects requests with an invalid token", async () => {
    const res = await request(app).get("/protected").set("Cookie", "token=garbage");
    expect(res.status).toBe(401);
  });

  it("attaches userId for a valid token", async () => {
    const token = jwt.sign({ userId: "user-123" }, process.env.JWT_SECRET as string);
    const res = await request(app).get("/protected").set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user-123");
  });
});
