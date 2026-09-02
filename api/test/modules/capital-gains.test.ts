import { describe, it, expect } from "vitest";
import { HoldingLot } from "../../src/models/HoldingLot.js";
import { TaxSlabConfig } from "../../src/models/TaxSlabConfig.js";
import { recordSale } from "../../src/modules/tax/capital-gains.service.js";
import { SellEvent } from "../../src/models/SellEvent.js";

async function seedSlabConfig() {
  await TaxSlabConfig.create({
    financialYear: "2025-26",
    regime: "new",
    standardDeduction: 75000,
    slabs: [{ upTo: null, rate: 0.3 }],
    section87ARebateLimit: 1200000,
    section87ARebateMaxTax: 60000,
    capitalGains: {
      equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 },
      debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 },
    },
  });
}

describe("recordSale", () => {
  it("classifies a lot held over the equity STCG threshold as LTCG", async () => {
    await seedSlabConfig();
    const userId = "user-cg-1";
    await HoldingLot.create({
      userId, symbol: "LONGHOLD", platform: "zerodha", instrumentType: "stock",
      buyDate: new Date("2024-01-01"), buyPrice: 100, units: 10, remainingUnits: 10,
    });

    const events = await recordSale(userId, {
      symbol: "LONGHOLD", instrumentType: "stock",
      sellDate: new Date("2025-06-01"), sellPrice: 150, unitsSold: 10,
    });

    expect(events).toHaveLength(1);
    expect(events[0].classification).toBe("LTCG");
    expect(events[0].gainAmount).toBe(500); // (150-100)*10
    expect(events[0].financialYear).toBe("2025-26");
  });

  it("classifies a lot held under the equity STCG threshold as STCG", async () => {
    await seedSlabConfig();
    const userId = "user-cg-2";
    await HoldingLot.create({
      userId, symbol: "SHORTHOLD", platform: "zerodha", instrumentType: "stock",
      buyDate: new Date("2025-05-01"), buyPrice: 100, units: 10, remainingUnits: 10,
    });

    const events = await recordSale(userId, {
      symbol: "SHORTHOLD", instrumentType: "stock",
      sellDate: new Date("2025-06-01"), sellPrice: 120, unitsSold: 10,
    });

    expect(events).toHaveLength(1);
    expect(events[0].classification).toBe("STCG");
  });

  it("splits a single sell across two lots with different holding periods into two SellEvents", async () => {
    await seedSlabConfig();
    const userId = "user-cg-3";
    await HoldingLot.create({
      userId, symbol: "MIXED", platform: "zerodha", instrumentType: "stock",
      buyDate: new Date("2024-01-01"), buyPrice: 100, units: 5, remainingUnits: 5, // old, will be LTCG
    });
    await HoldingLot.create({
      userId, symbol: "MIXED", platform: "zerodha", instrumentType: "stock",
      buyDate: new Date("2025-05-01"), buyPrice: 100, units: 5, remainingUnits: 5, // recent, will be STCG
    });

    const events = await recordSale(userId, {
      symbol: "MIXED", instrumentType: "stock",
      sellDate: new Date("2025-06-01"), sellPrice: 100, unitsSold: 10,
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.classification).sort()).toEqual(["LTCG", "STCG"]);

    const stored = await SellEvent.find({ userId, symbol: "MIXED" });
    expect(stored).toHaveLength(2);
  });

  // Regression: recording a sale used to hard-fail (and, per the old version of
  // this test, leave the lot untouched) whenever no TaxSlabConfig existed for
  // the sell's FY, with no UI anywhere to create one. It now succeeds using
  // the built-in statutory default and flags the resulting event(s) as such.
  it("succeeds using the statutory default (flagged) when no tax slab config exists for the sell's FY", async () => {
    // Deliberately does NOT seed a TaxSlabConfig.
    const userId = "user-cg-4";
    const lot = await HoldingLot.create({
      userId, symbol: "NOCONFIG", platform: "zerodha", instrumentType: "stock",
      buyDate: new Date("2024-01-01"), buyPrice: 100, units: 10, remainingUnits: 10,
    });

    const events = await recordSale(userId, {
      symbol: "NOCONFIG", instrumentType: "stock",
      sellDate: new Date("2025-06-01"), sellPrice: 150, unitsSold: 4,
    });

    expect(events).toHaveLength(1);
    // Bought 2024-01-01, sold 2025-06-01: well past the 365-day default STCG
    // threshold, so this is LTCG under the fallback rule.
    expect(events[0].classification).toBe("LTCG");
    expect(events[0].usedDefaultCapitalGainsConfig).toBe(true);

    const reloaded = await HoldingLot.findById(lot._id);
    expect(reloaded!.remainingUnits).toBe(6);
  });

  it("does NOT flag usedDefaultCapitalGainsConfig when a real config exists for the FY", async () => {
    await seedSlabConfig();
    const userId = "user-cg-5";
    await HoldingLot.create({
      userId, symbol: "CONFIGURED", platform: "zerodha", instrumentType: "stock",
      buyDate: new Date("2025-05-01"), buyPrice: 100, units: 10, remainingUnits: 10,
    });

    const events = await recordSale(userId, {
      symbol: "CONFIGURED", instrumentType: "stock",
      sellDate: new Date("2025-06-01"), sellPrice: 120, unitsSold: 10,
    });

    expect(events[0].usedDefaultCapitalGainsConfig).toBe(false);
  });
});
