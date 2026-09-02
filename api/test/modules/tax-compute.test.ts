import { describe, it, expect } from "vitest";
import { computeTax, computeHraExemption } from "../../src/modules/tax/tax-compute.service.js";

const newRegimeSlabConfig = {
  standardDeduction: 75000,
  slabs: [
    { upTo: 400000, rate: 0 },
    { upTo: 800000, rate: 0.05 },
    { upTo: 1200000, rate: 0.1 },
    { upTo: 1600000, rate: 0.15 },
    { upTo: 2000000, rate: 0.2 },
    { upTo: 2400000, rate: 0.25 },
    { upTo: null, rate: 0.3 },
  ],
  section87ARebateLimit: 1200000,
  section87ARebateMaxTax: 60000,
  section80CLimit: 0,
  capitalGains: {
    equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 },
    debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 },
  },
};

describe("computeTax: slab computation", () => {
  it("computes zero tax for income entirely within the 0% slab", () => {
    const result = computeTax({
      grossSalary: 400000, otherIncome: 0, stcgAmount: 0, ltcgAmount: 0,
      totalDeductions: 0, slabConfig: newRegimeSlabConfig,
    });
    // taxable = 400000 - 75000 standard deduction = 325000, entirely in the 0% slab (up to 400000)
    expect(result.taxableIncome).toBe(325000);
    expect(result.taxOnSlabIncome).toBe(0);
  });

  it("computes tax correctly across multiple slab boundaries (marginal rate application)", () => {
    const result = computeTax({
      grossSalary: 1500000, otherIncome: 0, stcgAmount: 0, ltcgAmount: 0,
      totalDeductions: 0, slabConfig: newRegimeSlabConfig,
    });
    // taxable = 1500000 - 75000 = 1425000
    // 0-400000: 0
    // 400000-800000 (400000 @ 5%): 20000
    // 800000-1200000 (400000 @ 10%): 40000
    // 1200000-1425000 (225000 @ 15%): 33750
    // total = 93750
    expect(result.taxableIncome).toBe(1425000);
    expect(result.taxOnSlabIncome).toBe(93750);
  });
});

describe("computeTax: Section 87A rebate", () => {
  it("applies full rebate (tax becomes zero) when taxable income is at the rebate limit", () => {
    const result = computeTax({
      grossSalary: 1275000, otherIncome: 0, stcgAmount: 0, ltcgAmount: 0, // taxable = 1200000 exactly
      totalDeductions: 0, slabConfig: newRegimeSlabConfig,
    });
    expect(result.taxableIncome).toBe(1200000);
    expect(result.rebateApplied).toBeGreaterThan(0);
    expect(result.totalTax).toBe(0);
  });

  it("does NOT apply the rebate when taxable income exceeds the rebate limit", () => {
    const result = computeTax({
      grossSalary: 1300000, otherIncome: 0, stcgAmount: 0, ltcgAmount: 0, // taxable = 1225000, over 1200000 limit
      totalDeductions: 0, slabConfig: newRegimeSlabConfig,
    });
    expect(result.taxableIncome).toBe(1225000);
    expect(result.rebateApplied).toBe(0);
    expect(result.totalTax).toBeGreaterThan(0);
  });
});

describe("computeTax: capital gains taxed separately from slab income", () => {
  it("LTCG above the exemption limit is taxed at the flat LTCG rate, not slab rates, and does not affect the slab computation", () => {
    const result = computeTax({
      grossSalary: 400000, otherIncome: 0, stcgAmount: 0, ltcgAmount: 225000, // 125000 exempt, 100000 taxable @ 12.5%
      totalDeductions: 0, slabConfig: newRegimeSlabConfig,
    });
    expect(result.taxOnCapitalGains).toBe(12500); // 100000 * 0.125
    // slab-income taxable amount must NOT include the LTCG: verify taxableIncome only reflects salary+other, not +capital gains
    expect(result.taxableIncome).toBe(325000); // 400000 - 75000 standard deduction, unaffected by LTCG
  });

  it("STCG is taxed at the flat STCG rate", () => {
    const result = computeTax({
      grossSalary: 400000, otherIncome: 0, stcgAmount: 50000, ltcgAmount: 0,
      totalDeductions: 0, slabConfig: newRegimeSlabConfig,
    });
    expect(result.taxOnCapitalGains).toBe(10000); // 50000 * 0.2
  });

  it("LTCG below the exemption limit produces zero capital gains tax", () => {
    const result = computeTax({
      grossSalary: 400000, otherIncome: 0, stcgAmount: 0, ltcgAmount: 100000, // under the 125000 exemption
      totalDeductions: 0, slabConfig: newRegimeSlabConfig,
    });
    expect(result.taxOnCapitalGains).toBe(0);
  });
});

describe("computeTax: deductions reduce taxable income but never below zero", () => {
  it("subtracts totalDeductions from taxable income", () => {
    const result = computeTax({
      grossSalary: 900000, otherIncome: 0, stcgAmount: 0, ltcgAmount: 0,
      totalDeductions: 150000, slabConfig: newRegimeSlabConfig,
    });
    // taxable = 900000 - 75000 - 150000 = 675000
    expect(result.taxableIncome).toBe(675000);
  });

  it("clamps taxable income at zero, never negative, if deductions exceed income", () => {
    const result = computeTax({
      grossSalary: 100000, otherIncome: 0, stcgAmount: 0, ltcgAmount: 0,
      totalDeductions: 500000, slabConfig: newRegimeSlabConfig,
    });
    expect(result.taxableIncome).toBe(0);
    expect(result.totalTax).toBe(0);
  });
});

describe("computeTax: end to end, both slab tax and capital gains tax combine into totalTax", () => {
  it("sums slab tax and capital gains tax correctly, with rebate applied only to slab tax per current rules", () => {
    // This test documents a real, non-obvious rule: Section 87A rebate applies only to
    // tax on slab (ordinary) income, NOT to tax on capital gains, even when total taxable
    // income (including gains) is under the rebate threshold. Verify your implementation
    // actually follows this: a naive "if taxableIncome <= limit, zero everything" would be wrong.
    const result = computeTax({
      grossSalary: 1100000, otherIncome: 0, stcgAmount: 100000, ltcgAmount: 0, // slab-taxable = 1025000 (under rebate limit), plus 100000 STCG
      totalDeductions: 0, slabConfig: newRegimeSlabConfig,
    });
    expect(result.taxableIncome).toBe(1025000);
    expect(result.rebateApplied).toBeGreaterThan(0); // rebate zeroes the slab tax
    expect(result.taxOnSlabIncome).toBeGreaterThan(0); // computed before rebate
    expect(result.taxOnCapitalGains).toBe(20000); // 100000 * 0.2 STCG rate, untouched by the rebate
    expect(result.totalTax).toBe(20000); // slab tax rebated to 0, capital gains tax stands alone
  });
});

describe("computeHraExemption: Section 10(13A), old regime only", () => {
  it("normal case: bound by the actual-HRA-received leg (leg1), not the other two", () => {
    // basic=600000, hra=280000, rentPaidAnnual=400000, metro
    // leg1 (actual HRA) = 280000
    // leg2 (rent - 10% of basic) = 400000 - 60000 = 340000
    // leg3 (50% of basic, metro) = 300000
    // min(280000, 340000, 300000) = 280000
    const result = computeHraExemption({ basic: 600000, hra: 280000, rentPaidAnnual: 400000, isMetro: true });
    expect(result).toBe(280000);
  });

  it("very low rent: bound by the rent-minus-10%-of-basic leg (leg2), not the other two", () => {
    // basic=500000, hra=200000, rentPaidAnnual=180000, non-metro
    // leg1 (actual HRA) = 200000
    // leg2 (rent - 10% of basic) = 180000 - 50000 = 130000
    // leg3 (40% of basic, non-metro) = 200000
    // min(200000, 130000, 200000) = 130000
    const result = computeHraExemption({ basic: 500000, hra: 200000, rentPaidAnnual: 180000, isMetro: false });
    expect(result).toBe(130000);
  });

  it("metro vs non-metro produces different results for otherwise-identical inputs", () => {
    // basic=600000, hra=350000, rentPaidAnnual=500000
    // leg1 (actual HRA) = 350000
    // leg2 (rent - 10% of basic) = 500000 - 60000 = 440000
    // metro leg3 = 50% of basic = 300000 -> min(350000, 440000, 300000) = 300000
    // non-metro leg3 = 40% of basic = 240000 -> min(350000, 440000, 240000) = 240000
    const metro = computeHraExemption({ basic: 600000, hra: 350000, rentPaidAnnual: 500000, isMetro: true });
    const nonMetro = computeHraExemption({ basic: 600000, hra: 350000, rentPaidAnnual: 500000, isMetro: false });
    expect(metro).toBe(300000);
    expect(nonMetro).toBe(240000);
    expect(metro).toBeGreaterThan(nonMetro);
  });

  it("clamps to 0 rather than going negative when rent is below 10% of basic", () => {
    // basic=500000, hra=100000, rentPaidAnnual=40000 (10% of basic = 50000)
    // leg2 = 40000 - 50000 = -10000 -> would make the raw min negative
    const result = computeHraExemption({ basic: 500000, hra: 100000, rentPaidAnnual: 40000, isMetro: false });
    expect(result).toBe(0);
  });

  it("returns 0 (not a crash) when basic is missing", () => {
    expect(computeHraExemption({ hra: 100000, rentPaidAnnual: 200000, isMetro: false })).toBe(0);
  });

  it("returns 0 (not a crash) when hra is missing", () => {
    expect(computeHraExemption({ basic: 500000, rentPaidAnnual: 200000, isMetro: false })).toBe(0);
  });

  it("returns 0 (not a crash) when rentPaidAnnual is missing", () => {
    expect(computeHraExemption({ basic: 500000, hra: 100000, isMetro: false })).toBe(0);
  });

  it("returns 0 for a completely empty breakdown", () => {
    expect(computeHraExemption({})).toBe(0);
  });
});
