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

  it("leaves HoldingLot.remainingUnits untouched when no tax slab config exists for the sell's FY", async () => {
    // Deliberately does NOT seed a TaxSlabConfig — getCapitalGainsConfig will throw.
    const userId = "user-cg-4";
    const lot = await HoldingLot.create({
      userId, symbol: "NOCONFIG", platform: "zerodha", instrumentType: "stock",
      buyDate: new Date("2024-01-01"), buyPrice: 100, units: 10, remainingUnits: 10,
    });

    await expect(
      recordSale(userId, {
        symbol: "NOCONFIG", instrumentType: "stock",
        sellDate: new Date("2025-06-01"), sellPrice: 150, unitsSold: 4,
      })
    ).rejects.toThrow(/No tax slab config/);

    // holdings-fifo.ts documents that a failed sell must have zero side effects —
    // applySellFifo persists its deduction via lot.save() as it goes, so if
    // recordSale calls it before validating the tax slab config exists, a missing
    // config would leave remainingUnits partially deducted despite the sell having
    // been reported as failed.
    const reloaded = await HoldingLot.findById(lot._id);
    expect(reloaded!.remainingUnits).toBe(10);

    const events = await SellEvent.find({ userId, symbol: "NOCONFIG" });
    expect(events).toHaveLength(0);
  });
});
