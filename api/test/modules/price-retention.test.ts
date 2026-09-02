import { describe, it, expect, afterEach } from "vitest";
import { PriceSnapshot } from "../../src/models/PriceSnapshot.js";
import { rollupOldPriceSnapshots } from "../../src/modules/market-data/price-retention.service.js";
import { priceRetentionQueue, schedulePriceRetention } from "../../src/jobs/workers/priceRetention.worker.js";

describe("price snapshot retention", () => {
  it("keeps only the latest snapshot per symbol per day for data older than 7 days, leaves recent data alone", async () => {
    const oldDay = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const times = [9, 11, 13, 15, 17].map((hour) => {
      const d = new Date(oldDay);
      d.setHours(hour, 0, 0, 0);
      return d;
    });

    for (const fetchedAt of times) {
      await PriceSnapshot.create({ symbol: "TCS", instrumentType: "stock", price: 2500 + fetchedAt.getHours(), fetchedAt });
    }

    const recentA = await PriceSnapshot.create({ symbol: "TCS", instrumentType: "stock", price: 2600, fetchedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
    const recentB = await PriceSnapshot.create({ symbol: "TCS", instrumentType: "stock", price: 2650, fetchedAt: new Date() });

    await rollupOldPriceSnapshots();

    const remainingOld = await PriceSnapshot.find({
      symbol: "TCS",
      fetchedAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });
    expect(remainingOld).toHaveLength(1);
    expect(remainingOld[0].price).toBe(2517); // the 17:00 (latest) snapshot from that day
    expect(remainingOld[0].fetchedAt.getHours()).toBe(17);

    const stillThereA = await PriceSnapshot.findById(recentA._id);
    const stillThereB = await PriceSnapshot.findById(recentB._id);
    expect(stillThereA).not.toBeNull();
    expect(stillThereB).not.toBeNull();
  });

  it("groups by symbol AND day independently: two symbols on the same old day each keep their own latest snapshot", async () => {
    const oldDay = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const times = [9, 12, 15].map((hour) => {
      const d = new Date(oldDay);
      d.setHours(hour, 0, 0, 0);
      return d;
    });

    for (const fetchedAt of times) {
      await PriceSnapshot.create({ symbol: "TCS", instrumentType: "stock", price: 2500 + fetchedAt.getHours(), fetchedAt });
      await PriceSnapshot.create({ symbol: "INFY", instrumentType: "stock", price: 1500 + fetchedAt.getHours(), fetchedAt });
    }

    await rollupOldPriceSnapshots();

    const remainingTcs = await PriceSnapshot.find({ symbol: "TCS" });
    const remainingInfy = await PriceSnapshot.find({ symbol: "INFY" });
    expect(remainingTcs).toHaveLength(1);
    expect(remainingInfy).toHaveLength(1);
    expect(remainingTcs[0].price).toBe(2515);
    expect(remainingInfy[0].price).toBe(1515);
  });

  it("does not group snapshots across a UTC calendar-day boundary even if they are only minutes apart", async () => {
    // 23:55 UTC on one old day, and 00:05 UTC the next day (still > 7 days old): must NOT collapse to one.
    const base = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const lateNight = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 23, 55, 0, 0));
    const earlyNextDay = new Date(lateNight.getTime() + 10 * 60 * 1000); // +10 minutes, crosses midnight UTC

    await PriceSnapshot.create({ symbol: "TCS", instrumentType: "stock", price: 1, fetchedAt: lateNight });
    await PriceSnapshot.create({ symbol: "TCS", instrumentType: "stock", price: 2, fetchedAt: earlyNextDay });

    await rollupOldPriceSnapshots();

    const remaining = await PriceSnapshot.find({ symbol: "TCS" }).sort({ fetchedAt: 1 });
    expect(remaining).toHaveLength(2);
    expect(remaining.map((r) => r.price)).toEqual([1, 2]);
  });

  it("is idempotent: running rollup a second time makes no further changes", async () => {
    const oldDay = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const times = [9, 11, 13].map((hour) => {
      const d = new Date(oldDay);
      d.setHours(hour, 0, 0, 0);
      return d;
    });

    for (const fetchedAt of times) {
      await PriceSnapshot.create({ symbol: "TCS", instrumentType: "stock", price: 2500 + fetchedAt.getHours(), fetchedAt });
    }

    await rollupOldPriceSnapshots();
    const afterFirst = await PriceSnapshot.find({ symbol: "TCS" });
    expect(afterFirst).toHaveLength(1);
    const survivorId = afterFirst[0]._id.toString();
    const survivorPrice = afterFirst[0].price;

    await expect(rollupOldPriceSnapshots()).resolves.not.toThrow();

    const afterSecond = await PriceSnapshot.find({ symbol: "TCS" });
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]._id.toString()).toBe(survivorId);
    expect(afterSecond[0].price).toBe(survivorPrice);
  });

  it("treats a snapshot exactly at the 7-day boundary as recent (not rolled up), matching the strict $lt cutoff", async () => {
    // Deliberately at (now - 7 days) plus a comfortable margin so the async test run itself
    // doesn't tip it over the cutoff by the time rollup executes.
    const justInsideWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 60 * 1000);
    const snapshot = await PriceSnapshot.create({ symbol: "TCS", instrumentType: "stock", price: 9999, fetchedAt: justInsideWindow });

    await rollupOldPriceSnapshots();

    const stillThere = await PriceSnapshot.findById(snapshot._id);
    expect(stillThere).not.toBeNull();
  });
});

describe("schedulePriceRetention", () => {
  afterEach(async () => {
    const jobs = await priceRetentionQueue.getRepeatableJobs();
    await Promise.all(jobs.map((j) => priceRetentionQueue.removeRepeatableByKey(j.key)));
  });

  it("registers exactly one repeatable job even when called multiple times (e.g. on every server restart)", async () => {
    await schedulePriceRetention();
    await schedulePriceRetention();
    await schedulePriceRetention();

    const jobs = await priceRetentionQueue.getRepeatableJobs();
    expect(jobs).toHaveLength(1);
  });
});
