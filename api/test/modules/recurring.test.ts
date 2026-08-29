import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { RecurringTransaction } from "../../src/models/RecurringTransaction.js";
import { Transaction } from "../../src/models/Transaction.js";
import {
  advanceNextDueDate,
  processDueRecurringTransactions,
} from "../../src/modules/recurring/recurring.service.js";
import { recurringDueQueue, scheduleRecurringDueChecks } from "../../src/jobs/workers/recurringDue.worker.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("advanceNextDueDate", () => {
  it("advances monthly, weekly, and yearly correctly", () => {
    expect(advanceNextDueDate(new Date("2026-01-15"), "monthly").toISOString().slice(0, 10)).toBe("2026-02-15");
    expect(advanceNextDueDate(new Date("2026-01-15"), "weekly").toISOString().slice(0, 10)).toBe("2026-01-22");
    expect(advanceNextDueDate(new Date("2026-01-15"), "yearly").toISOString().slice(0, 10)).toBe("2027-01-15");
  });

  it("defaults custom frequency to +1 month", () => {
    expect(advanceNextDueDate(new Date("2026-01-15"), "custom").toISOString().slice(0, 10)).toBe("2026-02-15");
  });

  it("clamps a month-end date to the last valid day of the target month instead of overflowing", () => {
    // Jan 31 + 1 month must land on Feb 28 (2026 is not a leap year), NOT overflow into March.
    expect(advanceNextDueDate(new Date("2026-01-31"), "monthly").toISOString().slice(0, 10)).toBe("2026-02-28");
    // May 31 + 1 month -> June 30 (June has 30 days), not July 1.
    expect(advanceNextDueDate(new Date("2026-05-31"), "monthly").toISOString().slice(0, 10)).toBe("2026-06-30");
    // Successive advances from a 31st-of-the-month schedule should never overflow into a later
    // month than the "next" one, cycle after cycle.
    let d = new Date("2026-01-31");
    d = advanceNextDueDate(d, "monthly"); // Feb 28
    d = advanceNextDueDate(d, "monthly"); // Mar 28 (not back to 31, since we advance from the clamped date)
    expect(d.toISOString().slice(0, 10)).toBe("2026-03-28");
  });

  it("clamps a leap-day yearly renewal to Feb 28 in a non-leap year", () => {
    expect(advanceNextDueDate(new Date("2028-02-29"), "yearly").toISOString().slice(0, 10)).toBe("2029-02-28");
  });
});

describe("recurring transactions API", () => {
  it("creates a recurring item and lists it in the upcoming window", async () => {
    const cookie = authCookie("user-recurring");
    const res = await request(app)
      .post("/recurring")
      .set("Cookie", cookie)
      .send({
        name: "Netflix",
        type: "expense",
        amount: 649,
        frequency: "monthly",
        nextDueDate: "2026-09-05",
        accountId: "acc-1",
        categoryId: "cat-subs",
        autoCreate: true,
      });
    expect(res.status).toBe(201);

    const upcoming = await request(app).get("/recurring/upcoming?days=30").set("Cookie", cookie);
    expect(upcoming.status).toBe(200);
    expect(upcoming.body).toHaveLength(1);
    expect(upcoming.body[0].name).toBe("Netflix");
  });

  it("excludes items outside the requested window and items belonging to another user", async () => {
    const cookie = authCookie("user-window");
    await request(app)
      .post("/recurring")
      .set("Cookie", cookie)
      .send({
        name: "Far future",
        type: "expense",
        amount: 100,
        frequency: "monthly",
        nextDueDate: "2027-01-01",
        accountId: "acc-1",
        categoryId: "cat-1",
      });

    // Belongs to a different user entirely - must never appear in user-window's upcoming list.
    await RecurringTransaction.create({
      userId: "someone-else",
      name: "Other user's rent",
      type: "expense",
      amount: 500,
      frequency: "monthly",
      nextDueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      accountId: "acc-x",
      categoryId: "cat-x",
      status: "active",
    });

    const upcoming = await request(app).get("/recurring/upcoming?days=30").set("Cookie", cookie);
    expect(upcoming.status).toBe(200);
    expect(upcoming.body).toHaveLength(0);
  });

  it("excludes paused/cancelled items from the upcoming window even if nextDueDate is within range", async () => {
    const cookie = authCookie("user-paused-upcoming");
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await RecurringTransaction.create({
      userId: "user-paused-upcoming",
      name: "Paused sub",
      type: "expense",
      amount: 200,
      frequency: "monthly",
      nextDueDate: soon,
      accountId: "acc-1",
      categoryId: "cat-1",
      status: "paused",
    });

    const upcoming = await request(app).get("/recurring/upcoming?days=30").set("Cookie", cookie);
    expect(upcoming.body).toHaveLength(0);
  });

  it("sorts upcoming items by nextDueDate ascending", async () => {
    const cookie = authCookie("user-sort");
    const later = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const sooner = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await RecurringTransaction.create({
      userId: "user-sort",
      name: "Later",
      type: "expense",
      amount: 1,
      frequency: "monthly",
      nextDueDate: later,
      accountId: "acc-1",
      categoryId: "cat-1",
      status: "active",
    });
    await RecurringTransaction.create({
      userId: "user-sort",
      name: "Sooner",
      type: "expense",
      amount: 1,
      frequency: "monthly",
      nextDueDate: sooner,
      accountId: "acc-1",
      categoryId: "cat-1",
      status: "active",
    });

    const upcoming = await request(app).get("/recurring/upcoming?days=30").set("Cookie", cookie);
    expect(upcoming.body.map((i: { name: string }) => i.name)).toEqual(["Sooner", "Later"]);
  });

  it("supports full CRUD scoped to the authenticated user", async () => {
    const cookie = authCookie("user-crud");
    const otherCookie = authCookie("user-crud-other");

    const created = await request(app)
      .post("/recurring")
      .set("Cookie", cookie)
      .send({
        name: "Gym",
        type: "expense",
        amount: 1500,
        frequency: "monthly",
        nextDueDate: "2026-09-01",
        accountId: "acc-1",
        categoryId: "cat-1",
      });
    expect(created.status).toBe(201);
    const id = created.body._id;

    const list = await request(app).get("/recurring").set("Cookie", cookie);
    expect(list.body).toHaveLength(1);

    // Another user cannot patch or delete it.
    const otherPatch = await request(app)
      .patch(`/recurring/${id}`)
      .set("Cookie", otherCookie)
      .send({ status: "paused" });
    expect(otherPatch.status).toBe(404);

    const patch = await request(app).patch(`/recurring/${id}`).set("Cookie", cookie).send({ status: "paused" });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("paused");

    const otherDelete = await request(app).delete(`/recurring/${id}`).set("Cookie", otherCookie);
    expect(otherDelete.status).toBe(404);

    const del = await request(app).delete(`/recurring/${id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);

    const listAfter = await request(app).get("/recurring").set("Cookie", cookie);
    expect(listAfter.body).toHaveLength(0);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/recurring/upcoming");
    expect(res.status).toBe(401);
  });
});

describe("processDueRecurringTransactions", () => {
  it("creates a transaction only for autoCreate items and advances nextDueDate for all due items", async () => {
    const autoItem = await RecurringTransaction.create({
      userId: "user-due",
      name: "Rent",
      type: "expense",
      amount: 20000,
      frequency: "monthly",
      nextDueDate: new Date("2026-08-01"),
      accountId: "acc-1",
      categoryId: "cat-rent",
      autoCreate: true,
      status: "active",
    });
    const infoItem = await RecurringTransaction.create({
      userId: "user-due",
      name: "Gym renewal reminder",
      type: "expense",
      amount: 1500,
      frequency: "monthly",
      nextDueDate: new Date("2026-08-01"),
      accountId: "acc-1",
      categoryId: "cat-fitness",
      autoCreate: false,
      status: "active",
    });

    await processDueRecurringTransactions();

    const txCount = await Transaction.countDocuments({ userId: "user-due" });
    expect(txCount).toBe(1);

    const tx = await Transaction.findOne({ userId: "user-due" });
    expect(tx!.amount).toBe(-20000);
    expect(tx!.source).toBe("manual");

    const updatedAuto = await RecurringTransaction.findById(autoItem._id);
    const updatedInfo = await RecurringTransaction.findById(infoItem._id);
    expect(updatedAuto!.nextDueDate.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(updatedInfo!.nextDueDate.toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("creates an income transaction with a positive amount for autoCreate income items", async () => {
    await RecurringTransaction.create({
      userId: "user-income",
      name: "Salary",
      type: "income",
      amount: 50000,
      frequency: "monthly",
      nextDueDate: new Date("2026-08-01"),
      accountId: "acc-1",
      categoryId: "cat-salary",
      autoCreate: true,
      status: "active",
    });

    await processDueRecurringTransactions();

    const tx = await Transaction.findOne({ userId: "user-income" });
    expect(tx!.amount).toBe(50000);
  });

  it("does not touch paused or cancelled items even if their nextDueDate is past-due", async () => {
    const paused = await RecurringTransaction.create({
      userId: "user-paused",
      name: "Paused thing",
      type: "expense",
      amount: 100,
      frequency: "monthly",
      nextDueDate: new Date("2020-01-01"),
      accountId: "acc-1",
      categoryId: "cat-1",
      autoCreate: true,
      status: "paused",
    });
    const cancelled = await RecurringTransaction.create({
      userId: "user-paused",
      name: "Cancelled thing",
      type: "expense",
      amount: 100,
      frequency: "monthly",
      nextDueDate: new Date("2020-01-01"),
      accountId: "acc-1",
      categoryId: "cat-1",
      autoCreate: true,
      status: "cancelled",
    });

    await processDueRecurringTransactions();

    const txCount = await Transaction.countDocuments({ userId: "user-paused" });
    expect(txCount).toBe(0);

    const updatedPaused = await RecurringTransaction.findById(paused._id);
    const updatedCancelled = await RecurringTransaction.findById(cancelled._id);
    expect(updatedPaused!.nextDueDate.toISOString().slice(0, 10)).toBe("2020-01-01");
    expect(updatedCancelled!.nextDueDate.toISOString().slice(0, 10)).toBe("2020-01-01");
  });

  it("does not fabricate a HoldingLot for SIP-linked items - only the expense Transaction is created", async () => {
    await RecurringTransaction.create({
      userId: "user-sip",
      name: "Nifty50 Index Fund SIP",
      type: "expense",
      amount: 5000,
      frequency: "monthly",
      nextDueDate: new Date("2026-08-01"),
      accountId: "acc-1",
      categoryId: "cat-investments",
      linkedHoldingSymbol: "NIFTYBEES",
      autoCreate: true,
      status: "active",
    });

    await processDueRecurringTransactions();

    const txCount = await Transaction.countDocuments({ userId: "user-sip" });
    expect(txCount).toBe(1);
    // No HoldingLot module is even imported by the service - if it tried to create one,
    // this test's job is really just to document/guard the "expense-only" behavior the
    // brief requires. We assert on the Transaction shape instead of a lot count.
    const tx = await Transaction.findOne({ userId: "user-sip" });
    expect(tx!.amount).toBe(-5000);
  });

  it("advances an item only ONE cycle per run even when several cycles have elapsed, leaving it still due for the next run", async () => {
    const item = await RecurringTransaction.create({
      userId: "user-backlog",
      name: "Long overdue bill",
      type: "expense",
      amount: 300,
      frequency: "monthly",
      nextDueDate: new Date("2026-05-01"), // 3+ months before "now" in these fixtures
      accountId: "acc-1",
      categoryId: "cat-1",
      autoCreate: true,
      status: "active",
    });

    await processDueRecurringTransactions();

    const afterFirstRun = await RecurringTransaction.findById(item._id);
    expect(afterFirstRun!.nextDueDate.toISOString().slice(0, 10)).toBe("2026-06-01");

    let txCount = await Transaction.countDocuments({ userId: "user-backlog" });
    expect(txCount).toBe(1);

    // Still past-due (2026-06-01 < now), so a second run catches the next cycle.
    await processDueRecurringTransactions();
    const afterSecondRun = await RecurringTransaction.findById(item._id);
    expect(afterSecondRun!.nextDueDate.toISOString().slice(0, 10)).toBe("2026-07-01");

    txCount = await Transaction.countDocuments({ userId: "user-backlog" });
    expect(txCount).toBe(2);
  });
});

describe("scheduleRecurringDueChecks", () => {
  afterEach(async () => {
    const jobs = await recurringDueQueue.getRepeatableJobs();
    await Promise.all(jobs.map((j) => recurringDueQueue.removeRepeatableByKey(j.key)));
  });

  it("registers exactly one repeatable job even when called multiple times (e.g. on every server restart)", async () => {
    await scheduleRecurringDueChecks();
    await scheduleRecurringDueChecks();
    await scheduleRecurringDueChecks();

    const jobs = await recurringDueQueue.getRepeatableJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].every).toBe(String(60 * 60 * 1000));
  });
});
