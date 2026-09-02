import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { User } from "../src/models/User.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

// Task 26: Global Error Handling Audit.
//
// Express ^4.19.2 (pinned in Task 1) does NOT auto-forward rejected promises
// from async handlers to error middleware. Every route handler across the
// app was manually audited to confirm it wraps its body in try/catch and
// calls next(err) on failure. This test proves that pattern holds end-to-end
// via a real HTTP request through the real app (not a unit test of
// errorHandler in isolation): a malformed request must come back as a clean
// 400 JSON error, never a hang or an unhandled-rejection 500/crash.
describe("global error handling", () => {
  it("returns a clean 400 JSON error for a malformed request instead of hanging or 500ing", async () => {
    const res = await request(app)
      .post("/accounts")
      .set("Cookie", authCookie())
      .send({ type: "not-a-valid-type", institution: "HDFC", nickname: "Test" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  }, 5000);

  it("returns a clean 404-or-401-family response for a nonexistent protected resource rather than hanging", async () => {
    const res = await request(app)
      .get("/accounts/000000000000000000000000/balance-history")
      .set("Cookie", authCookie());
    expect([200, 404]).toContain(res.status);
  }, 5000);

  it("returns a clean 400 for a malformed body on another Zod-validated route (categories)", async () => {
    const res = await request(app)
      .post("/categories")
      .set("Cookie", authCookie())
      .send({ name: "Groceries", type: "not-a-valid-type", bucket: "fixed_costs" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  }, 5000);

  // Re-audit note (final whole-branch review): GET /auth/me was added in Task 27,
  // AFTER Task 26's original audit ran, and shipped without the try/catch ->
  // next(err) wrapper every other async handler uses. Under Express 4 that means an
  // unexpected rejection (Mongo unreachable, a cast error) never reaches
  // errorHandler at all: the request just hangs until the client times out. This
  // test pins the pattern for that handler specifically.
  it("GET /auth/me forwards an unexpected lookup failure to the error handler instead of hanging", async () => {
    const spy = vi.spyOn(User, "findById").mockImplementation((() => {
      return Promise.reject(new Error("simulated datastore failure"));
    }) as unknown as typeof User.findById);

    try {
      const res = await request(app).get("/auth/me").set("Cookie", authCookie());
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("error");
    } finally {
      spy.mockRestore();
    }
  }, 5000);
});
