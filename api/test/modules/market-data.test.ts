import { describe, it, expect, vi, afterEach } from "vitest";
import { PriceSnapshot } from "../../src/models/PriceSnapshot.js";
import { deleteCached, getCached, setCached } from "../../src/lib/cache.js";
import { priceCacheKey } from "../../src/modules/market-data/price-cache.service.js";

vi.mock("../../src/modules/market-data/yahoo.client.js", () => ({
  fetchStockPrice: vi.fn(),
}));
vi.mock("../../src/modules/market-data/mfapi.client.js", () => ({
  fetchMutualFundNav: vi.fn(),
}));

import { fetchStockPrice } from "../../src/modules/market-data/yahoo.client.js";
import { fetchMutualFundNav } from "../../src/modules/market-data/mfapi.client.js";
import { processPriceRefreshJob } from "../../src/jobs/workers/priceRefresh.worker.js";
import { getLatestPrice } from "../../src/modules/market-data/price-cache.service.js";

const mockedFetchStockPrice = vi.mocked(fetchStockPrice);
const mockedFetchMutualFundNav = vi.mocked(fetchMutualFundNav);

// Real Redis is used here (same convention as test/jobs/queue.test.ts) rather than a
// mock — but unlike Mongo (auto-cleared per test by test/setup.ts's afterEach), Redis
// keys survive across test runs since they're not part of the Mongo cleanup. Track and
// delete every key this file touches so a leftover cached price from a previous run
// can never make a test pass (or fail) for the wrong reason.
const usedKeys = new Set<string>();
function trackKey(symbol: string) {
  usedKeys.add(priceCacheKey(symbol));
}

afterEach(async () => {
  vi.clearAllMocks();
  for (const key of usedKeys) {
    await deleteCached(key);
  }
  usedKeys.clear();
});

describe("market data", () => {
  describe("processPriceRefreshJob", () => {
    it("stores a PriceSnapshot and caches it for a stock (Yahoo)", async () => {
      trackKey("TCS");
      mockedFetchStockPrice.mockResolvedValue(2500);

      await processPriceRefreshJob({ symbol: "TCS", instrumentType: "stock" });

      const snapshot = await PriceSnapshot.findOne({ symbol: "TCS" }).sort({ fetchedAt: -1 });
      expect(snapshot?.price).toBe(2500);
      expect(snapshot?.instrumentType).toBe("stock");

      const cached = await getLatestPrice("TCS", "stock");
      expect(cached?.price).toBe(2500);
      expect(cached?.stale).toBe(false);
    });

    it("stores a PriceSnapshot for a mutual fund via mfapi", async () => {
      trackKey("119551");
      mockedFetchMutualFundNav.mockResolvedValue(45.5);

      await processPriceRefreshJob({ symbol: "119551", instrumentType: "mutual_fund" });

      const snapshot = await PriceSnapshot.findOne({ symbol: "119551" }).sort({ fetchedAt: -1 });
      expect(snapshot?.price).toBe(45.5);
      expect(snapshot?.instrumentType).toBe("mutual_fund");

      const cached = await getLatestPrice("119551", "mutual_fund");
      expect(cached?.price).toBe(45.5);
    });

    it("on failure (retries exhausted upstream), does NOT write anything and leaves existing cached/stored price queryable", async () => {
      trackKey("EXISTING");

      // Seed a prior good snapshot + cache entry, as if a previous successful refresh happened.
      await PriceSnapshot.create({
        symbol: "EXISTING",
        instrumentType: "stock",
        price: 999,
        fetchedAt: new Date(),
      });
      await setCached(priceCacheKey("EXISTING"), { price: 999, fetchedAt: new Date().toISOString() }, 3600);

      mockedFetchStockPrice.mockRejectedValue(new Error("Yahoo Finance request failed: 503"));

      await expect(processPriceRefreshJob({ symbol: "EXISTING", instrumentType: "stock" })).rejects.toThrow(
        "Yahoo Finance request failed: 503"
      );

      // Old data must survive untouched — no partial/corrupted write.
      const snapshots = await PriceSnapshot.find({ symbol: "EXISTING" });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].price).toBe(999);

      const cached = await getCached<{ price: number }>(priceCacheKey("EXISTING"));
      expect(cached?.price).toBe(999);

      const latest = await getLatestPrice("EXISTING", "stock");
      expect(latest?.price).toBe(999);
    });
  });

  describe("getLatestPrice", () => {
    it("returns null when there is no data at all (brand-new symbol, never fetched)", async () => {
      const result = await getLatestPrice("NEVERFETCHED", "stock");
      expect(result).toBeNull();
    });

    it("returns the cached value (not the Mongo value) and stale:false when Redis has a fresh entry, even if Mongo's snapshot for the same symbol is old", async () => {
      trackKey("CACHEHIT");

      // A stale-looking Mongo snapshot (3h old, past the 2h stock threshold)...
      await PriceSnapshot.create({
        symbol: "CACHEHIT",
        instrumentType: "stock",
        price: 100,
        fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      });
      // ...but a fresh cache entry with a DIFFERENT price, proving cache is consulted first.
      await setCached(priceCacheKey("CACHEHIT"), { price: 250, fetchedAt: new Date().toISOString() }, 3600);

      const result = await getLatestPrice("CACHEHIT", "stock");
      expect(result?.price).toBe(250);
      expect(result?.stale).toBe(false);
    });

    it("falls back to Mongo and returns stale:false when the cache misses but the snapshot is recent", async () => {
      await PriceSnapshot.create({
        symbol: "FRESHMONGO",
        instrumentType: "stock",
        price: 500,
        fetchedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min old, well under the 2h stock threshold
      });

      const result = await getLatestPrice("FRESHMONGO", "stock");
      expect(result?.price).toBe(500);
      expect(result?.stale).toBe(false);
    });

    it("falls back to Mongo and marks stale data when the cache misses and the snapshot is old (stock threshold: 2h)", async () => {
      await PriceSnapshot.create({
        symbol: "OLDSTOCK",
        instrumentType: "stock",
        price: 100,
        fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      });

      const result = await getLatestPrice("OLDSTOCK", "stock");
      expect(result?.price).toBe(100);
      expect(result?.stale).toBe(true);
    });

    it("uses the MUTUAL FUND threshold (2 days), not the stock threshold, for a mutual_fund symbol — a 3h-old snapshot is NOT stale for a fund", async () => {
      await PriceSnapshot.create({
        symbol: "MFTHRESHOLD",
        instrumentType: "mutual_fund",
        price: 45.5,
        fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // would be stale for a stock, not for a fund
      });

      const result = await getLatestPrice("MFTHRESHOLD", "mutual_fund");
      expect(result?.stale).toBe(false);
    });

    it("marks a mutual fund snapshot stale once it's older than 2 days", async () => {
      await PriceSnapshot.create({
        symbol: "MFSTALE",
        instrumentType: "mutual_fund",
        price: 45.5,
        fetchedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days old
      });

      const result = await getLatestPrice("MFSTALE", "mutual_fund");
      expect(result?.stale).toBe(true);
    });
  });
});
