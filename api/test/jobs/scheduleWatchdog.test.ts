import { describe, it, expect, afterEach } from "vitest";
import { reregisterMissingSchedules, startScheduleWatchdog } from "../../src/jobs/scheduleWatchdog.js";
import { priceRefreshFanoutQueue, schedulePriceRefreshFanout } from "../../src/jobs/workers/priceRefreshFanout.worker.js";
import { recurringDueQueue, scheduleRecurringDueChecks } from "../../src/jobs/workers/recurringDue.worker.js";
import { gmailWatchRenewalQueue, scheduleGmailWatchRenewal } from "../../src/jobs/workers/gmailWatchRenewal.worker.js";
import { monthlyRollupQueue, scheduleMonthlyRollup } from "../../src/jobs/workers/monthlyRollup.worker.js";
import { priceRetentionQueue, schedulePriceRetention } from "../../src/jobs/workers/priceRetention.worker.js";

// Mirrors scheduleWatchdog.ts's own SCHEDULES table — this is the test's
// independent source of truth for which queue/job-name/schedule-fn triple
// each of the 5 labels maps to, so a bug that silently drops one of them
// from the real table would still be caught here.
const ALL = [
  { label: "price-refresh-fanout", queue: priceRefreshFanoutQueue, schedule: schedulePriceRefreshFanout },
  { label: "recurring-due", queue: recurringDueQueue, schedule: scheduleRecurringDueChecks },
  { label: "gmail-watch-renewal", queue: gmailWatchRenewalQueue, schedule: scheduleGmailWatchRenewal },
  { label: "monthly-rollup", queue: monthlyRollupQueue, schedule: scheduleMonthlyRollup },
  { label: "price-retention", queue: priceRetentionQueue, schedule: schedulePriceRetention },
];

async function clearAllRepeatables(): Promise<void> {
  await Promise.all(
    ALL.map(async ({ queue }) => {
      const jobs = await queue.getRepeatableJobs();
      await Promise.all(jobs.map((j) => queue.removeRepeatableByKey(j.key)));
    })
  );
}

async function countRepeatables(queue: (typeof ALL)[number]["queue"]): Promise<number> {
  return (await queue.getRepeatableJobs()).length;
}

/** Polls `fn` until it returns truthy or `timeoutMs` elapses — same pattern
 * `startWorkers.test.ts` uses for a real, timer-driven async condition. */
async function waitFor(fn: () => Promise<boolean>, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("reregisterMissingSchedules", () => {
  afterEach(async () => {
    await clearAllRepeatables();
  });

  it("does nothing and reports nothing healed when all 5 schedules are already present", async () => {
    await Promise.all(ALL.map(({ schedule }) => schedule()));

    const healed = await reregisterMissingSchedules();

    expect(healed).toEqual([]);
    for (const { queue } of ALL) {
      expect(await countRepeatables(queue)).toBe(1);
    }
  });

  it("re-registers a single schedule that went missing (an independent Redis restart wiping just its bookkeeping)", async () => {
    await Promise.all(ALL.map(({ schedule }) => schedule()));

    // Simulate the exact failure mode this watchdog exists for: the
    // schedule's own repeatable-job entry is gone (as it would be after a
    // no-persistence Redis restart), even though nothing about THIS
    // process changed.
    const target = ALL.find((s) => s.label === "recurring-due")!;
    const [job] = await target.queue.getRepeatableJobs();
    await target.queue.removeRepeatableByKey(job.key);
    expect(await countRepeatables(target.queue)).toBe(0);

    const healed = await reregisterMissingSchedules();

    expect(healed).toEqual(["recurring-due"]);
    expect(await countRepeatables(target.queue)).toBe(1);
    // Every other schedule was untouched — still exactly one entry each,
    // not zero (wrongly removed) and not two (wrongly duplicated).
    for (const { label, queue } of ALL) {
      if (label === "recurring-due") continue;
      expect(await countRepeatables(queue)).toBe(1);
    }
  });

  it("re-registers all 5 when none exist yet (a freshly provisioned or fully wiped Redis)", async () => {
    // Nothing seeded at all — the scenario right after swapping to a brand
    // new Redis instance, before the API process has ever booted against it.
    const healed = await reregisterMissingSchedules();

    expect(healed.sort()).toEqual(
      ["gmail-watch-renewal", "monthly-rollup", "price-refresh-fanout", "price-retention", "recurring-due"].sort()
    );
    for (const { queue } of ALL) {
      expect(await countRepeatables(queue)).toBe(1);
    }
  });

  it("never creates a duplicate when called repeatedly back to back", async () => {
    await reregisterMissingSchedules();
    const secondCall = await reregisterMissingSchedules();

    expect(secondCall).toEqual([]);
    for (const { queue } of ALL) {
      expect(await countRepeatables(queue)).toBe(1);
    }
  });
});

describe("startScheduleWatchdog", () => {
  afterEach(async () => {
    await clearAllRepeatables();
  });

  it("periodically heals a missing schedule on its own, and stops doing so once stopped", async () => {
    await Promise.all(ALL.map(({ schedule }) => schedule()));

    const target = ALL.find((s) => s.label === "monthly-rollup")!;
    const [job] = await target.queue.getRepeatableJobs();
    await target.queue.removeRepeatableByKey(job.key);
    expect(await countRepeatables(target.queue)).toBe(0);

    const watchdog = startScheduleWatchdog(50);
    try {
      await waitFor(async () => (await countRepeatables(target.queue)) === 1, 2000);
    } finally {
      watchdog.stop();
    }

    // Wipe it again, now that the watchdog is stopped — it must NOT come
    // back on its own, proving `.stop()` actually cancelled the interval
    // rather than merely being a no-op.
    const [job2] = await target.queue.getRepeatableJobs();
    await target.queue.removeRepeatableByKey(job2.key);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await countRepeatables(target.queue)).toBe(0);
  });

  it("stop() is safe to call more than once", async () => {
    const watchdog = startScheduleWatchdog(50);
    watchdog.stop();
    expect(() => watchdog.stop()).not.toThrow();
  });
});
