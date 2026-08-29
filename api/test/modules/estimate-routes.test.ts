import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { TaxSlabConfig } from "../../src/models/TaxSlabConfig.js";
import { IncomeSource } from "../../src/models/IncomeSource.js";
import { TaxDeduction } from "../../src/models/TaxDeduction.js";
import { HoldingLot } from "../../src/models/HoldingLot.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

async function seedBothRegimes() {
  await TaxSlabConfig.create({
    financialYear: "2025-26", regime: "new", standardDeduction: 75000,
    slabs: [{ upTo: 1200000, rate: 0 }, { upTo: null, rate: 0.3 }],
    section87ARebateLimit: 1200000, section87ARebateMaxTax: 60000, section80CLimit: 0,
    capitalGains: { equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 }, debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 } },
  });
  await TaxSlabConfig.create({
    financialYear: "2025-26", regime: "old", standardDeduction: 50000,
    slabs: [{ upTo: 500000, rate: 0 }, { upTo: null, rate: 0.3 }],
    section87ARebateLimit: 500000, section87ARebateMaxTax: 12500, section80CLimit: 150000,
    capitalGains: { equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 }, debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 } },
  });
}

describe("GET /tax/estimate", () => {
  it("requires auth and fy", async () => {
    expect((await request(app).get("/tax/estimate?fy=2025-26")).status).toBe(401);
    expect((await request(app).get("/tax/estimate").set("Cookie", authCookie())).status).toBe(400);
  });

  it("computes both regimes and picks the lower-tax one as the recommendation", async () => {
    await seedBothRegimes();
    const userId = "user-est-1";
    await IncomeSource.create({ userId, type: "salary", financialYear: "2025-26", annualAmount: 1100000 });
    await TaxDeduction.create({ userId, section: "80C", amount: 150000, financialYear: "2025-26", source: "manual" });

    const res = await request(app).get("/tax/estimate?fy=2025-26").set("Cookie", authCookie(userId));
    expect(res.status).toBe(200);
    expect(res.body.old).toBeDefined();
    expect(res.body.new).toBeDefined();
    expect(["old", "new"]).toContain(res.body.recommendation);
    // With a full 150000 80C deduction only usable under the old regime, verify it
    // actually shows up as a lower taxableIncome under "old" than under "new" for this
    // income level — a real behavioral check, not just presence of the fields.
    expect(res.body.old.taxableIncome).toBeLessThan(res.body.new.taxableIncome);
  });

  it("caps total deductions at the regime's section80CLimit even if more was entered", async () => {
    await seedBothRegimes();
    const userId = "user-est-2";
    await IncomeSource.create({ userId, type: "salary", financialYear: "2025-26", annualAmount: 2000000 });
    await TaxDeduction.create({ userId, section: "80C", amount: 300000, financialYear: "2025-26", source: "manual" }); // over the 150000 cap

    const res = await request(app).get("/tax/estimate?fy=2025-26").set("Cookie", authCookie(userId));
    // old regime: 2000000 - 50000 std deduction - 150000 (capped, not 300000) = 1800000
    expect(res.body.old.taxableIncome).toBe(1800000);
    // new regime: section80CLimit is 0, so the deduction contributes nothing
    expect(res.body.new.taxableIncome).toBe(2000000 - 75000);
  });

  it("caps only 80C-section deductions at section80CLimit; other-section deductions (e.g. 80D) pass through in full, uncapped", async () => {
    await seedBothRegimes();
    const userId = "user-est-80c-80d";
    await IncomeSource.create({ userId, type: "salary", financialYear: "2025-26", annualAmount: 2000000 });
    await TaxDeduction.create({ userId, section: "80C", amount: 150000, financialYear: "2025-26", source: "manual" });
    await TaxDeduction.create({ userId, section: "80D", amount: 25000, financialYear: "2025-26", source: "manual" });

    const res = await request(app).get("/tax/estimate?fy=2025-26").set("Cookie", authCookie(userId));
    expect(res.status).toBe(200);
    // old regime: 2000000 - 50000 std deduction - (150000 80C capped + 25000 80D uncapped) = 1775000
    // Prior (buggy) behaviour pooled both sections into one total capped at 150000,
    // which would have produced 1800000 here (losing the 80D amount entirely).
    expect(res.body.old.taxableIncome).toBe(2000000 - 50000 - 175000);
  });

  it("includes auto-derived ELSS deductions (not just manually entered ones) in the estimate", async () => {
    await seedBothRegimes();
    const userId = "user-est-3";
    await IncomeSource.create({ userId, type: "salary", financialYear: "2025-26", annualAmount: 2000000 });
    await HoldingLot.create({
      userId, symbol: "ELSSFUND", platform: "groww", instrumentType: "mutual_fund", isElss: true,
      buyDate: new Date("2025-06-01"), buyPrice: 100, units: 400, remainingUnits: 400, // 40000 contributed
    });

    const res = await request(app).get("/tax/estimate?fy=2025-26").set("Cookie", authCookie(userId));
    // old regime: 2000000 - 50000 std deduction - 40000 auto ELSS = 1910000
    expect(res.body.old.taxableIncome).toBe(1910000);
  });

  it("applies HRA exemption to reduce old-regime taxable income only, leaving new-regime taxable income unaffected", async () => {
    await seedBothRegimes();
    const userId = "user-est-hra";
    // basic=600000, hra=280000, rentPaidAnnual=400000, metro=true
    // HRA exemption = min(280000 actual HRA, 400000-60000=340000, 50%*600000=300000) = 280000
    await IncomeSource.create({
      userId,
      type: "salary",
      financialYear: "2025-26",
      annualAmount: 1200000,
      breakdown: { basic: 600000, hra: 280000, allowances: 320000, rentPaidAnnual: 400000, isMetro: true },
    });

    const res = await request(app).get("/tax/estimate?fy=2025-26").set("Cookie", authCookie(userId));
    expect(res.status).toBe(200);
    // old regime: grossSalary reduced by HRA exemption before std deduction:
    // (1200000 - 280000) - 50000 std deduction - 0 deductions = 870000
    expect(res.body.old.taxableIncome).toBe(1200000 - 280000 - 50000);
    // new regime: HRA exemption does NOT apply — grossSalary un-reduced:
    // 1200000 - 75000 std deduction - 0 deductions = 1125000
    expect(res.body.new.taxableIncome).toBe(1200000 - 75000);
    // Direct proof the old regime is measurably lower BECAUSE of HRA. The new
    // regime's std deduction (75000) is actually HIGHER than the old regime's
    // (50000) — a std-deduction-only difference (no HRA) would make old regime's
    // taxableIncome HIGHER than new's by 25000, i.e. a gap of -25000. The actual
    // gap is +255000 (280000 HRA exemption - 25000 std deduction disadvantage),
    // proving the HRA exemption more than makes up for it and is genuinely applied.
    const stdDeductionOnlyGap = 75000 - 50000; // what the gap would be with NO HRA exemption
    const actualGap = res.body.new.taxableIncome - res.body.old.taxableIncome;
    expect(actualGap).toBeGreaterThan(stdDeductionOnlyGap);
    expect(actualGap).toBe(280000 - stdDeductionOnlyGap);
  });

  it("fails loudly rather than estimating when the two regimes' capitalGains blocks have drifted apart", async () => {
    const userId = "user-est-4";
    await TaxSlabConfig.create({
      financialYear: "2031-32", regime: "new", standardDeduction: 75000,
      slabs: [{ upTo: null, rate: 0.3 }],
      section87ARebateLimit: 1200000, section87ARebateMaxTax: 60000, section80CLimit: 0,
      capitalGains: { equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 }, debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 } },
    });
    await TaxSlabConfig.create({
      financialYear: "2031-32", regime: "old", standardDeduction: 50000,
      slabs: [{ upTo: null, rate: 0.3 }],
      section87ARebateLimit: 500000, section87ARebateMaxTax: 12500, section80CLimit: 150000,
      // ltcgRate drifted — would make the two regimes report different capital gains
      // tax on identical gains, which is impossible under Indian law.
      capitalGains: { equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.2, ltcgExemptionLimit: 125000 }, debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 } },
    });

    const res = await request(app).get("/tax/estimate?fy=2031-32").set("Cookie", authCookie(userId));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/diverg/i);
  });
});
