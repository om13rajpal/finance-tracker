import type { Worker } from "bullmq";
import { startPriceRefreshWorker } from "./workers/priceRefresh.worker.js";
import {
  startPriceRefreshFanoutWorker,
  schedulePriceRefreshFanout,
} from "./workers/priceRefreshFanout.worker.js";
import {
  startRecurringDueWorker,
  scheduleRecurringDueChecks,
} from "./workers/recurringDue.worker.js";
import {
  startGmailWatchRenewalWorker,
  scheduleGmailWatchRenewal,
} from "./workers/gmailWatchRenewal.worker.js";
import { startGmailEmailParseWorker } from "./workers/gmailEmailParse.worker.js";
import {
  startMonthlyRollupWorker,
  scheduleMonthlyRollup,
} from "./workers/monthlyRollup.worker.js";
import {
  startPriceRetentionWorker,
  schedulePriceRetention,
} from "./workers/priceRetention.worker.js";
import { startStatementProcessWorker } from "./workers/statementProcess.worker.js";
import { startBulkConfirmPendingWorker } from "./workers/bulkConfirmPending.worker.js";

/**
 * The subset of BullMQ's `Worker<T>` interface callers of
 * `startBackgroundWorkers` actually need. BullMQ's `Worker<T>` is invariant
 * in `T` (its methods both accept and return `T`), so the 8
 * differently-typed workers started below have no common non-`any`
 * supertype — but every one of them satisfies this narrower, `T`-free
 * shape, which is all a caller (this app's shutdown path, or a test closing
 * everything it started) needs: the ability to close it and know it's
 * running.
 */
export interface ManagedWorker {
  isRunning(): boolean;
  close(): Promise<void>;
}

/**
 * Starts one background worker and (if it has one) registers its repeatable
 * schedule, both wrapped in a single try/catch. A synchronous throw from
 * `start()` (constructing the BullMQ `Worker`) or a rejection from
 * `schedule()` (registering the repeatable job) is logged and swallowed
 * here — this runs during app startup, before Express begins listening, so
 * one bad worker must never prevent the HTTP server (or the other workers)
 * from coming up. Job-processing failures once a worker is running have
 * their own retry/backoff (BullMQ's `defaultJobOptions` in `queue.ts`) and
 * are not this function's concern — this is just a simple startup guard,
 * not a retry system.
 */
async function startOne<T>(
  label: string,
  start: () => Worker<T>,
  schedule?: () => Promise<void>
): Promise<ManagedWorker | undefined> {
  try {
    const worker = start();
    console.log(`[workers] started "${label}" worker`);

    if (schedule) {
      await schedule();
      console.log(`[workers] registered schedule for "${label}"`);
    }

    return worker;
  } catch (err) {
    console.error(`[workers] failed to start "${label}" worker:`, err);
    return undefined;
  }
}

/**
 * Starts all 9 background BullMQ workers (price-refresh, price-refresh-fanout,
 * recurring-due, gmail-watch-renewal, gmail-email-parse, monthly-rollup,
 * price-retention, statement-process, bulk-confirm-pending) and registers the
 * repeatable schedules for the 5 of them that have one. Each worker's own `start*Worker()` factory
 * is deliberately lazy (see each worker file's doc comment) so this is the
 * single place in the running app that actually calls them.
 *
 * Returns the workers that started successfully (omitting any that failed),
 * so a caller — this app's `main()`, or a test — can close them.
 */
export async function startBackgroundWorkers(): Promise<ManagedWorker[]> {
  const workers = await Promise.all([
    startOne("price-refresh", startPriceRefreshWorker),
    startOne("price-refresh-fanout", startPriceRefreshFanoutWorker, schedulePriceRefreshFanout),
    startOne("recurring-due", startRecurringDueWorker, scheduleRecurringDueChecks),
    startOne("gmail-watch-renewal", startGmailWatchRenewalWorker, scheduleGmailWatchRenewal),
    startOne("gmail-email-parse", startGmailEmailParseWorker),
    startOne("monthly-rollup", startMonthlyRollupWorker, scheduleMonthlyRollup),
    startOne("price-retention", startPriceRetentionWorker, schedulePriceRetention),
    startOne("statement-process", startStatementProcessWorker),
    startOne("bulk-confirm-pending", startBulkConfirmPendingWorker),
  ]);

  return workers.filter((w): w is ManagedWorker => w !== undefined);
}
