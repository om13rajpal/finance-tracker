import { Worker } from "bullmq";
import { GmailConnection } from "../../models/GmailConnection.js";
import { registerWatch } from "../../modules/email-ingestion/gmail-watch.service.js";
import { makeQueue, makeWorker } from "../queue.js";

const RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Renews every `connected` Gmail watch expiring within the next 24 hours
 * (Gmail watches expire after ~7 days; this runs daily, so a 24h buffer
 * comfortably covers one day's worth of drift between runs).
 *
 * `status: "connected"` is part of the query itself, not a post-filter, so a
 * `disconnected` connection is never renewed even if its stale
 * `watchExpiration` from before disconnect still looks "expiring soon".
 *
 * Each connection is renewed independently inside its own try/catch: one
 * user's failure (revoked token, transient network error, etc.) is logged
 * and skipped rather than aborting the whole batch, so every other eligible
 * connection still gets attempted in the same run.
 */
export async function renewExpiringWatches(): Promise<void> {
  const expiringSoon = await GmailConnection.find({
    status: "connected",
    watchExpiration: { $lte: new Date(Date.now() + RENEWAL_WINDOW_MS) },
  });

  for (const connection of expiringSoon) {
    try {
      await registerWatch(connection.userId);
    } catch (err) {
      console.error(`Failed to renew Gmail watch for user ${connection.userId}:`, err);
    }
  }
}

export const gmailWatchRenewalQueue = makeQueue<Record<string, never>>("gmail-watch-renewal");

/**
 * Constructs the BullMQ Worker that processes renewal jobs. Deliberately NOT
 * instantiated at module load time (same reasoning as `startRecurringDueWorker`
 * in recurringDue.worker.ts) — a top-level `export const gmailWatchRenewalWorker
 * = makeWorker(...)` would open a real Redis-backed listener as a side effect of
 * simply importing this module, including from this task's own test file, which
 * only needs `renewExpiringWatches`. Call this explicitly from wherever the app
 * wires up its background workers.
 */
export function startGmailWatchRenewalWorker(): Worker<Record<string, never>> {
  return makeWorker<Record<string, never>>("gmail-watch-renewal", async () => {
    await renewExpiringWatches();
  });
}

/**
 * Registers the daily repeatable renewal job. Safe to call on every server
 * restart — BullMQ derives the repeatable job's dedup key deterministically
 * from the job name + repeat options, so repeated calls with the same name
 * and `every` upsert the same schedule instead of registering a duplicate
 * (see the identical reasoning documented on `scheduleRecurringDueChecks`).
 */
export async function scheduleGmailWatchRenewal(): Promise<void> {
  await gmailWatchRenewalQueue.add("renew", {}, { repeat: { every: 24 * 60 * 60 * 1000 } });
}
