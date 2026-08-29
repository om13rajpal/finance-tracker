import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("/tax/slab-config", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/tax/slab-config")).status).toBe(401);
  });

  it("creates a config and lists it", async () => {
    const cookie = authCookie();
    const createRes = await request(app)
      .post("/tax/slab-config")
      .set("Cookie", cookie)
      .send({
        financialYear: "2026-27", regime: "new", standardDeduction: 75000,
        slabs: [{ upTo: null, rate: 0.3 }],
        section87ARebateLimit: 1200000, section87ARebateMaxTax: 60000, section80CLimit: 0,
        capitalGains: { equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 }, debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 } },
      });
    expect(createRes.status).toBe(201);

    const listRes = await request(app).get("/tax/slab-config").set("Cookie", cookie);
    expect(listRes.body.some((c: { financialYear: string; regime: string }) => c.financialYear === "2026-27" && c.regime === "new")).toBe(true);
  });

  it("upserts rather than duplicating on the same financialYear+regime", async () => {
    const cookie = authCookie();
    const payload = {
      financialYear: "2026-27", regime: "old", standardDeduction: 50000,
      slabs: [{ upTo: null, rate: 0.3 }],
      section87ARebateLimit: 500000, section87ARebateMaxTax: 12500, section80CLimit: 150000,
      capitalGains: { equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 }, debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 } },
    };
    await request(app).post("/tax/slab-config").set("Cookie", cookie).send(payload);
    await request(app).post("/tax/slab-config").set("Cookie", cookie).send({ ...payload, standardDeduction: 60000 });

    const listRes = await request(app).get("/tax/slab-config").set("Cookie", cookie);
    const matches = listRes.body.filter((c: { financialYear: string; regime: string }) => c.financialYear === "2026-27" && c.regime === "old");
    expect(matches).toHaveLength(1);
    expect(matches[0].standardDeduction).toBe(60000);
  });

  it("rejects a config that omits section80CLimit rather than silently defaulting it", async () => {
    // TaxSlabConfig's mongoose schema defaults section80CLimit to 150000. Omitting it
    // on a NEW-regime config would therefore silently grant Rs. 1,50,000 of deductions
    // the new regime does not allow, understating that regime's tax. Tax figures must
    // be entered explicitly, never inherited from a schema default.
    const res = await request(app)
      .post("/tax/slab-config")
      .set("Cookie", authCookie())
      .send({
        financialYear: "2027-28", regime: "new", standardDeduction: 75000,
        slabs: [{ upTo: null, rate: 0.3 }],
        section87ARebateLimit: 1200000, section87ARebateMaxTax: 60000,
        capitalGains: { equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 }, debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 } },
      });
    expect(res.status).toBe(400);
  });
});
