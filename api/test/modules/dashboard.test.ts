import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { Category } from "../../src/models/Category.js";
import { RecurringTransaction } from "../../src/models/RecurringTransaction.js";
import { Transaction } from "../../src/models/Transaction.js";
import { Account } from "../../src/models/Account.js";
import { HoldingLot } from "../../src/models/HoldingLot.js";
import { PriceSnapshot } from "../../src/models/PriceSnapshot.js";
import { getCached, deleteCached } from "../../src/lib/cache.js";
import { computeGuiltFreeMoney } from "../../src/modules/dashboard/guilt-free.service.js";
import { computeFullNetWorth } from "../../src/modules/dashboard/net-worth.service.js";
import { computeBudgetVsSpend, DashboardResult } from "../../src/modules/dashboard/dashboard.service.js";
import { processDueRecurringTransactions } from "../../src/modules/recurring/recurring.service.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

// Real Redis is used (same convention as test/modules/market-data.test.ts) rather than a
// mock. Redis keys aren't part of test/setup.ts's per-test Mongo cleanup, so track and
// delete every dashboard cache key this file touches to prevent cross-test leakage.
const usedUserIds = new Set<string>();
function trackUser(userId: string): void {
  usedUserIds.add(userId);
}

afterEach(async () => {
  for (const userId of usedUserIds) {
    await deleteCached(`dashboard:${userId}`);
  }
  usedUserIds.clear();
});

describe("computeGuiltFreeMoney", () => {
  it("computes planned and spent guilt-free money for a month (brief's hand-constructed scenario)", async () => {
    const userId = "user-guilt-free";

    const salaryCategory = await Category.create({
      userId, name: "Salary", type: "income", bucket: "guilt_free", budgetLimit: 0,
    });
    const rentCategory = await Category.create({
      userId, name: "Rent", type: "expense", bucket: "fixed_costs", budgetLimit: 20000,
    });
    const diningCategory = await Category.create({
      userId, name: "Dining Out", type: "expense", bucket: "guilt_free", budgetLimit: 5000,
    });

    await RecurringTransaction.create({
      userId, name: "Salary", type: "income", amount: 80000, frequency: "monthly",
      nextDueDate: new Date("2026-09-01"), accountId: "acc-1", categoryId: salaryCategory._id.toString(),
      autoCreate: true, status: "active",
    });
    await RecurringTransaction.create({
      userId, name: "Rent", type: "expense", amount: 20000, frequency: "monthly",
      nextDueDate: new Date("2026-09-01"), accountId: "acc-1", categoryId: rentCategory._id.toString(),
      autoCreate: true, status: "active",
    });

    await Transaction.create({
      userId, accountId: "acc-1", categoryId: diningCategory._id.toString(),
      amount: -1200, date: new Date("2026-08-10"), source: "manual", status: "confirmed",
    });
    await Transaction.create({
      userId, accountId: "acc-1", categoryId: diningCategory._id.toString(),
      amount: -800, date: new Date("2026-08-15"), source: "manual", status: "confirmed",
    });

    const result = await computeGuiltFreeMoney(userId, "2026-08");

    expect(result.planned).toBe(60000);
    expect(result.spent).toBe(2000);
    expect(result.remaining).toBe(58000);
  });

  it("excludes paused/cancelled recurring items from planned, and transactions outside the month from spent", async () => {
    const userId = "user-guilt-free-2";
    const salaryCategory = await Category.create({ userId, name: "Salary", type: "income", bucket: "guilt_free", budgetLimit: 0 });
    const savingsCategory = await Category.create({ userId, name: "SIP", type: "expense", bucket: "savings", budgetLimit: 0 });
    const diningCategory = await Category.create({ userId, name: "Dining Out", type: "expense", bucket: "guilt_free", budgetLimit: 5000 });

    await RecurringTransaction.create({
      userId, name: "Salary", type: "income", amount: 50000, frequency: "monthly",
      nextDueDate: new Date("2026-09-01"), accountId: "acc-1", categoryId: salaryCategory._id.toString(),
      autoCreate: true, status: "active",
    });
    // Paused SIP must NOT count toward planned.
    await RecurringTransaction.create({
      userId, name: "Mutual Fund SIP", type: "expense", amount: 10000, frequency: "monthly",
      nextDueDate: new Date("2026-09-01"), accountId: "acc-1", categoryId: savingsCategory._id.toString(),
      autoCreate: true, status: "paused",
    });
    // In-month guilt-free spend.
    await Transaction.create({
      userId, accountId: "acc-1", categoryId: diningCategory._id.toString(),
      amount: -500, date: new Date("2026-08-20"), source: "manual", status: "confirmed",
    });
    // Out-of-month (July) guilt-free spend must NOT be counted in August's "spent".
    await Transaction.create({
      userId, accountId: "acc-1", categoryId: diningCategory._id.toString(),
      amount: -9999, date: new Date("2026-07-31"), source: "manual", status: "confirmed",
    });
    // Positive amount (e.g. a refund) in a guilt-free category must NOT count as spend.
    await Transaction.create({
      userId, accountId: "acc-1", categoryId: diningCategory._id.toString(),
      amount: 100, date: new Date("2026-08-05"), source: "manual", status: "confirmed",
    });

    const result = await computeGuiltFreeMoney(userId, "2026-08");
    expect(result.planned).toBe(50000); // paused SIP excluded entirely
    expect(result.spent).toBe(500);
    expect(result.remaining).toBe(49500);
  });

  it("does not count an income category's bucket as guilt-free spend even if it happens to be bucket:guilt_free", async () => {
    const userId = "user-guilt-free-3";
    // Salary is type:income but must carry a bucket value (required field) - here it's
    // guilt_free. This must never be treated as a guilt-free EXPENSE category.
    const salaryCategory = await Category.create({ userId, name: "Salary", type: "income", bucket: "guilt_free", budgetLimit: 0 });

    // A (contrived) transaction booked against the income category - should be excluded
    // from "spent" because the category's type is "income", not "expense".
    await Transaction.create({
      userId, accountId: "acc-1", categoryId: salaryCategory._id.toString(),
      amount: -5000, date: new Date("2026-08-05"), source: "manual", status: "confirmed",
    });

    const result = await computeGuiltFreeMoney(userId, "2026-08");
    expect(result.planned).toBe(0);
    expect(result.spent).toBe(0);
  });

  it("returns all zeros for a brand-new user with no categories/recurring items/transactions", async () => {
    const result = await computeGuiltFreeMoney("user-brand-new-guilt-free", "2026-08");
    expect(result).toEqual({ planned: 0, spent: 0, remaining: 0 });
  });
});

describe("computeFullNetWorth", () => {
  it("sums account net worth and priced holdings' current value", async () => {
    const userId = "user-net-worth";
    await Account.create({ userId, type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 100000, isLiability: false });
    await Account.create({ userId, type: "credit_card", institution: "ICICI", nickname: "Card", currentBalance: 5000, isLiability: true });

    await HoldingLot.create({
      userId, symbol: "TCS", platform: "zerodha", instrumentType: "stock",
      buyDate: new Date("2026-01-01"), buyPrice: 3000, units: 10, remainingUnits: 10,
    });
    await PriceSnapshot.create({ symbol: "TCS", instrumentType: "stock", price: 3500, fetchedAt: new Date() });

    // accounts: 100000 - 5000 = 95000. holdings: 10 * 3500 = 35000. total = 130000.
    const netWorth = await computeFullNetWorth(userId);
    expect(netWorth).toBe(130000);
  });

  it("falls back to cost basis (not 0, not NaN) for a holding with no fetched price yet", async () => {
    const userId = "user-net-worth-unpriced";
    await Account.create({ userId, type: "cash", institution: "Cash", nickname: "Wallet", currentBalance: 1000, isLiability: false });

    // No PriceSnapshot and nothing cached for this symbol at all.
    await HoldingLot.create({
      userId, symbol: "UNPRICED", platform: "other", instrumentType: "stock",
      buyDate: new Date("2026-01-01"), buyPrice: 100, units: 5, remainingUnits: 5,
    });

    // accounts: 1000. holdings fallback: 5 * 100 (avgCost * totalUnits) = 500. total = 1500.
    const netWorth = await computeFullNetWorth(userId);
    expect(netWorth).toBe(1500);
    expect(Number.isNaN(netWorth)).toBe(false);
  });

  it("returns 0 for a brand-new user with no accounts or holdings", async () => {
    const netWorth = await computeFullNetWorth("user-brand-new-net-worth");
    expect(netWorth).toBe(0);
  });
});

describe("computeBudgetVsSpend", () => {
  it("rolls a child category's spend up into its parent's total, and does not give the child its own row", async () => {
    const userId = "user-budget-rollup";
    const foodParent = await Category.create({ userId, name: "Food", type: "expense", bucket: "guilt_free", budgetLimit: 10000 });
    const diningChild = await Category.create({
      userId, name: "Dining Out", type: "expense", bucket: "guilt_free", budgetLimit: 0,
      parentCategoryId: foodParent._id,
    });
    const rentCategory = await Category.create({ userId, name: "Rent", type: "expense", bucket: "fixed_costs", budgetLimit: 20000 });

    // Spend directly on the parent.
    await Transaction.create({
      userId, accountId: "acc-1", categoryId: foodParent._id.toString(),
      amount: -1000, date: new Date("2026-08-03"), source: "manual", status: "confirmed",
    });
    // Spend on the CHILD - must roll up into the parent's total.
    await Transaction.create({
      userId, accountId: "acc-1", categoryId: diningChild._id.toString(),
      amount: -1500, date: new Date("2026-08-04"), source: "manual", status: "confirmed",
    });
    // Unrelated category's spend must not leak into Food's total.
    await Transaction.create({
      userId, accountId: "acc-1", categoryId: rentCategory._id.toString(),
      amount: -20000, date: new Date("2026-08-05"), source: "manual", status: "confirmed",
    });

    const rows = await computeBudgetVsSpend(userId, "2026-08");

    // Only top-level categories get a row - the child does not appear separately.
    expect(rows).toHaveLength(2);
    const foodRow = rows.find((r) => r.name === "Food")!;
    expect(foodRow.spent).toBe(2500); // 1000 (own) + 1500 (child) rolled up
    expect(foodRow.budgetLimit).toBe(10000);
    expect(rows.some((r) => r.name === "Dining Out")).toBe(false);

    const rentRow = rows.find((r) => r.name === "Rent")!;
    expect(rentRow.spent).toBe(20000);
  });

  it("returns an empty array for a brand-new user with no expense categories", async () => {
    const rows = await computeBudgetVsSpend("user-brand-new-budget", "2026-08");
    expect(rows).toEqual([]);
  });
});

describe("GET /dashboard", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns zeroed-out net worth, guilt-free money, and empty budgetVsSpend for a brand-new user", async () => {
    const userId = "user-dashboard-zero";
    trackUser(userId);
    const res = await request(app).get("/dashboard").set("Cookie", authCookie(userId));

    expect(res.status).toBe(200);
    const body: DashboardResult = res.body;
    expect(body.netWorth).toBe(0);
    expect(body.guiltFreeMoney).toEqual({ planned: 0, spent: 0, remaining: 0 });
    expect(body.budgetVsSpend).toEqual([]);
  });

  it("assembles netWorth, guiltFreeMoney, and budgetVsSpend together for a populated user", async () => {
    const userId = "user-dashboard-full";
    trackUser(userId);
    await Account.create({ userId, type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 50000, isLiability: false });

    const salaryCategory = await Category.create({ userId, name: "Salary", type: "income", bucket: "guilt_free", budgetLimit: 0 });
    const diningCategory = await Category.create({ userId, name: "Dining Out", type: "expense", bucket: "guilt_free", budgetLimit: 5000 });
    await RecurringTransaction.create({
      userId, name: "Salary", type: "income", amount: 40000, frequency: "monthly",
      nextDueDate: new Date("2026-09-01"), accountId: "acc-1", categoryId: salaryCategory._id.toString(),
      autoCreate: true, status: "active",
    });
    await Transaction.create({
      userId, accountId: "acc-1", categoryId: diningCategory._id.toString(),
      amount: -700, date: new Date(), source: "manual", status: "confirmed",
    });

    const res = await request(app).get("/dashboard").set("Cookie", authCookie(userId));
    expect(res.status).toBe(200);
    expect(res.body.netWorth).toBe(50000);
    expect(res.body.guiltFreeMoney.planned).toBe(40000);
    expect(res.body.guiltFreeMoney.spent).toBe(700);
    expect(res.body.budgetVsSpend).toHaveLength(1);
    expect(res.body.budgetVsSpend[0].spent).toBe(700);
  });

  it("caches the computed result under dashboard:<userId> and reuses it on a second request", async () => {
    const userId = "user-dashboard-cache";
    trackUser(userId);
    await Account.create({ userId, type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 1000, isLiability: false });

    const first = await request(app).get("/dashboard").set("Cookie", authCookie(userId));
    expect(first.body.netWorth).toBe(1000);

    const cached = await getCached<DashboardResult>(`dashboard:${userId}`);
    expect(cached).not.toBeNull();
    expect(cached!.netWorth).toBe(1000);

    // Mutate the account balance directly in Mongo, bypassing the API (and therefore
    // bypassing invalidateDashboardCache) - this proves the SECOND request is served
    // from cache rather than recomputed, since a live recompute would see 9000.
    await Account.updateOne({ userId }, { currentBalance: 9000 });

    const second = await request(app).get("/dashboard").set("Cookie", authCookie(userId));
    expect(second.body.netWorth).toBe(1000); // still the cached, stale value
  });
});

describe("cache invalidation across mutation call sites", () => {
  // Pre-warms the dashboard cache for a user (as GET /dashboard would), then asserts
  // it was actually cleared as a direct, observable side effect of the mutation - not
  // merely that invalidateDashboardCache exists as a function.
  async function primeCache(userId: string) {
    trackUser(userId);
    await request(app).get("/dashboard").set("Cookie", authCookie(userId));
    expect(await getCached(`dashboard:${userId}`)).not.toBeNull();
  }

  it("POST /transactions clears the cached dashboard", async () => {
    const userId = "user-invalidate-txn-create";
    await primeCache(userId);
    await request(app)
      .post("/transactions")
      .set("Cookie", authCookie(userId))
      .send({ accountId: "acc-1", amount: -100, date: "2026-08-10", force: true });
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("PATCH /transactions/:id clears the cached dashboard", async () => {
    const userId = "user-invalidate-txn-patch";
    const txn = await Transaction.create({
      userId, accountId: "acc-1", amount: -100, date: new Date(), source: "manual", status: "confirmed",
    });
    await primeCache(userId);
    await request(app)
      .patch(`/transactions/${txn._id}`)
      .set("Cookie", authCookie(userId))
      .send({ amount: -200 });
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("DELETE /transactions/:id clears the cached dashboard", async () => {
    const userId = "user-invalidate-txn-delete";
    const txn = await Transaction.create({
      userId, accountId: "acc-1", amount: -100, date: new Date(), source: "manual", status: "confirmed",
    });
    await primeCache(userId);
    await request(app).delete(`/transactions/${txn._id}`).set("Cookie", authCookie(userId));
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("a 409 possible-duplicate response on POST /transactions does NOT clear the cache (nothing was written)", async () => {
    const userId = "user-invalidate-txn-duplicate";
    await Transaction.create({
      userId, accountId: "acc-1", amount: -100, date: new Date("2026-08-10"), source: "manual", status: "confirmed",
    });
    await primeCache(userId);
    const res = await request(app)
      .post("/transactions")
      .set("Cookie", authCookie(userId))
      .send({ accountId: "acc-1", amount: -100, date: "2026-08-10" });
    expect(res.status).toBe(409);
    expect(await getCached(`dashboard:${userId}`)).not.toBeNull();
  });

  it("POST /pending-transactions/:id/confirm clears the cached dashboard", async () => {
    const userId = "user-invalidate-pending-confirm";
    const { PendingTransaction } = await import("../../src/models/PendingTransaction.js");
    const pending = await PendingTransaction.create({
      userId, accountId: "acc-1", amount: -300, date: new Date(), merchant: "Test", note: "", source: "email_parsed",
    });
    await primeCache(userId);
    await request(app).post(`/pending-transactions/${pending._id}/confirm`).set("Cookie", authCookie(userId)).send({});
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("POST /accounts (create) clears the cached dashboard", async () => {
    const userId = "user-invalidate-account-create";
    await primeCache(userId);
    await request(app)
      .post("/accounts")
      .set("Cookie", authCookie(userId))
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 1000 });
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("PATCH /accounts/:id clears the cached dashboard", async () => {
    const userId = "user-invalidate-account-patch";
    const account = await Account.create({ userId, type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 1000, isLiability: false });
    await primeCache(userId);
    await request(app).patch(`/accounts/${account._id}`).set("Cookie", authCookie(userId)).send({ currentBalance: 2000 });
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("DELETE /accounts/:id clears the cached dashboard", async () => {
    const userId = "user-invalidate-account-delete";
    const account = await Account.create({ userId, type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 1000, isLiability: false });
    await primeCache(userId);
    await request(app).delete(`/accounts/${account._id}`).set("Cookie", authCookie(userId));
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("POST /accounts/:id/balance clears the cached dashboard", async () => {
    const userId = "user-invalidate-account-balance";
    const account = await Account.create({ userId, type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 1000, isLiability: false });
    await primeCache(userId);
    await request(app).post(`/accounts/${account._id}/balance`).set("Cookie", authCookie(userId)).send({ balance: 5000 });
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("POST /investments/import clears the cached dashboard", async () => {
    const userId = "user-invalidate-investments-import";
    await primeCache(userId);
    const csv = `Symbol,Trade Date,Trade Type,Quantity,Price\nTCS,01/08/2026,buy,5,3000\n`;
    await request(app)
      .post("/investments/import")
      .set("Cookie", authCookie(userId))
      .field("platform", "zerodha")
      .attach("file", Buffer.from(csv), "tradebook.csv");
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("POST /transactions/import (bank statement CSV) clears the cached dashboard", async () => {
    const userId = "user-invalidate-bank-csv-import";
    await primeCache(userId);
    const csv = `Date,Amount,Merchant,Note\n2026-08-05,-450,Amazon,Order\n`;
    await request(app)
      .post("/transactions/import")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", Buffer.from(csv), "statement.csv");
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("a recurring auto-create (scheduled worker, no HTTP request involved) clears the cached dashboard", async () => {
    const userId = "user-invalidate-recurring-autocreate";
    const category = await Category.create({ userId, name: "Rent", type: "expense", bucket: "fixed_costs", budgetLimit: 20000 });
    await RecurringTransaction.create({
      userId, name: "Rent", type: "expense", amount: 20000, frequency: "monthly",
      nextDueDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // due yesterday
      accountId: "acc-1", categoryId: category._id.toString(), autoCreate: true, status: "active",
    });
    await primeCache(userId);

    await processDueRecurringTransactions();

    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  // RecurringTransaction feeds computeGuiltFreeMoney's "planned" figure directly (see
  // guilt-free.service.ts), so create/update/delete on /recurring must clear the cache
  // just like every other mutation route - otherwise a newly added or paused recurring
  // item wouldn't affect the dashboard's "planned" number for up to the 5-minute TTL.
  it("POST /recurring clears the cached dashboard", async () => {
    const userId = "user-invalidate-recurring-create";
    await primeCache(userId);
    await request(app)
      .post("/recurring")
      .set("Cookie", authCookie(userId))
      .send({
        name: "Netflix", type: "expense", amount: 649, frequency: "monthly",
        nextDueDate: "2026-09-05", accountId: "acc-1", categoryId: "cat-subs",
      });
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("PATCH /recurring/:id clears the cached dashboard", async () => {
    const userId = "user-invalidate-recurring-patch";
    const item = await RecurringTransaction.create({
      userId, name: "Gym", type: "expense", amount: 1500, frequency: "monthly",
      nextDueDate: new Date("2026-09-01"), accountId: "acc-1", categoryId: "cat-1", status: "active",
    });
    await primeCache(userId);
    await request(app)
      .patch(`/recurring/${item._id}`)
      .set("Cookie", authCookie(userId))
      .send({ status: "paused" });
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });

  it("DELETE /recurring/:id clears the cached dashboard", async () => {
    const userId = "user-invalidate-recurring-delete";
    const item = await RecurringTransaction.create({
      userId, name: "Gym", type: "expense", amount: 1500, frequency: "monthly",
      nextDueDate: new Date("2026-09-01"), accountId: "acc-1", categoryId: "cat-1", status: "active",
    });
    await primeCache(userId);
    await request(app).delete(`/recurring/${item._id}`).set("Cookie", authCookie(userId));
    expect(await getCached(`dashboard:${userId}`)).toBeNull();
  });
});
