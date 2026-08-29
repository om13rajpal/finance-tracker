import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { HoldingLot } from "../../src/models/HoldingLot.js";

// The fan-out consults the existing price cache/snapshot lookup to decide whether a
// symbol actually needs refreshing — mock it so these tests control freshness without
// touching Redis' cache keys or the network clients behind the real refresh job.
vi.mock("../../src/modules/market-data/price-cache.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/market-data/price-cache.service.js")>();
  return { ...actual, getLatestPrice: vi.fn().mockResolvedValue(null) };
});

import { getLatestPrice } from "../../src/modules/market-data/price-cache.service.js";
import {
  enqueueHeldSymbolRefreshes,
  priceRefreshQueue,
  priceRefreshFanoutQueue,
} from "../../src/jobs/workers/priceRefreshFanout.worker.js";

const mockedGetLatestPrice = vi.mocked(getLatestPrice);

async function buyLot(overrides: Record<string, unknown>) {
  return HoldingLot.create({
    userId: "fanout-user",
    platform: "zerodha",
    instrumentType: "stock",
    buyDate: new Date("2026-01-01"),
    buyPrice: 100,
    units: 10,
    remainingUnits: 10,
    ...overrides,
  });
}

beforeEach(async () => {
  await priceRefreshQueue.drain(true);
  mockedGetLatestPrice.mockReset();
  mockedGetLatestPrice.mockResolvedValue(null);
});

afterAll(async () => {
  await priceRefreshQueue.drain(true);
  await priceRefreshQueue.close();
  await priceRefreshFanoutQueue.close();
});

describe("price-refresh fan-out", () => {
  it("enqueues one price-refresh job per distinct symbol that is actually held", async () => {
    await buyLot({ symbol: "RELIANCE" });
    await buyLot({ symbol: "RELIANCE", buyDate: new Date("2026-02-01") });
    await buyLot({ symbol: "INFY" });

    const enqueued = await enqueueHeldSymbolRefreshes();
    expect(enqueued).toBe(2);

    const jobs = await priceRefreshQueue.getJobs(["waiting", "delayed", "prioritized"]);
    const symbols = jobs.map((j) => j.data.symbol).sort();
    expect(symbols).toEqual(["INFY", "RELIANCE"]);
  }, 20000);

  it("carries each symbol's instrumentType through so the worker picks the right price source", async () => {
    await buyLot({ symbol: "120503", instrumentType: "mutual_fund" });

    await enqueueHeldSymbolRefreshes();

    const jobs = await priceRefreshQueue.getJobs(["waiting", "delayed", "prioritized"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toMatchObject({ symbol: "120503", instrumentType: "mutual_fund" });
  }, 20000);

  it("does not enqueue anything for fully-sold lots", async () => {
    await buyLot({ symbol: "SOLDOUT", remainingUnits: 0 });

    const enqueued = await enqueueHeldSymbolRefreshes();
    expect(enqueued).toBe(0);

    const jobs = await priceRefreshQueue.getJobs(["waiting", "delayed", "prioritized"]);
    expect(jobs).toHaveLength(0);
  }, 20000);

  it("skips a symbol whose known price is still fresh, so a 30-minute fan-out does not hammer the upstream APIs", async () => {
    await buyLot({ symbol: "FRESH" });
    mockedGetLatestPrice.mockResolvedValue({ price: 1500, fetchedAt: new Date(), stale: false });

    const enqueued = await enqueueHeldSymbolRefreshes();
    expect(enqueued).toBe(0);
  }, 20000);

  it("still enqueues a symbol whose last known price is old enough to be worth refreshing", async () => {
    await buyLot({ symbol: "OLD" });
    mockedGetLatestPrice.mockResolvedValue({
      price: 1500,
      fetchedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      stale: true,
    });

    const enqueued = await enqueueHeldSymbolRefreshes();
    expect(enqueued).toBe(1);
  }, 20000);
});
