import { Worker } from "bullmq";
import { rollupOldPriceSnapshots } from "../../modules/market-data/price-retention.service.js";
import { makeQueue, makeWorker } from "../queue.js";

export const priceRetentionQueue = makeQueue<Record<string, never>>("price-retention");

/**
 * Constructs the BullMQ Worker that processes price-retention rollup jobs. Deliberately
 * NOT instantiated at module load time (same reasoning as `startMonthlyRollupWorker` in
 * monthlyRollup.worker.ts and `startRecurringDueWorker` in recurringDue.worker.ts) — a
 * top-level `export const priceRetentionWorker = makeWorker(...)` would open a real
 * Redis-backed listener as a side effect of simply importing this module, including from
 * this task's own test file, which only needs `rollupOldPriceSnapshots`/`priceRetentionQueue`.
 * Call this explicitly from wherever the app wires up its background workers.
 */
export function startPriceRetentionWorker(): Worker<Record<string, never>> {
  return makeWorker<Record<string, never>>("price-retention", async () => {
    await rollupOldPriceSnapshots();
  });
}

/**
 * Registers the daily repeatable rollup job. Safe to call on every server restart — BullMQ
 * derives the repeatable job's dedup key deterministically from the job name + repeat options
 * (same reasoning documented on `scheduleRecurringDueChecks`/`scheduleMonthlyRollup`), so
 * repeated calls with the same name and `every` upsert the same schedule instead of
 * registering a duplicate.
 */
export async function schedulePriceRetention(): Promise<void> {
  await priceRetentionQueue.add("rollup", {}, { repeat: { every: 24 * 60 * 60 * 1000 } });
}
