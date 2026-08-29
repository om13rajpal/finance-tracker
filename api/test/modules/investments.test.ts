import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { HoldingLot } from "../../src/models/HoldingLot.js";
import { TaxSlabConfig } from "../../src/models/TaxSlabConfig.js";
import { getHoldingsRollup } from "../../src/modules/investments/holdings.service.js";
import { applySellFifo } from "../../src/modules/investments/holdings-fifo.js";

// getHoldingsRollup now merges in live prices via getLatestPrice — mock it so these
// tests exercise the FIFO/rollup logic without touching Redis/Mongo price lookups or
// (indirectly) any network client.
vi.mock("../../src/modules/market-data/price-cache.service.js", () => ({
  getLatestPrice: vi.fn().mockResolvedValue({ price: 1600, fetchedAt: new Date(), stale: false }),
}));

import { getLatestPrice } from "../../src/modules/market-data/price-cache.service.js";
const mockedGetLatestPrice = vi.mocked(getLatestPrice);

// A couple of tests override this mock's behavior per-call (mockResolvedValueOnce /
// mockImplementation) to exercise the "no price available" and mixed-symbol paths.
// Restore the default fixed-price implementation after every test so those overrides
// never leak into unrelated tests (e.g. the routes tests below, which don't care about
// pricing specifics and were written against the default 1600 price).
afterEach(() => {
  mockedGetLatestPrice.mockReset();
  mockedGetLatestPrice.mockResolvedValue({ price: 1600, fetchedAt: new Date(), stale: false });
});

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("investments", () => {
  describe("getHoldingsRollup", () => {
    it("rolls up multiple lots of the same symbol into total units and weighted avg cost", async () => {
      await HoldingLot.create({
        userId: "user-rollup",
        symbol: "NIFTYBEES",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 200,
        units: 10,
        remainingUnits: 10,
      });
      await HoldingLot.create({
        userId: "user-rollup",
        symbol: "NIFTYBEES",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-02-01"),
        buyPrice: 220,
        units: 10,
        remainingUnits: 10,
      });

      const rollup = await getHoldingsRollup("user-rollup");
      expect(rollup).toHaveLength(1);
      expect(rollup[0].totalUnits).toBe(20);
      expect(rollup[0].avgCost).toBe(210);
    });

    it("weights the average cost by remaining units, not a naive average of buyPrice", async () => {
      // 10 units @ 100 fully untouched, 2 units @ 400 (originally 10, 8 sold).
      // Naive avg of buyPrice would be (100+400)/2 = 250 — wrong.
      // Correct weighted avg = (10*100 + 2*400) / 12 = 1800/12 = 150.
      await HoldingLot.create({
        userId: "user-weighted",
        symbol: "WIPRO",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 100,
        units: 10,
        remainingUnits: 10,
      });
      await HoldingLot.create({
        userId: "user-weighted",
        symbol: "WIPRO",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-02-01"),
        buyPrice: 400,
        units: 10,
        remainingUnits: 2,
      });

      const rollup = await getHoldingsRollup("user-weighted");
      expect(rollup).toHaveLength(1);
      expect(rollup[0].totalUnits).toBe(12);
      expect(rollup[0].avgCost).toBe(150);
    });

    it("excludes a symbol from the rollup when every lot is fully sold", async () => {
      await HoldingLot.create({
        userId: "user-soldout",
        symbol: "ITC",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 400,
        units: 5,
        remainingUnits: 0,
      });
      await HoldingLot.create({
        userId: "user-soldout",
        symbol: "HDFC",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 1600,
        units: 3,
        remainingUnits: 3,
      });

      const rollup = await getHoldingsRollup("user-soldout");
      expect(rollup).toHaveLength(1);
      expect(rollup[0].symbol).toBe("HDFC");
    });

    it("merges currentPrice/currentValue/priceStale from getLatestPrice, computing currentValue as units * price", async () => {
      mockedGetLatestPrice.mockResolvedValueOnce({ price: 210, fetchedAt: new Date(), stale: true });

      await HoldingLot.create({
        userId: "user-priced",
        symbol: "TATASTEEL",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 150,
        units: 4,
        remainingUnits: 4,
      });

      const rollup = await getHoldingsRollup("user-priced");
      expect(rollup).toHaveLength(1);
      expect(rollup[0].currentPrice).toBe(210);
      expect(rollup[0].currentValue).toBe(840); // 4 units * 210
      expect(rollup[0].priceStale).toBe(true);
    });

    it("does not crash the whole rollup when a symbol has NO available price — returns null price/value and priceStale true", async () => {
      mockedGetLatestPrice.mockResolvedValueOnce(null);

      await HoldingLot.create({
        userId: "user-noprice",
        symbol: "OBSCURESTOCK",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 50,
        units: 2,
        remainingUnits: 2,
      });

      const rollup = await getHoldingsRollup("user-noprice");
      expect(rollup).toHaveLength(1);
      expect(rollup[0].currentPrice).toBeNull();
      expect(rollup[0].currentValue).toBeNull();
      expect(rollup[0].priceStale).toBe(true);
      // avgCost is unaffected — it's derived purely from buy-side data, not price.
      expect(rollup[0].avgCost).toBe(50);
    });

    it("a symbol with no available price does not crash or drop OTHER holdings from the same rollup call", async () => {
      mockedGetLatestPrice.mockImplementation(async (symbol) =>
        symbol === "NOPRICEHERE" ? null : { price: 300, fetchedAt: new Date(), stale: false }
      );

      await HoldingLot.create({
        userId: "user-mixed",
        symbol: "NOPRICEHERE",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 50,
        units: 2,
        remainingUnits: 2,
      });
      await HoldingLot.create({
        userId: "user-mixed",
        symbol: "HASPRICE",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 100,
        units: 5,
        remainingUnits: 5,
      });

      const rollup = await getHoldingsRollup("user-mixed");
      expect(rollup).toHaveLength(2);

      const noPriceRow = rollup.find((r) => r.symbol === "NOPRICEHERE");
      const hasPriceRow = rollup.find((r) => r.symbol === "HASPRICE");
      expect(noPriceRow).toMatchObject({ currentPrice: null, currentValue: null, priceStale: true });
      expect(hasPriceRow).toMatchObject({ currentPrice: 300, currentValue: 1500, priceStale: false });
    });
  });

  describe("applySellFifo", () => {
    it("applies FIFO sell across lots and excludes fully-sold lots from the rollup", async () => {
      await HoldingLot.create({
        userId: "user-fifo",
        symbol: "TCS",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 3000,
        units: 5,
        remainingUnits: 5,
      });
      await HoldingLot.create({
        userId: "user-fifo",
        symbol: "TCS",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-02-01"),
        buyPrice: 3200,
        units: 5,
        remainingUnits: 5,
      });

      await applySellFifo("user-fifo", "TCS", 7);

      const lots = await HoldingLot.find({ userId: "user-fifo", symbol: "TCS" }).sort({ buyDate: 1 });
      expect(lots[0].remainingUnits).toBe(0);
      expect(lots[1].remainingUnits).toBe(3);

      const rollup = await getHoldingsRollup("user-fifo");
      expect(rollup).toHaveLength(1);
      expect(rollup[0].totalUnits).toBe(3);
    });

    it("the brief's own scenario: buy 10, sell 4 -> units=10, remainingUnits=6", async () => {
      await HoldingLot.create({
        userId: "user-brief",
        symbol: "SBIN",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 500,
        units: 10,
        remainingUnits: 10,
      });

      await applySellFifo("user-brief", "SBIN", 4);

      const lot = await HoldingLot.findOne({ userId: "user-brief", symbol: "SBIN" });
      expect(lot!.units).toBe(10);
      expect(lot!.remainingUnits).toBe(6);
    });

    it("exact-match sell zeroes out the oldest lot exactly, not negative", async () => {
      await HoldingLot.create({
        userId: "user-exact",
        symbol: "AXISBANK",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 900,
        units: 5,
        remainingUnits: 5,
      });

      await applySellFifo("user-exact", "AXISBANK", 5);

      const lot = await HoldingLot.findOne({ userId: "user-exact", symbol: "AXISBANK" });
      expect(lot!.remainingUnits).toBe(0);
      expect(lot!.remainingUnits).not.toBeLessThan(0);
    });

    it("partial-lot sell only reduces the oldest lot, leaving newer lots untouched", async () => {
      await HoldingLot.create({
        userId: "user-partial",
        symbol: "ICICIBANK",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 900,
        units: 10,
        remainingUnits: 10,
      });
      await HoldingLot.create({
        userId: "user-partial",
        symbol: "ICICIBANK",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-02-01"),
        buyPrice: 950,
        units: 10,
        remainingUnits: 10,
      });

      await applySellFifo("user-partial", "ICICIBANK", 3);

      const lots = await HoldingLot.find({ userId: "user-partial", symbol: "ICICIBANK" }).sort({ buyDate: 1 });
      expect(lots[0].remainingUnits).toBe(7);
      expect(lots[1].remainingUnits).toBe(10);
    });

    it("multi-lot FIFO trace: buy 5, buy 3, buy 10 (chronological), sell 12 -> first two lots zeroed, third lot has 6 remaining", async () => {
      await HoldingLot.create({
        userId: "user-multilot",
        symbol: "RELIANCE",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 2400,
        units: 5,
        remainingUnits: 5,
      });
      await HoldingLot.create({
        userId: "user-multilot",
        symbol: "RELIANCE",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-02-01"),
        buyPrice: 2450,
        units: 3,
        remainingUnits: 3,
      });
      await HoldingLot.create({
        userId: "user-multilot",
        symbol: "RELIANCE",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-03-01"),
        buyPrice: 2500,
        units: 10,
        remainingUnits: 10,
      });

      await applySellFifo("user-multilot", "RELIANCE", 12);

      const lots = await HoldingLot.find({ userId: "user-multilot", symbol: "RELIANCE" }).sort({ buyDate: 1 });
      expect(lots[0].remainingUnits).toBe(0);
      expect(lots[1].remainingUnits).toBe(0);
      expect(lots[2].remainingUnits).toBe(6);
    });

    it("orders by buyDate ascending, not insertion order, when lots are backfilled out of chronological order", async () => {
      // Insert the FEBRUARY lot first (so insertion order != chronological order),
      // then the JANUARY lot second. FIFO must still consume January (older) first.
      await HoldingLot.create({
        userId: "user-backfill",
        symbol: "LT",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-02-01"),
        buyPrice: 3600,
        units: 5,
        remainingUnits: 5,
      });
      await HoldingLot.create({
        userId: "user-backfill",
        symbol: "LT",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 3500,
        units: 5,
        remainingUnits: 5,
      });

      await applySellFifo("user-backfill", "LT", 5);

      const janLot = await HoldingLot.findOne({ userId: "user-backfill", symbol: "LT", buyDate: new Date("2026-01-01") });
      const febLot = await HoldingLot.findOne({ userId: "user-backfill", symbol: "LT", buyDate: new Date("2026-02-01") });
      expect(janLot!.remainingUnits).toBe(0);
      expect(febLot!.remainingUnits).toBe(5);
    });

    it("throws when selling more units than are held, and leaves lots unmodified", async () => {
      await HoldingLot.create({
        userId: "user-insufficient",
        symbol: "MARUTI",
        platform: "zerodha",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 9000,
        units: 5,
        remainingUnits: 5,
      });

      await expect(applySellFifo("user-insufficient", "MARUTI", 10)).rejects.toThrow();

      const lot = await HoldingLot.findOne({ userId: "user-insufficient", symbol: "MARUTI" });
      expect(lot!.remainingUnits).toBe(5);
    });

    it("throws when selling a symbol with no holdings at all", async () => {
      await expect(applySellFifo("user-none", "GHOST", 1)).rejects.toThrow();
    });

    it("returns the matched lots consumed, with cost basis and buyDate, in FIFO order", async () => {
      const userId = "user-fifo-return";
      const lot1 = await HoldingLot.create({
        userId, symbol: "TESTCO", platform: "zerodha", instrumentType: "stock",
        buyDate: new Date("2024-01-01"), buyPrice: 100, units: 5, remainingUnits: 5,
      });
      const lot2 = await HoldingLot.create({
        userId, symbol: "TESTCO", platform: "zerodha", instrumentType: "stock",
        buyDate: new Date("2024-06-01"), buyPrice: 150, units: 10, remainingUnits: 10,
      });

      const matched = await applySellFifo(userId, "TESTCO", 8);

      expect(matched).toEqual([
        { lotId: lot1._id.toString(), unitsFromLot: 5, costBasis: 500, buyDate: lot1.buyDate },
        { lotId: lot2._id.toString(), unitsFromLot: 3, costBasis: 450, buyDate: lot2.buyDate },
      ]);
    });
  });

  describe("CSV import", () => {
    // Sell rows now go through recordSale (Task 3), which classifies each FIFO-matched
    // lot as STCG/LTCG using the TaxSlabConfig for the sell date's financial year. All
    // sell rows in this describe block fall in FY2026-27 (Aug 2026 trade dates), so a
    // config for that FY must exist or recordSale's slab lookup throws and the row is
    // recorded as "failed" — a regression Task 3 must avoid, not a real test scenario.
    // Only the "new" regime is seeded because recordSale looks up "new" specifically
    // (capital gains rules are regime-independent, so which regime's document is
    // queried doesn't matter for these figures).
    beforeEach(async () => {
      await TaxSlabConfig.create({
        financialYear: "2026-27",
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
    });

    it("imports a Zerodha CSV with a buy then a sell, netting remaining units", async () => {
      const cookie = authCookie("user-zerodha");
      const csv = `Symbol,Trade Date,Trade Type,Quantity,Price
NIFTYBEES,01/08/2026,buy,10,220
NIFTYBEES,15/08/2026,sell,4,230
`;

      const res = await request(app)
        .post("/investments/import")
        .set("Cookie", cookie)
        .field("platform", "zerodha")
        .attach("file", Buffer.from(csv), "tradebook.csv");

      expect(res.status).toBe(200);

      const lot = await HoldingLot.findOne({ userId: "user-zerodha", symbol: "NIFTYBEES" });
      expect(lot!.units).toBe(10);
      expect(lot!.remainingUnits).toBe(6);
      expect(res.body.rowResults).toHaveLength(2);
      expect(res.body.rowResults[0].status).toBe("success");
      expect(res.body.rowResults[1].status).toBe("success");
    });

    it("imports a Groww CSV with the same column shape", async () => {
      const cookie = authCookie("user-groww");
      const csv = `Symbol,Trade Date,Trade Type,Quantity,Price
INFY,01/08/2026,buy,8,1500
`;

      const res = await request(app)
        .post("/investments/import")
        .set("Cookie", cookie)
        .field("platform", "groww")
        .attach("file", Buffer.from(csv), "trades.csv");

      expect(res.status).toBe(200);

      const lot = await HoldingLot.findOne({ userId: "user-groww", symbol: "INFY" });
      expect(lot!.platform).toBe("groww");
      expect(lot!.units).toBe(8);
      expect(lot!.remainingUnits).toBe(8);
    });

    // Symbols are the join key for everything downstream — FIFO sell matching, the
    // per-symbol rollup, and the price lookup. A case variant in one CSV row would
    // otherwise silently fork a position into two half-holdings whose sells can't
    // find their own buys, so parsing normalizes symbol case up front.
    it("normalizes symbol case so a mixed-case sell nets against the same holding as its buy", async () => {
      const cookie = authCookie("user-symbol-case");
      const csv = `Symbol,Trade Date,Trade Type,Quantity,Price
reliance,01/08/2026,buy,10,2400
Reliance,15/08/2026,sell,4,2500
`;

      const res = await request(app)
        .post("/investments/import")
        .set("Cookie", cookie)
        .field("platform", "zerodha")
        .attach("file", Buffer.from(csv), "tradebook.csv");

      expect(res.status).toBe(200);
      expect(res.body.rowResults.every((r: { status: string }) => r.status === "success")).toBe(true);

      const lots = await HoldingLot.find({ userId: "user-symbol-case" });
      expect(lots).toHaveLength(1);
      expect(lots[0].symbol).toBe("RELIANCE");
      expect(lots[0].remainingUnits).toBe(6);
    });

    it("isolates a bad row (unparseable date) as failed without failing the whole batch", async () => {
      const cookie = authCookie("user-badrow");
      const csv = `Symbol,Trade Date,Trade Type,Quantity,Price
TATASTEEL,not-a-date,buy,5,120
TATAMOTORS,01/08/2026,buy,5,700
`;

      const res = await request(app)
        .post("/investments/import")
        .set("Cookie", cookie)
        .field("platform", "zerodha")
        .attach("file", Buffer.from(csv), "tradebook.csv");

      expect(res.status).toBe(200);
      expect(res.body.rowResults[0].status).toBe("failed");
      expect(res.body.rowResults[1].status).toBe("success");

      const badLot = await HoldingLot.findOne({ userId: "user-badrow", symbol: "TATASTEEL" });
      expect(badLot).toBeNull();
      const goodLot = await HoldingLot.findOne({ userId: "user-badrow", symbol: "TATAMOTORS" });
      expect(goodLot).not.toBeNull();
    });

    it("isolates a sell-more-than-held row as failed without failing the whole batch", async () => {
      const cookie = authCookie("user-oversell");
      const csv = `Symbol,Trade Date,Trade Type,Quantity,Price
WIPRO,01/08/2026,buy,5,400
WIPRO,02/08/2026,sell,10,420
HCLTECH,03/08/2026,buy,2,1200
`;

      const res = await request(app)
        .post("/investments/import")
        .set("Cookie", cookie)
        .field("platform", "zerodha")
        .attach("file", Buffer.from(csv), "tradebook.csv");

      expect(res.status).toBe(200);
      expect(res.body.rowResults[0].status).toBe("success");
      expect(res.body.rowResults[1].status).toBe("failed");
      expect(res.body.rowResults[2].status).toBe("success");

      const wiproLot = await HoldingLot.findOne({ userId: "user-oversell", symbol: "WIPRO" });
      // The failed oversell must not have partially mutated the lot.
      expect(wiproLot!.remainingUnits).toBe(5);
    });

    it("400s when platform is missing or invalid", async () => {
      const cookie = authCookie("user-noplatform");
      const csv = `Symbol,Trade Date,Trade Type,Quantity,Price\nINFY,01/08/2026,buy,1,1500\n`;

      const res = await request(app)
        .post("/investments/import")
        .set("Cookie", cookie)
        .attach("file", Buffer.from(csv), "trades.csv");

      expect(res.status).toBe(400);
    });

    it("400s when no file is uploaded", async () => {
      const cookie = authCookie("user-nofile");
      const res = await request(app)
        .post("/investments/import")
        .set("Cookie", cookie)
        .field("platform", "zerodha");

      expect(res.status).toBe(400);
    });
  });

  describe("routes", () => {
    it("returns holdings and holding-lots via the API, scoped per user", async () => {
      const cookie = authCookie("user-api");
      await HoldingLot.create({
        userId: "user-api",
        symbol: "INFY",
        platform: "groww",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 1500,
        units: 3,
        remainingUnits: 3,
      });
      await HoldingLot.create({
        userId: "user-other",
        symbol: "TCS",
        platform: "groww",
        instrumentType: "stock",
        buyDate: new Date("2026-01-01"),
        buyPrice: 3000,
        units: 1,
        remainingUnits: 1,
      });

      const holdingsRes = await request(app).get("/holdings").set("Cookie", cookie);
      expect(holdingsRes.status).toBe(200);
      expect(holdingsRes.body).toHaveLength(1);
      expect(holdingsRes.body[0]).toMatchObject({
        symbol: "INFY",
        currentPrice: 1600,
        currentValue: 4800,
        priceStale: false,
      });

      const lotsRes = await request(app).get("/holding-lots").set("Cookie", cookie);
      expect(lotsRes.status).toBe(200);
      expect(lotsRes.body.items).toHaveLength(1);
      expect(lotsRes.body.items[0].symbol).toBe("INFY");
    });

    it("401s without auth", async () => {
      const res = await request(app).get("/holdings");
      expect(res.status).toBe(401);
    });
  });
});
