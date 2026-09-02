import type { Queue } from "bullmq";
import { priceRefreshFanoutQueue, schedulePriceRefreshFanout } from "./workers/priceRefreshFanout.worker.js";
import { recurringDueQueue, scheduleRecurringDueChecks } from "./workers/recurringDue.worker.js";
import { gmailWatchRenewalQueue, scheduleGmailWatchRenewal } from "./workers/gmailWatchRenewal.worker.js";
import { monthlyRollupQueue, scheduleMonthlyRollup } from "./workers/monthlyRollup.worker.js";
import { priceRetentionQueue, schedulePriceRetention } from "./workers/priceRetention.worker.js";

/**
 * The 5 repeatable schedules `startBackgroundWorkers` registers at boot:
 * see each worker file's own `schedule*` doc comment for why re-registering
 * one is always safe (BullMQ upserts by a deterministic dedup key derived
 * from the job name + repeat options, never adds a duplicate).
 *
 * `jobName` is the literal first argument each `schedule*` function passes
 * to its queue's `.add(...)`: it's what a repeatable job entry's own
 * `.name` is checked against below, since `getRepeatableJobs()` returns
 * every repeatable entry on a queue, not just this app's one.
 */
const SCHEDULES: { label: string; queue: Queue; jobName: string; reschedule: () => Promise<void> }[] = [
  { label: "price-refresh-fanout", queue: priceRefreshFanoutQueue, jobName: "fanout", reschedule: schedulePriceRefreshFanout },
  { label: "recurring-due", queue: recurringDueQueue, jobName: "check", reschedule: scheduleRecurringDueChecks },
  { label: "gmail-watch-renewal", queue: gmailWatchRenewalQueue, jobName: "renew", reschedule: scheduleGmailWatchRenewal },
  { label: "monthly-rollup", queue: monthlyRollupQueue, jobName: "rollup", reschedule: scheduleMonthlyRollup },
  { label: "price-retention", queue: priceRetentionQueue, jobName: "rollup", reschedule: schedulePriceRetention },
];

/**
 * The self-healing half of the fix for a real gap: `startBackgroundWorkers`
 * only ever re-registers these 5 repeatable schedules when the API PROCESS
 * itself boots. BullMQ's repeatable-job bookkeeping lives entirely in
 * Redis, not in this process, so if Redis restarts (or is swapped, or
 * loses its data some other way) WITHOUT the API process also restarting,
 * every one of these 5 schedules silently stops existing, and nothing
 * would have re-registered them until the API's own next restart. On a
 * plan with no data persistence (see `render.yaml`'s Redis setup after the
 * September 2026 Upstash-quota incident), that's a real, not theoretical,
 * gap: this Redis can restart independently of the web service at any time.
 *
 * Checks each of the 5 schedules for a matching-`name` repeatable job entry
 * on its own queue and re-registers exactly the ones missing; never
 * touches a schedule that's already present (an unconditional re-add would
 * be harmless too, since it's idempotent, but only reporting genuine gaps
 * keeps the watchdog's own log output meaningful instead of noise every run).
 *
 * Returns the labels of whatever got re-registered, `[]` when everything
 * was already fine; this is what `startScheduleWatchdog` logs.
 */
export async function reregisterMissingSchedules(): Promise<string[]> {
  const healed: string[] = [];

  for (const schedule of SCHEDULES) {
    const existing = await schedule.queue.getRepeatableJobs();
    const present = existing.some((job) => job.name === schedule.jobName);
    if (!present) {
      await schedule.reschedule();
      healed.push(schedule.label);
    }
  }

  return healed;
}

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes; see doc comment below.

export interface ScheduleWatchdog {
  /** Stops the periodic check. Idempotent: safe to call more than once. */
  stop(): void;
}

/**
 * Starts the periodic check. 10 minutes by default: short enough that a
 * schedule lost to an independent Redis restart is self-healed quickly
 * relative to the shortest real schedule it's protecting (price-refresh-fanout,
 * every 30 minutes; see `priceRefreshFanout.worker.ts`), long enough that the
 * check itself (5 cheap `getRepeatableJobs()` reads, only occasionally
 * followed by a write) is negligible load on whatever Redis this app is
 * pointed at: a deliberate concern after the exact kind of Redis
 * request-volume incident this app hit once already.
 *
 * A failed check (Redis genuinely unreachable, say) is logged and swallowed,
 * never thrown: this runs unattended on an interval with nothing to catch
 * it, and a transient failure should just be retried on the next tick, not
 * crash the process one interval after start.
 *
 * Call `.stop()` on the returned handle to cancel (a test's own cleanup;
 * this app's `index.ts` never needs to, since it runs for the process's
 * whole lifetime). The interval is `unref()`'d so it can never, on its own,
 * keep the Node process alive past everything else finishing.
 */
export function startScheduleWatchdog(intervalMs = DEFAULT_INTERVAL_MS): ScheduleWatchdog {
  const timer = setInterval(() => {
    reregisterMissingSchedules()
      .then((healed) => {
        if (healed.length > 0) {
          console.log(`[schedule-watchdog] re-registered missing schedule(s): ${healed.join(", ")}`);
        }
      })
      .catch((err) => {
        console.error("[schedule-watchdog] failed to check schedules:", err);
      });
  }, intervalMs);
  timer.unref();

  return { stop: () => clearInterval(timer) };
}
