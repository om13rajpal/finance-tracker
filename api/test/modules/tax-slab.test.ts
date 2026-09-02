import { describe, it, expect } from "vitest";
import { TaxSlabConfig } from "../../src/models/TaxSlabConfig.js";
import { getSlabConfig, getCapitalGainsConfig } from "../../src/modules/tax/tax-slab.service.js";

const EQUITY = { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 };
const DEBT = { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 };

function configFor(financialYear: string, regime: "old" | "new", equity: typeof EQUITY) {
  return {
    financialYear,
    regime,
    standardDeduction: 75000,
    slabs: [{ upTo: null, rate: 0.3 }],
    section87ARebateLimit: 1200000,
    section87ARebateMaxTax: 60000,
    section80CLimit: 0,
    capitalGains: { equity, debt: DEBT },
  };
}

describe("getCapitalGainsConfig", () => {
  // Regression: this used to throw a 404 with no UI anywhere to create the
  // config it was demanding, hard-blocking every sale for any FY nobody had
  // manually seeded. See DEFAULT_EQUITY_CAPITAL_GAINS's doc comment.
  it("falls back to the statutory default (flagged isDefault) when no config exists for the FY at all", async () => {
    const cg = await getCapitalGainsConfig("2098-99");
    expect(cg.isDefault).toBe(true);
    expect(cg.stcgHoldingDays).toBe(365);
    expect(cg.stcgRate).toBe(0.2);
    expect(cg.ltcgRate).toBe(0.125);
    expect(cg.ltcgExemptionLimit).toBe(125000);
  });

  it("resolves from whichever single regime document exists (capital gains rules are regime-independent), NOT flagged as default", async () => {
    // Only the "old" regime document exists: classification must still work rather
    // than hard-depending on the "new" document happening to be present.
    await TaxSlabConfig.create(configFor("2090-91", "old", EQUITY));
    const cg = await getCapitalGainsConfig("2090-91");
    expect(cg.stcgHoldingDays).toBe(365);
    expect(cg.ltcgExemptionLimit).toBe(125000);
    expect(cg.isDefault).toBe(false);
  });

  it("returns the shared block when both regimes agree", async () => {
    await TaxSlabConfig.create(configFor("2091-92", "old", EQUITY));
    await TaxSlabConfig.create(configFor("2091-92", "new", EQUITY));
    const cg = await getCapitalGainsConfig("2091-92");
    expect(cg.stcgHoldingDays).toBe(365);
    expect(cg.isDefault).toBe(false);
  });

  it("throws when the two regimes' capitalGains.equity blocks have drifted apart", async () => {
    // Capital gains rules do not differ by regime under Indian law, so a divergence is
    // always a data-entry error. Without this guard, classification would silently pick
    // one regime's numbers and quietly mis-classify STCG vs LTCG.
    await TaxSlabConfig.create(configFor("2092-93", "old", { ...EQUITY, stcgHoldingDays: 730 }));
    await TaxSlabConfig.create(configFor("2092-93", "new", EQUITY));
    await expect(getCapitalGainsConfig("2092-93")).rejects.toThrow(/diverg/i);
  });
});

describe("getSlabConfig", () => {
  it("throws a 404-flagged error when no config exists for the FY+regime", async () => {
    await expect(getSlabConfig("2099-100", "old")).rejects.toMatchObject({ status: 404 });
  });

  it("returns the matching config when one exists", async () => {
    await TaxSlabConfig.create({
      financialYear: "2025-26",
      regime: "new",
      standardDeduction: 75000,
      slabs: [
        { upTo: 400000, rate: 0 },
        { upTo: 800000, rate: 0.05 },
        { upTo: null, rate: 0.3 },
      ],
      section87ARebateLimit: 1200000,
      section87ARebateMaxTax: 60000,
      capitalGains: {
        equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 },
        debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 },
      },
    });

    const config = await getSlabConfig("2025-26", "new");
    expect(config.standardDeduction).toBe(75000);
    expect(config.slabs).toHaveLength(3);
  });
});
