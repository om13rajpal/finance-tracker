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

  it("stamps the confirmed transaction's source from the pending doc's own source, not a hardcoded value", async () => {
    const userId = "user-source-stamp";
    const cookie = authCookie(userId);

    const emailPending = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -120,
      date: new Date("2026-08-16"),
      merchant: "EMAIL SOURCE MERCHANT",
      source: "email_parsed",
    });
    const pdfPending = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -340,
      date: new Date("2026-08-16"),
      merchant: "PDF SOURCE MERCHANT",
      source: "pdf_statement_parsed",
    });

    const emailRes = await request(app)
      .post(`/pending-transactions/${emailPending._id}/confirm`)
      .set("Cookie", cookie)
      .send({});
    expect(emailRes.status).toBe(200);
    expect(emailRes.body.source).toBe("email_parsed");

    const pdfRes = await request(app)
      .post(`/pending-transactions/${pdfPending._id}/confirm`)
      .set("Cookie", cookie)
      .send({});
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.body.source).toBe("pdf_statement_parsed");

    const stored = await Transaction.findById(pdfRes.body._id);
    expect(stored!.source).toBe("pdf_statement_parsed");
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

  describe("bulk actions", () => {
    it("requires auth for bulk-reject and bulk-confirm", async () => {
      const rejectRes = await request(app).post("/pending-transactions/bulk-reject").send({ ids: ["x"] });
      expect(rejectRes.status).toBe(401);

      const confirmRes = await request(app).post("/pending-transactions/bulk-confirm").send({ ids: ["x"] });
      expect(confirmRes.status).toBe(401);
    });

    it("rejects an empty ids array as a validation error", async () => {
      const res = await request(app)
        .post("/pending-transactions/bulk-reject")
        .set("Cookie", authCookie("user-bulk-empty"))
        .send({ ids: [] });
      expect(res.status).toBe(400);
    });

    it("bulk-rejects several of this user's own pending transactions in one request, ignoring ids that aren't theirs", async () => {
      const userId = "user-bulk-reject";
      const cookie = authCookie(userId);
      const mine1 = await PendingTransaction.create({
        userId,
        accountId: "acc-1",
        amount: -100,
        date: new Date("2026-08-16"),
        merchant: "ONE",
        source: "email_parsed",
      });
      const mine2 = await PendingTransaction.create({
        userId,
        accountId: "acc-1",
        amount: -200,
        date: new Date("2026-08-16"),
        merchant: "TWO",
        source: "pdf_statement_parsed",
      });
      const someoneElses = await PendingTransaction.create({
        userId: "user-bulk-reject-other",
        accountId: "acc-1",
        amount: -300,
        date: new Date("2026-08-16"),
        merchant: "NOT MINE",
        source: "email_parsed",
      });

      const res = await request(app)
        .post("/pending-transactions/bulk-reject")
        .set("Cookie", cookie)
        .send({ ids: [mine1._id.toString(), mine2._id.toString(), someoneElses._id.toString()] });

      expect(res.status).toBe(200);
      expect(res.body.deletedCount).toBe(2);

      expect(await PendingTransaction.findById(mine1._id)).toBeNull();
      expect(await PendingTransaction.findById(mine2._id)).toBeNull();
      // Untouched — not this user's to delete.
      expect(await PendingTransaction.findById(someoneElses._id)).not.toBeNull();
    });

    it("bulk-confirms several pending transactions at once, applying categorization fallback per item", async () => {
      const userId = "user-bulk-confirm";
      const cookie = authCookie(userId);

      await CategorizationRule.create({
        userId,
        matchField: "merchant",
        matchType: "contains",
        matchValue: "ZOMATO",
        categoryId: "cat-dining",
        priority: 100,
      });

      const a = await PendingTransaction.create({
        userId,
        accountId: "acc-1",
        amount: -450,
        date: new Date("2026-08-16"),
        merchant: "ZOMATO ORDER #1",
        source: "email_parsed",
      });
      const b = await PendingTransaction.create({
        userId,
        accountId: "acc-1",
        amount: -120,
        date: new Date("2026-08-17"),
        merchant: "SOME OTHER MERCHANT",
        source: "pdf_statement_parsed",
      });

      const res = await request(app)
        .post("/pending-transactions/bulk-confirm")
        .set("Cookie", cookie)
        .send({ ids: [a._id.toString(), b._id.toString()] });

      expect(res.status).toBe(200);
      expect(res.body.confirmedIds.sort()).toEqual([a._id.toString(), b._id.toString()].sort());
      expect(res.body.skipped).toEqual([]);

      expect(await PendingTransaction.countDocuments({ userId })).toBe(0);
      expect(await Transaction.countDocuments({ userId })).toBe(2);

      const confirmedA = await Transaction.findOne({ userId, merchant: "ZOMATO ORDER #1" });
      expect(confirmedA!.categoryId).toBe("cat-dining");
    });

    it("skips (not fails) a row that still needs an account, a likely duplicate, and an id that isn't this user's — reporting why for each", async () => {
      const userId = "user-bulk-skip";
      const cookie = authCookie(userId);

      const needsAccount = await PendingTransaction.create({
        userId,
        accountId: null,
        amount: -500,
        date: new Date("2026-08-16"),
        merchant: "NO ACCOUNT YET",
        source: "email_parsed",
      });

      await Transaction.create({
        userId,
        accountId: "acc-1",
        amount: -750,
        date: new Date("2026-08-16"),
        source: "manual",
        status: "confirmed",
      });
      const duplicate = await PendingTransaction.create({
        userId,
        accountId: "acc-1",
        amount: -750,
        date: new Date("2026-08-16"),
        merchant: "DUP STORE",
        source: "email_parsed",
      });

      const notMine = await PendingTransaction.create({
        userId: "user-bulk-skip-other",
        accountId: "acc-1",
        amount: -900,
        date: new Date("2026-08-16"),
        merchant: "INTRUDER",
        source: "email_parsed",
      });

      const fine = await PendingTransaction.create({
        userId,
        accountId: "acc-1",
        amount: -50,
        date: new Date("2026-08-16"),
        merchant: "PERFECTLY FINE",
        source: "email_parsed",
      });

      const res = await request(app)
        .post("/pending-transactions/bulk-confirm")
        .set("Cookie", cookie)
        .send({
          ids: [
            needsAccount._id.toString(),
            duplicate._id.toString(),
            notMine._id.toString(),
            fine._id.toString(),
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.confirmedIds).toEqual([fine._id.toString()]);

      const skippedByReason = Object.fromEntries(
        res.body.skipped.map((s: { id: string; reason: string }) => [s.id, s.reason])
      );
      expect(skippedByReason[needsAccount._id.toString()]).toBe("account_required");
      expect(skippedByReason[duplicate._id.toString()]).toBe("possible_duplicate");
      expect(skippedByReason[notMine._id.toString()]).toBe("not_found");

      // The skipped ones are untouched — still pending (or, for `notMine`, still
      // owned by its real owner).
      expect(await PendingTransaction.findById(needsAccount._id)).not.toBeNull();
      expect(await PendingTransaction.findById(duplicate._id)).not.toBeNull();
      expect(await PendingTransaction.findById(notMine._id)).not.toBeNull();
      // Only the one clean row was actually confirmed.
      expect(await PendingTransaction.findById(fine._id)).toBeNull();
      expect(await Transaction.countDocuments({ userId, merchant: "PERFECTLY FINE" })).toBe(1);
    });
  });
});
