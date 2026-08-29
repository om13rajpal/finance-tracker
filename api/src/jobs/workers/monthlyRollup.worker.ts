import { Worker } from "bullmq";
import { Account } from "../../models/Account.js";
import { rollupMonth } from "../../modules/dashboard/monthly-rollup.service.js";
import { makeQueue, makeWorker } from "../queue.js";

/**
 * "YYYY-MM" for the month immediately before `now`, computed in UTC — matching the
 * UTC-consistent date treatment used throughout this codebase (see `month-range.ts`'s
 * `monthRangeUtc` doc comment). Using local time here would make which month counts as
 * "just completed" shift depending on where the API process happens to be deployed/run.
 *
 * `Date.UTC` normalizes an out-of-range month component itself, so `getUTCMonth() - 1`
 * on a January date rolls back to December of the PREVIOUS year rather than needing
 * special-cased year-boundary handling: e.g. `now` = 2026-01-15 -> `getUTCMonth()` is 0
 * -> `Date.UTC(2026, -1, 1)` -> 2025-12-01 -> `"2025-12"`.
 *
 * Takes `now` as a parameter (defaulting to the real current time) so tests can assert
 * the exact month this resolves to without mocking global time.
 */
export function previousMonthString(now: Date = new Date()): string {
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return prevMonth.toISOString().slice(0, 7);
}

/**
 * Rolls up the just-completed previous month for every user who has at least one
 * `Account` — a user's transactions always reference an `accountId` (Task 10), so a
 * user with any transaction activity necessarily has an account; this avoids rolling
 * up (and creating an all-zero `MonthlySummary` for) a user who has never used the app.
 * Each user's rollup runs independently so one failure doesn't abort the batch; a
 * rejection here fails the whole BullMQ job, which is left to the queue's own
 * attempts/backoff (`makeQueue`'s `defaultJobOptions`) to retry.
 */
export async function rollupPreviousMonthForAllUsers(): Promise<void> {
  const userIds: string[] = await Account.distinct("userId");
  const month = previousMonthString();

  for (const userId of userIds) {
    await rollupMonth(userId, month);
  }
}

export const monthlyRollupQueue = makeQueue<Record<string, never>>("monthly-rollup");

/**
 * Constructs the BullMQ Worker that processes monthly-rollup jobs. Deliberately NOT
 * instantiated at module load time (same reasoning as `startRecurringDueWorker` in
 * recurringDue.worker.ts and `startGmailWatchRenewalWorker` in
 * gmailWatchRenewal.worker.ts) — a top-level `export const monthlyRollupWorker =
 * makeWorker(...)` would open a real Redis-backed listener as a side effect of simply
 * importing this module, including from this task's own test file, which only needs
 * `rollupPreviousMonthForAllUsers`/`previousMonthString`. Call this explicitly from
 * wherever the app wires up its background workers.
 */
export function startMonthlyRollupWorker(): Worker<Record<string, never>> {
  return makeWorker<Record<string, never>>("monthly-rollup", async () => {
    await rollupPreviousMonthForAllUsers();
  });
}

/**
 * Registers the monthly repeatable rollup job: 2am UTC on the 1st of every month.
 * Safe to call on every server restart — BullMQ derives the repeatable job's dedup key
 * deterministically from the job name + repeat options, so repeated calls with the same
 * name and cron pattern upsert the same schedule instead of registering a duplicate
 * (see the identical reasoning documented on `scheduleRecurringDueChecks`).
 */
export async function scheduleMonthlyRollup(): Promise<void> {
  await monthlyRollupQueue.add("rollup", {}, { repeat: { pattern: "0 2 1 * *", tz: "UTC" } });
}
