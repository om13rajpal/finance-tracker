import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { HoldingLot } from "../../src/models/HoldingLot.js";
import { TaxSlabConfig } from "../../src/models/TaxSlabConfig.js";
import { Account } from "../../src/models/Account.js";
import { Transaction } from "../../src/models/Transaction.js";
import { getHoldingsRollup } from "../../src/modules/investments/holdings.service.js";
import { applySellFifo } from "../../src/modules/investments/holdings-fifo.js";
import { computeNetWorth } from "../../src/modules/accounts/accounts.service.js";
import { computeFullNetWorth } from "../../src/modules/dashboard/net-worth.service.js";

// getHoldingsRollup now merges in live prices via getLatestPrice: mock it so these
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
      // Naive avg of buyPrice would be (100+400)/2 = 250, which is wrong.
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

    it("does not crash the whole rollup when a symbol has NO available price: returns null price/value and priceStale true", async () => {
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
      // avgCost is unaffected: it's derived purely from buy-side data, not price.
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
    // recorded as "failed", a regression Task 3 must avoid, not a real test scenario.
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

    // Symbols are the join key for everything downstream: FIFO sell matching, the
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

  describe("manual buy/sell (linked account transactions)", () => {
    async function createAccount(userId: string, currentBalance: number) {
      return Account.create({
        userId,
        type: "bank",
        institution: "Test Bank",
        nickname: "Test",
        currentBalance,
      });
    }

    async function seedCapitalGainsConfig() {
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
    }

    describe("POST /holdings (buy)", () => {
      it("creates a HoldingLot without touching any account when no accountId is given", async () => {
        const cookie = authCookie("user-buy-noaccount");
        const res = await request(app)
          .post("/holdings")
          .set("Cookie", cookie)
          .send({
            symbol: "infy",
            platform: "zerodha",
            instrumentType: "stock",
            buyDate: "2026-08-01",
            buyPrice: 1500,
            units: 10,
          });

        expect(res.status).toBe(201);
        expect(res.body.lot.symbol).toBe("INFY"); // upper-cased, matching CSV import convention
        expect(res.body.transaction).toBeNull();

        const lot = await HoldingLot.findOne({ userId: "user-buy-noaccount", symbol: "INFY" });
        expect(lot).not.toBeNull();
        expect(lot!.units).toBe(10);
        expect(lot!.remainingUnits).toBe(10);

        const txCount = await Transaction.countDocuments({ userId: "user-buy-noaccount" });
        expect(txCount).toBe(0);
      });

      it("creates a linked expense Transaction and deducts the purchase cost from the funding account when accountId IS given", async () => {
        const userId = "user-buy-withaccount";
        const cookie = authCookie(userId);
        const account = await createAccount(userId, 100000);

        const res = await request(app)
          .post("/holdings")
          .set("Cookie", cookie)
          .send({
            symbol: "TCS",
            platform: "zerodha",
            instrumentType: "stock",
            buyDate: "2026-08-01",
            buyPrice: 3000,
            units: 10,
            accountId: account._id.toString(),
          });

        expect(res.status).toBe(201);
        expect(res.body.transaction).not.toBeNull();
        expect(res.body.transaction.amount).toBe(-30000); // -(3000 * 10)
        expect(res.body.transaction.source).toBe("manual");
        expect(res.body.transaction.status).toBe("confirmed");
        expect(res.body.transaction.accountId).toBe(account._id.toString());

        const tx = await Transaction.findOne({ userId, accountId: account._id.toString() });
        expect(tx).not.toBeNull();
        expect(tx!.amount).toBe(-30000);

        // 100000 - (3000 * 10) = 70000.
        const updatedAccount = await Account.findById(account._id);
        expect(updatedAccount!.currentBalance).toBe(70000);
      });

      it("net worth is unchanged by a purchase (cash converts to holdings value 1:1 at the same price): no double counting", async () => {
        const userId = "user-buy-networth";
        const cookie = authCookie(userId);
        const account = await createAccount(userId, 100000);

        const netWorthBefore = await computeFullNetWorth(userId);
        expect(netWorthBefore).toBe(100000); // no holdings yet, just the account

        // Mock this specific symbol's live price to EXACTLY the buy price, so the
        // holding's market value equals its cost basis, making "cash became
        // holdings value, 1:1" an exact, hand-checkable equality rather than an
        // approximation that depends on whatever the mocked live price is.
        mockedGetLatestPrice.mockResolvedValueOnce({ price: 3000, fetchedAt: new Date(), stale: false });

        await request(app)
          .post("/holdings")
          .set("Cookie", cookie)
          .send({
            symbol: "TCS",
            platform: "zerodha",
            instrumentType: "stock",
            buyDate: "2026-08-01",
            buyPrice: 3000,
            units: 10,
            accountId: account._id.toString(),
          });

        // Cash account dropped by exactly the purchase cost.
        expect(await computeNetWorth(userId)).toBe(70000);

        // But TOTAL net worth (cash + holdings) is back to exactly where it
        // started: the 30000 that left the account shows up as the holding's
        // value, not as a phantom double-count on top of it.
        const netWorthAfter = await computeFullNetWorth(userId);
        expect(netWorthAfter).toBe(100000);
      });

      it("with NO funding account, the purchase legitimately increases net worth at cost basis (nothing was deducted anywhere): this is the pre-fix double-count case, now scoped to only apply when the caller has no account context, exactly like a CSV import", async () => {
        const userId = "user-buy-noaccount-networth";
        await request(app)
          .post("/holdings")
          .set("Cookie", authCookie(userId))
          .send({
            symbol: "WIPRO",
            platform: "zerodha",
            instrumentType: "stock",
            buyDate: "2026-08-01",
            buyPrice: 400,
            units: 5,
          });

        // This file's default price mock (afterEach) returns 1600 for any
        // symbol not overridden per-test, so the holding's market value is
        // 1600*5=8000: the ENTIRE 8000 shows up in net worth with nothing
        // deducted from any account, since no accountId was given. This is
        // exactly the double-counting scenario this task fixes for CASES THAT
        // DO supply an account (see the test above), deliberately still true
        // here, because CSV-imported historical holdings (which also never
        // supply an account) must keep behaving exactly as before.
        const netWorth = await computeFullNetWorth(userId);
        expect(netWorth).toBe(8000);
      });

      it("400s on invalid input (e.g. missing required fields)", async () => {
        const res = await request(app)
          .post("/holdings")
          .set("Cookie", authCookie("user-buy-invalid"))
          .send({ symbol: "INFY" });
        expect(res.status).toBe(400);
      });

      it("401s without auth", async () => {
        const res = await request(app).post("/holdings").send({});
        expect(res.status).toBe(401);
      });
    });

    describe("POST /holdings/sell", () => {
      it("sells via the existing FIFO/capital-gains pipeline without touching any account when no accountId is given", async () => {
        const userId = "user-sell-noaccount";
        const cookie = authCookie(userId);
        await seedCapitalGainsConfig();
        await HoldingLot.create({
          userId,
          symbol: "SBIN",
          platform: "zerodha",
          instrumentType: "stock",
          buyDate: new Date("2026-01-01"),
          buyPrice: 500,
          units: 10,
          remainingUnits: 10,
        });

        const res = await request(app)
          .post("/holdings/sell")
          .set("Cookie", cookie)
          .send({ symbol: "sbin", instrumentType: "stock", sellDate: "2026-08-15", sellPrice: 600, unitsSold: 4 });

        expect(res.status).toBe(201);
        expect(res.body.events).toHaveLength(1);
        expect(res.body.transaction).toBeNull();

        const lot = await HoldingLot.findOne({ userId, symbol: "SBIN" });
        expect(lot!.remainingUnits).toBe(6);

        const txCount = await Transaction.countDocuments({ userId });
        expect(txCount).toBe(0);
      });

      it("creates a linked income Transaction and credits sale proceeds to the account when accountId IS given", async () => {
        const userId = "user-sell-withaccount";
        const cookie = authCookie(userId);
        await seedCapitalGainsConfig();
        const account = await createAccount(userId, 50000);
        await HoldingLot.create({
          userId,
          symbol: "SBIN",
          platform: "zerodha",
          instrumentType: "stock",
          buyDate: new Date("2026-01-01"),
          buyPrice: 500,
          units: 10,
          remainingUnits: 10,
        });

        const res = await request(app)
          .post("/holdings/sell")
          .set("Cookie", cookie)
          .send({
            symbol: "SBIN",
            instrumentType: "stock",
            sellDate: "2026-08-15",
            sellPrice: 600,
            unitsSold: 4,
            accountId: account._id.toString(),
          });

        expect(res.status).toBe(201);
        expect(res.body.transaction.amount).toBe(2400); // 600 * 4, positive (income)

        // 50000 + (600 * 4) = 52400.
        const updatedAccount = await Account.findById(account._id);
        expect(updatedAccount!.currentBalance).toBe(52400);
      });

      it("400s (not a 500, and mutates nothing) when selling more units than are held", async () => {
        const userId = "user-sell-oversell";
        const cookie = authCookie(userId);
        await seedCapitalGainsConfig();
        const account = await createAccount(userId, 50000);
        await HoldingLot.create({
          userId,
          symbol: "SBIN",
          platform: "zerodha",
          instrumentType: "stock",
          buyDate: new Date("2026-01-01"),
          buyPrice: 500,
          units: 5,
          remainingUnits: 5,
        });

        const res = await request(app)
          .post("/holdings/sell")
          .set("Cookie", cookie)
          .send({
            symbol: "SBIN",
            instrumentType: "stock",
            sellDate: "2026-08-15",
            sellPrice: 600,
            unitsSold: 10,
            accountId: account._id.toString(),
          });

        expect(res.status).toBe(400);

        const lot = await HoldingLot.findOne({ userId, symbol: "SBIN" });
        expect(lot!.remainingUnits).toBe(5); // untouched

        expect(await Transaction.countDocuments({ userId })).toBe(0);
        expect((await Account.findById(account._id))!.currentBalance).toBe(50000); // untouched
      });

      it("401s without auth", async () => {
        const res = await request(app).post("/holdings/sell").send({});
        expect(res.status).toBe(401);
      });

      // Regression: this used to 400 with a raw "No tax slab config..." error
      // and no way to proceed, because nothing ever seeds a TaxSlabConfig for
      // the current FY and there's no UI to create one: a hard production
      // blocker on selling anything at all. Deliberately does NOT call
      // seedCapitalGainsConfig().
      it("still succeeds (using the statutory default) when no tax slab config exists for the FY, and flags usedDefaultConfig", async () => {
        const userId = "user-sell-no-config";
        const cookie = authCookie(userId);
        await HoldingLot.create({
          userId,
          symbol: "SBIN",
          platform: "zerodha",
          instrumentType: "stock",
          buyDate: new Date("2025-01-01"),
          buyPrice: 500,
          units: 10,
          remainingUnits: 10,
        });

        const res = await request(app)
          .post("/holdings/sell")
          .set("Cookie", cookie)
          .send({ symbol: "SBIN", instrumentType: "stock", sellDate: "2026-08-15", sellPrice: 600, unitsSold: 4 });

        expect(res.status).toBe(201);
        expect(res.body.usedDefaultConfig).toBe(true);
        expect(res.body.events).toHaveLength(1);

        const lot = await HoldingLot.findOne({ userId, symbol: "SBIN" });
        expect(lot!.remainingUnits).toBe(6);
      });
    });

    describe("DELETE /holding-lots/:id", () => {
      it("deletes an untouched lot bought with no funding account", async () => {
        const userId = "user-delete-lot-noaccount";
        const cookie = authCookie(userId);
        const lot = await HoldingLot.create({
          userId,
          symbol: "TESTQA",
          platform: "zerodha",
          instrumentType: "stock",
          buyDate: new Date("2026-08-01"),
          buyPrice: 1000,
          units: 1,
          remainingUnits: 1,
        });

        const res = await request(app).delete(`/holding-lots/${lot._id}`).set("Cookie", cookie);
        expect(res.status).toBe(204);
        expect(await HoldingLot.findById(lot._id)).toBeNull();
      });

      it("also deletes the linked funding Transaction and reverses its balance effect", async () => {
        const userId = "user-delete-lot-withaccount";
        const cookie = authCookie(userId);
        const account = await createAccount(userId, 100000);

        const buyRes = await request(app)
          .post("/holdings")
          .set("Cookie", cookie)
          .send({
            symbol: "TESTQA",
            platform: "zerodha",
            instrumentType: "stock",
            buyDate: "2026-08-01",
            buyPrice: 1000,
            units: 1,
            accountId: account._id.toString(),
          });
        expect((await Account.findById(account._id))!.currentBalance).toBe(99000);

        const delRes = await request(app)
          .delete(`/holding-lots/${buyRes.body.lot._id}`)
          .set("Cookie", cookie);
        expect(delRes.status).toBe(204);

        expect(await HoldingLot.findById(buyRes.body.lot._id)).toBeNull();
        expect(await Transaction.findById(buyRes.body.transaction._id)).toBeNull();
        expect((await Account.findById(account._id))!.currentBalance).toBe(100000);
      });

      it("400s (and deletes nothing) when the lot has been partially sold", async () => {
        const userId = "user-delete-lot-sold";
        const cookie = authCookie(userId);
        const lot = await HoldingLot.create({
          userId,
          symbol: "SBIN",
          platform: "zerodha",
          instrumentType: "stock",
          buyDate: new Date("2025-01-01"),
          buyPrice: 500,
          units: 10,
          remainingUnits: 6, // 4 already sold
        });

        const res = await request(app).delete(`/holding-lots/${lot._id}`).set("Cookie", cookie);
        expect(res.status).toBe(400);
        expect(await HoldingLot.findById(lot._id)).not.toBeNull();
      });

      it("404s for a nonexistent or another user's lot", async () => {
        const attackerCookie = authCookie("delete-lot-attacker");
        const lot = await HoldingLot.create({
          userId: "delete-lot-owner",
          symbol: "SBIN",
          platform: "zerodha",
          instrumentType: "stock",
          buyDate: new Date("2026-08-01"),
          buyPrice: 500,
          units: 1,
          remainingUnits: 1,
        });

        const res = await request(app).delete(`/holding-lots/${lot._id}`).set("Cookie", attackerCookie);
        expect(res.status).toBe(404);
        expect(await HoldingLot.findById(lot._id)).not.toBeNull();
      });

      it("401s without auth", async () => {
        const res = await request(app).delete("/holding-lots/000000000000000000000000");
        expect(res.status).toBe(401);
      });
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

    // Regression: a lot beyond the page size used to be silently invisible,
    // with nothing in the response to say more existed at all.
    it("reports totalCount alongside a truncated page, so a caller can tell more exist", async () => {
      const userId = "user-lots-paginate";
      const cookie = authCookie(userId);
      for (let i = 0; i < 5; i++) {
        await HoldingLot.create({
          userId,
          symbol: `SYM${i}`,
          platform: "groww",
          instrumentType: "stock",
          buyDate: new Date(2026, 0, i + 1),
          buyPrice: 100,
          units: 1,
          remainingUnits: 1,
        });
      }

      const firstPage = await request(app).get("/holding-lots?limit=2").set("Cookie", cookie);
      expect(firstPage.status).toBe(200);
      expect(firstPage.body.items).toHaveLength(2);
      expect(firstPage.body.totalCount).toBe(5);

      const secondPage = await request(app).get("/holding-lots?limit=2&offset=2").set("Cookie", cookie);
      expect(secondPage.status).toBe(200);
      expect(secondPage.body.items).toHaveLength(2);
      expect(secondPage.body.totalCount).toBe(5);
      // The two pages don't overlap.
      const firstIds = firstPage.body.items.map((l: { _id: string }) => l._id);
      const secondIds = secondPage.body.items.map((l: { _id: string }) => l._id);
      expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);
    });
  });
});
