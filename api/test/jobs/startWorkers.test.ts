import { describe, it, expect, afterEach } from "vitest";
import { startBackgroundWorkers } from "../../src/jobs/startWorkers.js";
import { makeQueue } from "../../src/jobs/queue.js";
import { recurringDueQueue } from "../../src/jobs/workers/recurringDue.worker.js";
import { gmailWatchRenewalQueue } from "../../src/jobs/workers/gmailWatchRenewal.worker.js";
import { monthlyRollupQueue } from "../../src/jobs/workers/monthlyRollup.worker.js";
import { priceRetentionQueue } from "../../src/jobs/workers/priceRetention.worker.js";
import { priceRefreshFanoutQueue } from "../../src/jobs/workers/priceRefreshFanout.worker.js";

// The 9 queues every worker wired up by `startBackgroundWorkers` listens on.
const ALL_QUEUE_NAMES = [
  "price-refresh",
  "price-refresh-fanout",
  "recurring-due",
  "gmail-watch-renewal",
  "gmail-email-parse",
  "monthly-rollup",
  "price-retention",
  "statement-process",
  "bulk-confirm-pending",
];

// The 5 of those 9 whose worker file also registers a repeatable schedule
// (price-refresh, gmail-email-parse, statement-process, and
// bulk-confirm-pending don't — their jobs are enqueued by the fan-out
// producer / by the webhook route / by the PDF upload route / by the
// bulk-confirm route instead, not on a timer).
const SCHEDULED_QUEUES = [
  { name: "price-refresh-fanout", queue: priceRefreshFanoutQueue },
  { name: "recurring-due", queue: recurringDueQueue },
  { name: "gmail-watch-renewal", queue: gmailWatchRenewalQueue },
  { name: "monthly-rollup", queue: monthlyRollupQueue },
  { name: "price-retention", queue: priceRetentionQueue },
];

/**
 * Polls `fn` until it resolves truthy or `timeoutMs` elapses. Needed because
 * a freshly-constructed BullMQ `Worker`'s `isRunning()` flips true
 * synchronously (see `run()` in bullmq's Worker class — `this.running = true`
 * is the first statement, before any `await`), but the *Redis-visible*
 * signal this test also checks (`Queue#getWorkersCount`, via `CLIENT LIST`)
 * depends on the worker's blocking connection finishing its own async
 * handshake with Redis, which lags isRunning() by a small, real amount of
 * time. A fixed sleep would either be too short (flaky) or too long (slow);
 * polling adapts to however long that handshake actually takes.
 */
async function waitFor(fn: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("startBackgroundWorkers", () => {
  // The 5 workers above register an idempotent repeatable schedule every time
  // they start (that's the point — safe on every server restart), so this
  // test leaves one behind in the shared local Redis on every run unless it
  // cleans up after itself, same as each worker's own dedicated test file
  // (e.g. test/modules/recurring.test.ts) already does for its one queue.
  afterEach(async () => {
    await Promise.all(
      SCHEDULED_QUEUES.map(async ({ queue }) => {
        const jobs = await queue.getRepeatableJobs();
        await Promise.all(jobs.map((j) => queue.removeRepeatableByKey(j.key)));
      })
    );
  });

  it(
    "starts a real, Redis-listening worker for all 9 queues and registers the 5 repeatable schedules",
    async () => {
      const workers = await startBackgroundWorkers();

      try {
        // All 9 start*Worker() factories ran without throwing.
        expect(workers).toHaveLength(9);

        // In-process: every returned worker is actually running, not merely
        // constructed (a worker whose start() call threw is never in this array).
        for (const worker of workers) {
          expect(worker.isRunning()).toBe(true);
        }

        // Redis-side: independent confirmation that each of the 9 queues has a
        // connected worker client, using BullMQ's own `getWorkersCount` (backed by
        // `CLIENT LIST`) rather than trusting in-process state alone. This also
        // exercises the queues (price-refresh, gmail-email-parse, statement-process,
        // bulk-confirm-pending) that don't have a schedule to check via
        // getRepeatableJobs below.
        const probeQueues = ALL_QUEUE_NAMES.map((name) => makeQueue(name));
        try {
          await Promise.all(
            probeQueues.map((queue, i) =>
              waitFor(async () => (await queue.getWorkersCount()) > 0).catch((err) => {
                throw new Error(`queue "${ALL_QUEUE_NAMES[i]}" never showed a listening worker: ${err}`);
              })
            )
          );
        } finally {
          await Promise.all(probeQueues.map((q) => q.close()));
        }

        // The 5 workers that register a repeatable schedule actually did so.
        for (const { name, queue } of SCHEDULED_QUEUES) {
          const repeatables = await queue.getRepeatableJobs();
          expect(repeatables.length, `expected a repeatable job on queue "${name}"`).toBeGreaterThanOrEqual(1);
        }
      } finally {
        // Close every worker this test started so it doesn't leak Redis
        // connections or leave listeners running past the end of the test.
        await Promise.all(workers.map((w) => w.close()));
      }
    },
    20000
  );
});
