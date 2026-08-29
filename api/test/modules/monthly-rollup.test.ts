import { describe, it, expect, afterEach } from "vitest";
import { Account } from "../../src/models/Account.js";
import { Transaction } from "../../src/models/Transaction.js";
import { MonthlySummary } from "../../src/models/MonthlySummary.js";
import { rollupMonth } from "../../src/modules/dashboard/monthly-rollup.service.js";
import {
  previousMonthString,
  rollupPreviousMonthForAllUsers,
  monthlyRollupQueue,
  scheduleMonthlyRollup,
} from "../../src/jobs/workers/monthlyRollup.worker.js";

type ByCategoryRow = { categoryId: string | null; total: number };

describe("rollupMonth", () => {
  it("aggregates income, expense, and per-category totals for the given month", async () => {
    const userId = "user-rollup";

    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-salary", amount: 80000, date: new Date("2026-07-01"), source: "manual", status: "confirmed" });
    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-food", amount: -1500, date: new Date("2026-07-10"), source: "manual", status: "confirmed" });
    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-food", amount: -500, date: new Date("2026-07-15"), source: "manual", status: "confirmed" });
    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-rent", amount: -20000, date: new Date("2026-07-01"), source: "manual", status: "confirmed" });
    // outside the target month — must be excluded
    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-food", amount: -999, date: new Date("2026-06-15"), source: "manual", status: "confirmed" });

    await rollupMonth(userId, "2026-07");

    const summary = await MonthlySummary.findOne({ userId, month: "2026-07" });
    expect(summary?.totalIncome).toBe(80000);
    expect(summary?.totalExpense).toBe(22000);
    const foodRow = summary?.byCategory.find((c: ByCategoryRow) => c.categoryId === "cat-food");
    expect(foodRow?.total).toBe(2000);
    const rentRow = summary?.byCategory.find((c: ByCategoryRow) => c.categoryId === "cat-rent");
    expect(rentRow?.total).toBe(20000);
  });

  it("boundary: a transaction on the first instant of the next month is excluded, one on the last day of the target month is included", async () => {
    const userId = "user-boundary";

    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-food", amount: -100, date: new Date("2026-07-31T23:59:59.999Z"), source: "manual", status: "confirmed" });
    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-food", amount: -200, date: new Date("2026-08-01T00:00:00.000Z"), source: "manual", status: "confirmed" });

    await rollupMonth(userId, "2026-07");

    const summary = await MonthlySummary.findOne({ userId, month: "2026-07" });
    expect(summary?.totalExpense).toBe(100);
  });

  it("groups an uncategorized (categoryId: null) transaction under a null-keyed row instead of dropping it or crashing", async () => {
    const userId = "user-uncat";

    await Transaction.create({ userId, accountId: "acc-1", categoryId: null, amount: -300, date: new Date("2026-07-05"), source: "manual", status: "confirmed" });
    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-food", amount: -700, date: new Date("2026-07-06"), source: "manual", status: "confirmed" });

    await rollupMonth(userId, "2026-07");

    const summary = await MonthlySummary.findOne({ userId, month: "2026-07" });
    expect(summary?.totalExpense).toBe(1000);
    const uncatRow = summary?.byCategory.find((c: ByCategoryRow) => c.categoryId === null);
    expect(uncatRow?.total).toBe(300);
  });

  it("upserts: calling twice for the same user+month updates the single existing document rather than erroring or duplicating", async () => {
    const userId = "user-upsert";

    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-food", amount: -100, date: new Date("2026-07-05"), source: "manual", status: "confirmed" });
    await rollupMonth(userId, "2026-07");

    let count = await MonthlySummary.countDocuments({ userId, month: "2026-07" });
    expect(count).toBe(1);
    let summary = await MonthlySummary.findOne({ userId, month: "2026-07" });
    expect(summary?.totalExpense).toBe(100);

    // Data correction: another transaction lands in the same month, then we re-run the rollup.
    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-food", amount: -50, date: new Date("2026-07-06"), source: "manual", status: "confirmed" });
    await rollupMonth(userId, "2026-07");

    count = await MonthlySummary.countDocuments({ userId, month: "2026-07" });
    expect(count).toBe(1);
    summary = await MonthlySummary.findOne({ userId, month: "2026-07" });
    expect(summary?.totalExpense).toBe(150);
  });

  it("computes netWorth via computeFullNetWorth at rollup time", async () => {
    const userId = "user-networth";
    await Account.create({ userId, type: "bank", institution: "Test Bank", nickname: "Checking", currentBalance: 5000 });
    await Transaction.create({ userId, accountId: "acc-1", categoryId: "cat-food", amount: -100, date: new Date("2026-07-05"), source: "manual", status: "confirmed" });

    await rollupMonth(userId, "2026-07");

    const summary = await MonthlySummary.findOne({ userId, month: "2026-07" });
    expect(summary?.netWorth).toBe(5000);
  });

  it("produces a zero-totals summary for a month with no transactions, rather than throwing", async () => {
    const userId = "user-empty";

    await rollupMonth(userId, "2026-07");

    const summary = await MonthlySummary.findOne({ userId, month: "2026-07" });
    expect(summary?.totalIncome).toBe(0);
    expect(summary?.totalExpense).toBe(0);
    expect(summary?.byCategory).toEqual([]);
  });
});

describe("previousMonthString", () => {
  it("resolves to the month immediately before the given date, in UTC", () => {
    expect(previousMonthString(new Date("2026-08-15T12:00:00.000Z"))).toBe("2026-07");
  });

  it("rolls back across a year boundary: March 1 rolls up February, not January", () => {
    expect(previousMonthString(new Date("2026-03-01T02:00:00.000Z"))).toBe("2026-02");
  });

  it("rolls back across a year boundary: January resolves to December of the PREVIOUS year", () => {
    expect(previousMonthString(new Date("2026-01-15T00:00:00.000Z"))).toBe("2025-12");
  });
});

describe("rollupPreviousMonthForAllUsers", () => {
  it("rolls up every distinct account-holding user for the previous month", async () => {
    await Account.create({ userId: "user-a", type: "bank", institution: "Bank", nickname: "Checking", currentBalance: 1000 });
    await Account.create({ userId: "user-b", type: "bank", institution: "Bank", nickname: "Checking", currentBalance: 2000 });

    const now = new Date();
    const prevMonth = previousMonthString(now);
    const midPrevMonth = new Date(prevMonth + "-10T00:00:00.000Z");

    await Transaction.create({ userId: "user-a", accountId: "acc-1", categoryId: "cat-food", amount: -100, date: midPrevMonth, source: "manual", status: "confirmed" });
    await Transaction.create({ userId: "user-b", accountId: "acc-1", categoryId: "cat-food", amount: -200, date: midPrevMonth, source: "manual", status: "confirmed" });

    await rollupPreviousMonthForAllUsers();

    const summaryA = await MonthlySummary.findOne({ userId: "user-a", month: prevMonth });
    const summaryB = await MonthlySummary.findOne({ userId: "user-b", month: prevMonth });
    expect(summaryA?.totalExpense).toBe(100);
    expect(summaryB?.totalExpense).toBe(200);
  });
});

describe("scheduleMonthlyRollup", () => {
  afterEach(async () => {
    const jobs = await monthlyRollupQueue.getRepeatableJobs();
    await Promise.all(jobs.map((j) => monthlyRollupQueue.removeRepeatableByKey(j.key)));
  });

  it("registers exactly one repeatable job even when called multiple times (e.g. on every server restart)", async () => {
    await scheduleMonthlyRollup();
    await scheduleMonthlyRollup();
    await scheduleMonthlyRollup();

    const jobs = await monthlyRollupQueue.getRepeatableJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].pattern).toBe("0 2 1 * *");
  });
});
