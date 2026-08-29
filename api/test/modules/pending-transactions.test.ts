import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";
import { Transaction } from "../../src/models/Transaction.js";
import { CategorizationRule } from "../../src/models/CategorizationRule.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("pending transactions", () => {
  it("lists pending transactions for the user", async () => {
    const cookie = authCookie("user-pending");
    await PendingTransaction.create({
      userId: "user-pending",
      accountId: "acc-1",
      amount: -200,
      date: new Date("2026-08-15"),
      merchant: "HDFC ALERT",
      source: "email_parsed",
    });

    const res = await request(app).get("/pending-transactions").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("does not list another user's pending transactions", async () => {
    await PendingTransaction.create({
      userId: "user-a",
      accountId: "acc-1",
      amount: -200,
      date: new Date("2026-08-15"),
      merchant: "HDFC ALERT",
      source: "email_parsed",
    });

    const res = await request(app).get("/pending-transactions").set("Cookie", authCookie("user-b"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("confirms a pending transaction into a real transaction, applying edits and optionally creating a rule", async () => {
    const cookie = authCookie("user-confirm");
    const pending = await PendingTransaction.create({
      userId: "user-confirm",
      accountId: "acc-1",
      amount: -600,
      date: new Date("2026-08-16"),
      merchant: "SWIGGY ORDER",
      source: "email_parsed",
    });

    const res = await request(app)
      .post(`/pending-transactions/${pending._id}/confirm`)
      .set("Cookie", cookie)
      .send({ categoryId: "cat-dining", createRule: true, matchValue: "SWIGGY" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(res.body.categoryId).toBe("cat-dining");
    expect(res.body.source).toBe("email_parsed");

    const stillPending = await PendingTransaction.findById(pending._id);
    expect(stillPending).toBeNull();

    const transactionCount = await Transaction.countDocuments({ userId: "user-confirm" });
    expect(transactionCount).toBe(1);

    const rule = await CategorizationRule.findOne({ userId: "user-confirm", matchValue: "SWIGGY" });
    expect(rule).not.toBeNull();
  });

  it("rejects a pending transaction, deleting it without creating a real one", async () => {
    const cookie = authCookie("user-reject");
    const pending = await PendingTransaction.create({
      userId: "user-reject",
      accountId: "acc-1",
      amount: -100,
      date: new Date("2026-08-16"),
      merchant: "UNKNOWN",
      source: "email_parsed",
    });

    const res = await request(app).post(`/pending-transactions/${pending._id}/reject`).set("Cookie", cookie);
    expect(res.status).toBe(204);

    const count = await Transaction.countDocuments({ userId: "user-reject" });
    expect(count).toBe(0);

    const stillPending = await PendingTransaction.findById(pending._id);
    expect(stillPending).toBeNull();
  });

  it("returns 404 confirming a nonexistent pending transaction", async () => {
    const res = await request(app)
      .post("/pending-transactions/64b000000000000000000000/confirm")
      .set("Cookie", authCookie("user-x"))
      .send({});
    expect(res.status).toBe(404);
  });

  it("returns 404 confirming another user's pending transaction", async () => {
    const pending = await PendingTransaction.create({
      userId: "user-owner",
      accountId: "acc-1",
      amount: -300,
      date: new Date("2026-08-16"),
      merchant: "OTHER",
      source: "email_parsed",
    });

    const res = await request(app)
      .post(`/pending-transactions/${pending._id}/confirm`)
      .set("Cookie", authCookie("user-intruder"))
      .send({});
    expect(res.status).toBe(404);

    // untouched — still pending, owned by the original user
    const stillPending = await PendingTransaction.findById(pending._id);
    expect(stillPending).not.toBeNull();
  });

  it("returns 404 rejecting a nonexistent pending transaction", async () => {
    const res = await request(app)
      .post("/pending-transactions/64b000000000000000000000/reject")
      .set("Cookie", authCookie("user-x"));
    expect(res.status).toBe(404);
  });

  it("returns 404 rejecting another user's pending transaction, and does not delete it", async () => {
    const pending = await PendingTransaction.create({
      userId: "user-owner2",
      accountId: "acc-1",
      amount: -300,
      date: new Date("2026-08-16"),
      merchant: "OTHER",
      source: "email_parsed",
    });

    const res = await request(app)
      .post(`/pending-transactions/${pending._id}/reject`)
      .set("Cookie", authCookie("user-intruder2"));
    expect(res.status).toBe(404);

    const stillPending = await PendingTransaction.findById(pending._id);
    expect(stillPending).not.toBeNull();
  });

  it("flags a likely duplicate against real transactions using the FINAL (post-edit) values", async () => {
    const userId = "user-dup";
    const cookie = authCookie(userId);

    // An existing real transaction that only matches the pending transaction AFTER the edit.
    await Transaction.create({
      userId,
      accountId: "acc-1",
      amount: -750,
      date: new Date("2026-08-16"),
      source: "manual",
      status: "confirmed",
    });

    const pending = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -600, // does not match the existing transaction's amount yet
      date: new Date("2026-08-16"),
      merchant: "SOME STORE",
      source: "email_parsed",
    });

    // Edit the amount during confirm so it now matches the existing transaction.
    const res = await request(app)
      .post(`/pending-transactions/${pending._id}/confirm`)
      .set("Cookie", cookie)
      .send({ amount: -750 });

    expect(res.status).toBe(409);
    expect(res.body.note).toBe("possible_duplicate");

    // Pending transaction must be untouched — still there for the user to reconsider.
    const stillPending = await PendingTransaction.findById(pending._id);
    expect(stillPending).not.toBeNull();

    // No second real transaction was created.
    const count = await Transaction.countDocuments({ userId });
    expect(count).toBe(1);
  });

  it("does NOT flag a duplicate when only the pre-edit values would have matched", async () => {
    const userId = "user-dup2";
    const cookie = authCookie(userId);

    await Transaction.create({
      userId,
      accountId: "acc-1",
      amount: -600,
      date: new Date("2026-08-16"),
      source: "manual",
      status: "confirmed",
    });

    const pending = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -600, // matches pre-edit
      date: new Date("2026-08-16"),
      merchant: "SOME STORE",
      source: "email_parsed",
    });

    // Edit amount away from the duplicate before confirming.
    const res = await request(app)
      .post(`/pending-transactions/${pending._id}/confirm`)
      .set("Cookie", cookie)
      .send({ amount: -601 });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(-601);
  });

  it("bypasses the duplicate check on confirm when force: true is passed", async () => {
    const userId = "user-force";
    const cookie = authCookie(userId);

    await Transaction.create({
      userId,
      accountId: "acc-1",
      amount: -800,
      date: new Date("2026-08-16"),
      source: "manual",
      status: "confirmed",
    });

    const pending = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -800,
      date: new Date("2026-08-16"),
      merchant: "DUP STORE",
      source: "email_parsed",
    });

    const res = await request(app)
      .post(`/pending-transactions/${pending._id}/confirm`)
      .set("Cookie", cookie)
      .send({ force: true });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");

    const count = await Transaction.countDocuments({ userId });
    expect(count).toBe(2);

    const stillPending = await PendingTransaction.findById(pending._id);
    expect(stillPending).toBeNull();
  });

  it("skips rule creation when createRule is true but no categoryId is present, without crashing", async () => {
    const userId = "user-norule";
    const cookie = authCookie(userId);

    const pending = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -150,
      date: new Date("2026-08-16"),
      merchant: "MYSTERY MERCHANT",
      source: "email_parsed",
    });

    const res = await request(app)
      .post(`/pending-transactions/${pending._id}/confirm`)
      .set("Cookie", cookie)
      .send({ createRule: true, matchValue: "MYSTERY" });

    expect(res.status).toBe(200);
    expect(res.body.categoryId).toBeFalsy();

    const rule = await CategorizationRule.findOne({ userId, matchValue: "MYSTERY" });
    expect(rule).toBeNull();
  });

  it("auto-categorizes via an existing rule when no categoryId is supplied", async () => {
    const userId = "user-autocat";
    const cookie = authCookie(userId);

    await CategorizationRule.create({
      userId,
      matchField: "merchant",
      matchType: "contains",
      matchValue: "ZOMATO",
      categoryId: "cat-dining",
      priority: 100,
    });

    const pending = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -450,
      date: new Date("2026-08-16"),
      merchant: "ZOMATO ORDER #123",
      source: "email_parsed",
    });

    const res = await request(app)
      .post(`/pending-transactions/${pending._id}/confirm`)
      .set("Cookie", cookie)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.categoryId).toBe("cat-dining");
  });
});
