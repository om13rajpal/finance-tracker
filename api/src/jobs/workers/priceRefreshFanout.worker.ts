import { Worker } from "bullmq";
import { makeQueue, makeWorker } from "../queue.js";
import { HoldingLot } from "../../models/HoldingLot.js";
import {
  getLatestPrice,
  getStaleThresholdMs,
  type InstrumentType,
} from "../../modules/market-data/price-cache.service.js";
import type { PriceRefreshJobData } from "./priceRefresh.worker.js";

/**
 * Producer side of the "price-refresh" queue.
 *
 * The price-refresh WORKER (priceRefresh.worker.ts) knows how to fetch and store one
 * symbol's price, but nothing in the app ever enqueued work for it — so without this
 * module `PriceSnapshot` stays empty forever, `getLatestPrice` always returns null,
 * and every holding permanently falls back to cost basis. This is the scheduled
 * producer the spec's "Market data refresh — scheduled BullMQ jobs" bullet calls for.
 *
 * Split across two queues deliberately, matching the one-job-shape-per-queue
 * convention used by every other worker here: "price-refresh-fanout" carries the
 * single repeatable trigger, "price-refresh" carries the per-symbol jobs it produces.
 */
export const priceRefreshQueue = makeQueue<PriceRefreshJobData>("price-refresh");
export const priceRefreshFanoutQueue = makeQueue<Record<string, never>>("price-refresh-fanout");

const FANOUT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Enqueues one refresh job per distinct symbol that is actually still held (any lot
 * with `remainingUnits > 0`), across all users — prices are shared, not per-user (see
 * the spec's `PriceSnapshot` note), so a symbol held by two users is fetched once.
 *
 * A symbol whose last known price is newer than HALF its own staleness threshold is
 * skipped. That single rule gives each instrument type roughly the cadence the spec
 * asks for without a second schedule: stocks (2h threshold) refresh about hourly,
 * mutual funds (2-day threshold) about daily — and it means the fan-out can run often
 * without repeatedly hammering Yahoo/mfapi for data that hasn't changed.
 *
 * Returns how many jobs were enqueued, so a caller (or a test) can tell "nothing was
 * due" apart from "nothing is held".
 */
export async function enqueueHeldSymbolRefreshes(): Promise<number> {
  const lots = await HoldingLot.find({ remainingUnits: { $gt: 0 } })
    .select("symbol instrumentType")
    .lean();

  const instrumentTypeBySymbol = new Map<string, InstrumentType>();
  for (const lot of lots) {
    instrumentTypeBySymbol.set(lot.symbol, lot.instrumentType as InstrumentType);
  }

  let enqueued = 0;
  for (const [symbol, instrumentType] of instrumentTypeBySymbol) {
    const latest = await getLatestPrice(symbol, instrumentType);
    const refreshAfterMs = getStaleThresholdMs(instrumentType) / 2;
    if (latest && Date.now() - latest.fetchedAt.getTime() < refreshAfterMs) continue;

    await priceRefreshQueue.add("refresh", { symbol, instrumentType });
    enqueued++;
  }

  return enqueued;
}

/**
 * Constructs the fan-out worker. Lazy for the same reason as every other worker
 * factory here — importing this module must not open a Redis listener as a side
 * effect. Call it from `startBackgroundWorkers`.
 */
export function startPriceRefreshFanoutWorker(): Worker<Record<string, never>> {
  return makeWorker<Record<string, never>>("price-refresh-fanout", async () => {
    const enqueued = await enqueueHeldSymbolRefreshes();
    console.log(`[price-refresh] fan-out enqueued ${enqueued} symbol refresh job(s)`);
  });
}

/**
 * Registers the repeatable fan-out. Safe to call on every server restart: BullMQ
 * derives a repeatable job's dedup key from its name + repeat options, so calling this
 * with the same name and `every` upserts the same schedule rather than stacking
 * duplicates (same property relied on by the other schedules here).
 */
export async function schedulePriceRefreshFanout(): Promise<void> {
  await priceRefreshFanoutQueue.add("fanout", {}, { repeat: { every: FANOUT_INTERVAL_MS } });
}
