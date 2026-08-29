import { Worker } from "bullmq";
import { PriceSnapshot } from "../../models/PriceSnapshot.js";
import { setCached } from "../../lib/cache.js";
import { fetchStockPrice } from "../../modules/market-data/yahoo.client.js";
import { fetchMutualFundNav } from "../../modules/market-data/mfapi.client.js";
import { getStaleThresholdMs, priceCacheKey, type InstrumentType } from "../../modules/market-data/price-cache.service.js";
import { redisConnection } from "../../config/redis.js";

export interface PriceRefreshJobData {
  symbol: string;
  instrumentType: InstrumentType;
}

/**
 * The worker's testable core logic. On success: writes a `PriceSnapshot` AND updates
 * the Redis cache. On failure (after the client's internal `withRetry` exhausts its
 * attempts), this simply rejects — nothing is written, so any existing cached/stored
 * price for the symbol is left completely untouched (still queryable via
 * `getLatestPrice`). The rejection propagates to the BullMQ job processor, which marks
 * the job failed and lets BullMQ's own queue-level retry/backoff (configured in
 * `makeQueue`'s `defaultJobOptions`) take over — it does not crash the worker process.
 */
export async function processPriceRefreshJob(data: PriceRefreshJobData): Promise<void> {
  const price =
    data.instrumentType === "stock" ? await fetchStockPrice(data.symbol) : await fetchMutualFundNav(data.symbol);
  const fetchedAt = new Date();

  await PriceSnapshot.create({ instrumentType: data.instrumentType, symbol: data.symbol, price, fetchedAt });

  const ttlSeconds = Math.floor(getStaleThresholdMs(data.instrumentType) / 1000);
  await setCached(priceCacheKey(data.symbol), { price, fetchedAt: fetchedAt.toISOString() }, ttlSeconds);
}

/**
 * Constructs the BullMQ Worker for the "price-refresh" queue. Deliberately NOT
 * instantiated at module load time (unlike a naive top-level `export const worker =
 * new Worker(...)`) — that would open a real Redis connection and start listening for
 * jobs as a side effect of simply importing this file, including in unit tests that
 * only want `processPriceRefreshJob`. Call this explicitly from wherever the app wires
 * up its background workers.
 */
export function startPriceRefreshWorker(): Worker<PriceRefreshJobData> {
  return new Worker<PriceRefreshJobData>("price-refresh", async (job) => processPriceRefreshJob(job.data), {
    connection: redisConnection,
  });
}
