import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { OtpCode } from "../../src/models/OtpCode.js";

vi.mock("../../src/lib/resend.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

describe("auth OTP flow", () => {
  it("rejects OTP request for a non-allowed email", async () => {
    const res = await request(app).post("/auth/otp/request").send({ email: "stranger@example.com" });
    expect(res.status).toBe(403);
  });

  it("issues and verifies an OTP for the allowed email", async () => {
    const reqRes = await request(app).post("/auth/otp/request").send({ email: "test@example.com" });
    expect(reqRes.status).toBe(200);

    const stored = await OtpCode.findOne({ email: "test@example.com" });
    expect(stored).not.toBeNull();

    // The service stores a hash, not the raw code — verify via the raw code the route returns in test/dev mode is not exposed in prod,
    // so for this test we re-derive from the service's exported hashOtp() to simulate "the code the user received by email".
    // Since we can't recover the raw code from the hash, instead assert verify fails for a wrong code
    // and passes for the code captured via a stubbed sender (see next test).
    const wrongRes = await request(app).post("/auth/otp/verify").send({ email: "test@example.com", code: "000000" });
    expect(wrongRes.status).toBe(401);
  });

  it("verifies successfully with the code the sender was called with", async () => {
    const { sendEmail } = await import("../../src/lib/resend.js");
    await request(app).post("/auth/otp/request").send({ email: "test@example.com" });

    const sentBody = (sendEmail as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0].text as string;
    const code = sentBody.match(/\d{6}/)?.[0];
    expect(code).toBeTruthy();

    const verifyRes = await request(app).post("/auth/otp/verify").send({ email: "test@example.com", code });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.headers["set-cookie"]?.[0]).toMatch(/token=/);
  });

  it("invalidates prior OTP codes when a new one is requested", async () => {
    const { sendEmail } = await import("../../src/lib/resend.js");

    // Request first OTP
    await request(app).post("/auth/otp/request").send({ email: "test@example.com" });
    const firstCall = (sendEmail as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0].text as string;
    const firstCode = firstCall.match(/\d{6}/)?.[0];
    expect(firstCode).toBeTruthy();

    // Request second OTP for the same email
    await request(app).post("/auth/otp/request").send({ email: "test@example.com" });
    const secondCall = (sendEmail as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0].text as string;
    const secondCode = secondCall.match(/\d{6}/)?.[0];
    expect(secondCode).toBeTruthy();

    // First code should now be invalid
    const verifyFirstRes = await request(app).post("/auth/otp/verify").send({ email: "test@example.com", code: firstCode });
    expect(verifyFirstRes.status).toBe(401);

    // Second code should still be valid
    const verifySecondRes = await request(app).post("/auth/otp/verify").send({ email: "test@example.com", code: secondCode });
    expect(verifySecondRes.status).toBe(200);
  });
});

describe("GET /auth/me", () => {
  it("returns 401 when there is no session cookie", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid/garbage token", async () => {
    const res = await request(app).get("/auth/me").set("Cookie", "token=garbage");
    expect(res.status).toBe(401);
  });

  it("returns the authenticated user's email for a valid session", async () => {
    await request(app).post("/auth/otp/request").send({ email: "test@example.com" });
    const { sendEmail } = await import("../../src/lib/resend.js");
    const sentBody = (sendEmail as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0].text as string;
    const code = sentBody.match(/\d{6}/)?.[0];

    const verifyRes = await request(app).post("/auth/otp/verify").send({ email: "test@example.com", code });
    const cookie = verifyRes.headers["set-cookie"]?.[0] as string;
    expect(cookie).toMatch(/token=/);

    const meRes = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toEqual({ email: "test@example.com" });
  });
});
