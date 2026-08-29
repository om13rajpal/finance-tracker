import { Worker } from "bullmq";
import { makeQueue, makeWorker } from "../queue.js";
import { processDueRecurringTransactions } from "../../modules/recurring/recurring.service.js";

export const recurringDueQueue = makeQueue<Record<string, never>>("recurring-due");

/**
 * Constructs the BullMQ Worker that processes due-check jobs. Deliberately NOT instantiated
 * at module load time (same reasoning as `startPriceRefreshWorker` in Task 15's
 * priceRefresh.worker.ts) - a top-level `export const recurringDueWorker = makeWorker(...)`
 * would open a real Redis-backed listener as a side effect of simply importing this module,
 * including from this task's own test file. Call this explicitly from wherever the app wires
 * up its background workers.
 */
export function startRecurringDueWorker(): Worker<Record<string, never>> {
  return makeWorker<Record<string, never>>("recurring-due", async () => {
    await processDueRecurringTransactions();
  });
}

/**
 * Registers the hourly repeatable "check" job. Safe to call on every server restart: BullMQ
 * derives the repeatable job's dedup key deterministically from the job name + repeat options
 * (name, jobId, endDate, tz, pattern/every - see bullmq's Repeat.getRepeatConcatOptions and its
 * addRepeatableJob-2.lua script, which ZADDs the *same* member/key rather than adding a new
 * one). Since this always calls `.add("check", {}, { repeat: { every: 3600000 } })` with the
 * exact same name and `every`, repeated calls upsert the same repeatable schedule instead of
 * registering a second, duplicate one. Verified empirically in recurring.test.ts by calling
 * this three times and asserting `getRepeatableJobs()` still returns exactly one entry.
 */
export async function scheduleRecurringDueChecks(): Promise<void> {
  await recurringDueQueue.add("check", {}, { repeat: { every: 60 * 60 * 1000 } });
}
