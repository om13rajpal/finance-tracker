import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { CategorizationRule } from "../../src/models/CategorizationRule.js";
import { Account } from "../../src/models/Account.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

async function createAccount(userId: string, currentBalance: number, type: "bank" | "credit_card" = "bank") {
  const account = await Account.create({ userId, type, institution: "Test Bank", nickname: "Test", currentBalance });
  return account._id.toString();
}

describe("transactions", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/transactions");
    expect(res.status).toBe(401);
  });

  it("creates a manual transaction and auto-categorizes via a matching rule", async () => {
    const cookie = authCookie();
    await CategorizationRule.create({
      userId: "user-1",
      matchField: "merchant",
      matchType: "contains",
      matchValue: "SWIGGY",
      categoryId: "cat-dining",
      priority: 1,
    });

    const res = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -450, date: "2026-08-20", merchant: "SWIGGY ORDER", note: "" });

    expect(res.status).toBe(201);
    expect(res.body.categoryId).toBe("cat-dining");
    expect(res.body.userId).toBe("user-1");
    expect(res.body.source).toBe("manual");
    expect(res.body.status).toBe("confirmed");
  });

  it("does NOT override an explicitly provided categoryId with auto-categorization", async () => {
    const cookie = authCookie("user-explicit-cat");
    await CategorizationRule.create({
      userId: "user-explicit-cat",
      matchField: "merchant",
      matchType: "contains",
      matchValue: "SWIGGY",
      categoryId: "cat-dining",
      priority: 1,
    });

    const res = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({
        accountId: "acc-1",
        amount: -450,
        date: "2026-08-20",
        merchant: "SWIGGY ORDER",
        categoryId: "cat-explicit-override",
      });

    expect(res.status).toBe(201);
    expect(res.body.categoryId).toBe("cat-explicit-override");
  });

  it("creates a transaction with categoryId null when no rule matches", async () => {
    const cookie = authCookie("user-no-match");
    const res = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -450, date: "2026-08-20", merchant: "SOME UNMATCHED MERCHANT" });

    expect(res.status).toBe(201);
    expect(res.body.categoryId).toBeNull();
  });

  it("lists transactions with pagination and date filtering", async () => {
    const cookie = authCookie("user-list");
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/transactions")
        .set("Cookie", cookie)
        .send({ accountId: "acc-1", amount: -100 - i, date: `2026-08-0${i + 1}`, merchant: `M${i}` });
    }

    const page1 = await request(app).get("/transactions?limit=2").set("Cookie", cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    // sorted date desc: page1 should be 08-05, 08-04
    expect(page1.body.items[0].merchant).toBe("M4");
    expect(page1.body.items[1].merchant).toBe("M3");

    const page2 = await request(app).get(`/transactions?limit=2&cursor=${page1.body.nextCursor}`).set("Cookie", cookie);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.items[0]._id).not.toBe(page1.body.items[0]._id);
    expect(page2.body.items[0].merchant).toBe("M2");
    expect(page2.body.items[1].merchant).toBe("M1");

    const filtered = await request(app)
      .get("/transactions?dateFrom=2026-08-04&dateTo=2026-08-05")
      .set("Cookie", cookie);
    expect(filtered.body.items).toHaveLength(2);
  });

  it("pages through all items across multiple pages with no duplicates or gaps", async () => {
    const cookie = authCookie("user-paging-full");
    const total = 7;
    const limit = 3;
    for (let i = 0; i < total; i++) {
      const day = String(i + 1).padStart(2, "0");
      await request(app)
        .post("/transactions")
        .set("Cookie", cookie)
        .send({ accountId: "acc-1", amount: -10 - i, date: `2026-07-${day}`, merchant: `PAGE-${i}` });
    }

    const seenIds: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = cursor
        ? `/transactions?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
        : `/transactions?limit=${limit}`;
      const res = await request(app).get(url).set("Cookie", cookie);
      expect(res.status).toBe(200);
      for (const item of res.body.items) {
        expect(seenIds).not.toContain(item._id);
        seenIds.push(item._id);
      }
      cursor = res.body.nextCursor;
      pages++;
      expect(pages).toBeLessThan(20); // guard against infinite loop
    } while (cursor);

    expect(seenIds).toHaveLength(total);
  });

  it("uses the _id tiebreaker so two transactions with the same exact date are not skipped or duplicated across pages", async () => {
    const cookie = authCookie("user-same-date");
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/transactions")
        .set("Cookie", cookie)
        .send({ accountId: "acc-1", amount: -10 - i, date: "2026-06-15", merchant: `SAME-${i}` });
    }

    const seenIds: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = cursor ? `/transactions?limit=1&cursor=${encodeURIComponent(cursor)}` : `/transactions?limit=1`;
      const res = await request(app).get(url).set("Cookie", cookie);
      for (const item of res.body.items) {
        expect(seenIds).not.toContain(item._id);
        seenIds.push(item._id);
      }
      cursor = res.body.nextCursor;
      pages++;
      expect(pages).toBeLessThan(20);
    } while (cursor);

    expect(seenIds).toHaveLength(3);
  });

  it("returns an empty items array and null nextCursor when there are no transactions", async () => {
    const cookie = authCookie("user-empty");
    const res = await request(app).get("/transactions").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it("filters by accountId and categoryId", async () => {
    const cookie = authCookie("user-filter");
    await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-A", amount: -10, date: "2026-05-01", merchant: "X", categoryId: "cat-1" });
    await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-B", amount: -20, date: "2026-05-02", merchant: "Y", categoryId: "cat-2" });

    const byAccount = await request(app).get("/transactions?accountId=acc-A").set("Cookie", cookie);
    expect(byAccount.body.items).toHaveLength(1);
    expect(byAccount.body.items[0].accountId).toBe("acc-A");

    const byCategory = await request(app).get("/transactions?categoryId=cat-2").set("Cookie", cookie);
    expect(byCategory.body.items).toHaveLength(1);
    expect(byCategory.body.items[0].categoryId).toBe("cat-2");
  });

  it("does not list another user's transactions", async () => {
    const cookieA = authCookie("scope-user-a");
    const cookieB = authCookie("scope-user-b");
    await request(app)
      .post("/transactions")
      .set("Cookie", cookieA)
      .send({ accountId: "acc-1", amount: -10, date: "2026-04-01", merchant: "A-TXN" });
    await request(app)
      .post("/transactions")
      .set("Cookie", cookieB)
      .send({ accountId: "acc-1", amount: -20, date: "2026-04-02", merchant: "B-TXN" });

    const listA = await request(app).get("/transactions").set("Cookie", cookieA);
    expect(listA.body.items).toHaveLength(1);
    expect(listA.body.items[0].merchant).toBe("A-TXN");
  });

  it("updates a transaction and can create a categorization rule from the correction", async () => {
    const cookie = authCookie("user-patch");
    const createRes = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -300, date: "2026-08-10", merchant: "ZOMATO ORDER" });

    const patchRes = await request(app)
      .patch(`/transactions/${createRes.body._id}`)
      .set("Cookie", cookie)
      .send({ categoryId: "cat-dining", createRule: true, matchValue: "ZOMATO" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.categoryId).toBe("cat-dining");

    const rule = await CategorizationRule.findOne({ userId: "user-patch", matchValue: "ZOMATO" });
    expect(rule).not.toBeNull();
    expect(rule!.categoryId).toBe("cat-dining");
    expect(rule!.matchField).toBe("merchant");
    expect(rule!.matchType).toBe("contains");
  });

  it("does not create a rule when createRule is true but no categoryId is provided", async () => {
    const cookie = authCookie("user-patch-norule");
    const createRes = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -300, date: "2026-08-10", merchant: "SOME MERCHANT" });

    const patchRes = await request(app)
      .patch(`/transactions/${createRes.body._id}`)
      .set("Cookie", cookie)
      .send({ note: "just a note update", createRule: true, matchValue: "SOME" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.note).toBe("just a note update");

    const rule = await CategorizationRule.findOne({ userId: "user-patch-norule", matchValue: "SOME" });
    expect(rule).toBeNull();
  });

  it("returns 404 when patching a nonexistent or another user's transaction", async () => {
    const ownerCookie = authCookie("patch-owner");
    const attackerCookie = authCookie("patch-attacker");
    const createRes = await request(app)
      .post("/transactions")
      .set("Cookie", ownerCookie)
      .send({ accountId: "acc-1", amount: -300, date: "2026-08-10", merchant: "OWNER TXN" });

    const patchRes = await request(app)
      .patch(`/transactions/${createRes.body._id}`)
      .set("Cookie", attackerCookie)
      .send({ categoryId: "cat-hijacked" });
    expect(patchRes.status).toBe(404);

    // confirm the owner's transaction was not modified
    const ownerList = await request(app).get("/transactions").set("Cookie", ownerCookie);
    expect(ownerList.body.items[0].categoryId).toBeNull();
  });

  it("deletes a transaction", async () => {
    const cookie = authCookie("user-delete");
    const createRes = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -50, date: "2026-08-10", merchant: "X" });

    const delRes = await request(app).delete(`/transactions/${createRes.body._id}`).set("Cookie", cookie);
    expect(delRes.status).toBe(204);

    const listRes = await request(app).get("/transactions").set("Cookie", cookie);
    expect(listRes.body.items).toHaveLength(0);
  });

  it("applies the transaction's amount as a delta to the linked account's currentBalance on create", async () => {
    const userId = "user-balance-create";
    const cookie = authCookie(userId);
    const accountId = await createAccount(userId, 1000);

    await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId, amount: -300, date: "2026-08-10", merchant: "X" });

    const updated = await Account.findById(accountId);
    expect(updated!.currentBalance).toBe(700);
  });

  it("increases (not decreases) a credit card's balance for an expense transaction", async () => {
    const userId = "user-balance-cc";
    const cookie = authCookie(userId);
    const accountId = await createAccount(userId, 2000, "credit_card");

    await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId, amount: -500, date: "2026-08-10", merchant: "X" });

    const updated = await Account.findById(accountId);
    expect(updated!.currentBalance).toBe(2500);
  });

  it("adjusts the account balance by the DIFFERENCE when a transaction's amount is patched", async () => {
    const userId = "user-balance-patch";
    const cookie = authCookie(userId);
    const accountId = await createAccount(userId, 1000);

    const createRes = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId, amount: -300, date: "2026-08-10", merchant: "X" });
    expect((await Account.findById(accountId))!.currentBalance).toBe(700);

    // Corrected from -300 to -450: balance should move by the -150 difference, to 550.
    const patchRes = await request(app)
      .patch(`/transactions/${createRes.body._id}`)
      .set("Cookie", cookie)
      .send({ amount: -450 });
    expect(patchRes.status).toBe(200);

    const updated = await Account.findById(accountId);
    expect(updated!.currentBalance).toBe(550);
  });

  it("does not touch the account balance when a PATCH doesn't include amount", async () => {
    const userId = "user-balance-patch-noamount";
    const cookie = authCookie(userId);
    const accountId = await createAccount(userId, 1000);

    const createRes = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId, amount: -300, date: "2026-08-10", merchant: "X" });

    await request(app)
      .patch(`/transactions/${createRes.body._id}`)
      .set("Cookie", cookie)
      .send({ note: "just a note" });

    const updated = await Account.findById(accountId);
    expect(updated!.currentBalance).toBe(700);
  });

  it("reverses the transaction's amount from the account balance on delete", async () => {
    const userId = "user-balance-delete";
    const cookie = authCookie(userId);
    const accountId = await createAccount(userId, 1000);

    const createRes = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId, amount: -300, date: "2026-08-10", merchant: "X" });
    expect((await Account.findById(accountId))!.currentBalance).toBe(700);

    const delRes = await request(app).delete(`/transactions/${createRes.body._id}`).set("Cookie", cookie);
    expect(delRes.status).toBe(204);

    const updated = await Account.findById(accountId);
    expect(updated!.currentBalance).toBe(1000);
  });

  // Regression: a statement import reconciles the account balance ONCE, from
  // the statement's own printed closing balance: confirming an individual
  // row from that import deliberately does NOT also apply its amount as a
  // delta (see `balanceReconciledAtImport` on PendingTransaction and
  // `applyConfirmedTransactionBalanceEffect`), to avoid double-counting.
  // DELETE and the amount-PATCH used to be unaware of this and would
  // unconditionally reverse/adjust by the transaction's amount anyway,
  // wrongly un-applying a delta that was never applied in the first place,
  // and moving the balance in the WRONG direction. Verified live against
  // production: bulk-deleting statement-derived transactions pushed one
  // account's balance UP by ~₹6.9L instead of down to zero.
  it("does NOT reverse a balance delta on delete for a transaction confirmed from a reconciled statement import", async () => {
    const userId = "user-balance-delete-reconciled";
    const cookie = authCookie(userId);
    const accountId = await createAccount(userId, 1000);

    const pending = await PendingTransaction.create({
      userId,
      accountId,
      amount: -300,
      date: new Date("2026-08-10"),
      merchant: "STATEMENT ROW",
      source: "pdf_statement_parsed",
      balanceReconciledAtImport: true,
    });

    const confirmRes = await request(app)
      .post(`/pending-transactions/${pending._id}/confirm`)
      .set("Cookie", cookie)
      .send({});
    expect(confirmRes.status).toBe(200);
    // Confirming must not touch the balance: it was already reconciled at import.
    expect((await Account.findById(accountId))!.currentBalance).toBe(1000);

    const delRes = await request(app)
      .delete(`/transactions/${confirmRes.body._id}`)
      .set("Cookie", cookie);
    expect(delRes.status).toBe(204);

    // Bug: this used to become 1300 (applyBalanceDelta(-(-300)) = +300 applied
    // to a delta that was never there), not the correct "unchanged" 1000.
    expect((await Account.findById(accountId))!.currentBalance).toBe(1000);
  });

  it("does NOT adjust the balance on an amount-PATCH for a transaction confirmed from a reconciled statement import", async () => {
    const userId = "user-balance-patch-reconciled";
    const cookie = authCookie(userId);
    const accountId = await createAccount(userId, 1000);

    const pending = await PendingTransaction.create({
      userId,
      accountId,
      amount: -300,
      date: new Date("2026-08-10"),
      merchant: "STATEMENT ROW",
      source: "pdf_statement_parsed",
      balanceReconciledAtImport: true,
    });

    const confirmRes = await request(app)
      .post(`/pending-transactions/${pending._id}/confirm`)
      .set("Cookie", cookie)
      .send({});
    expect(confirmRes.status).toBe(200);

    const patchRes = await request(app)
      .patch(`/transactions/${confirmRes.body._id}`)
      .set("Cookie", cookie)
      .send({ amount: -450 });
    expect(patchRes.status).toBe(200);

    expect((await Account.findById(accountId))!.currentBalance).toBe(1000);
  });

  it("returns 404 when deleting a nonexistent or another user's transaction", async () => {
    const ownerCookie = authCookie("delete-owner");
    const attackerCookie = authCookie("delete-attacker");
    const createRes = await request(app)
      .post("/transactions")
      .set("Cookie", ownerCookie)
      .send({ accountId: "acc-1", amount: -50, date: "2026-08-10", merchant: "X" });

    const delRes = await request(app).delete(`/transactions/${createRes.body._id}`).set("Cookie", attackerCookie);
    expect(delRes.status).toBe(404);

    const listRes = await request(app).get("/transactions").set("Cookie", ownerCookie);
    expect(listRes.body.items).toHaveLength(1);
  });
});

describe("duplicate detection on create", () => {
  it("rejects a likely duplicate with 409 unless forced", async () => {
    const cookie = authCookie("user-dup");
    const first = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -500, date: "2026-08-10", merchant: "X" });
    expect(first.status).toBe(201);

    const dup = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -500, date: "2026-08-11", merchant: "X" });
    expect(dup.status).toBe(409);
    expect(dup.body.note).toBe("possible_duplicate");

    const forced = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -500, date: "2026-08-11", merchant: "X", force: true });
    expect(forced.status).toBe(201);
  });

  it("does not flag a transaction more than 2 days apart", async () => {
    const cookie = authCookie("user-dup-far");
    const first = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -500, date: "2026-08-10", merchant: "X" });
    expect(first.status).toBe(201);

    const notDup = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -500, date: "2026-08-14", merchant: "X" });
    expect(notDup.status).toBe(201);
  });

  it("does not flag a transaction on a different account", async () => {
    const cookie = authCookie("user-dup-account");
    const first = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -500, date: "2026-08-10", merchant: "X" });
    expect(first.status).toBe(201);

    const notDup = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-2", amount: -500, date: "2026-08-10", merchant: "X" });
    expect(notDup.status).toBe(201);
  });

  it("still runs full create logic (categorization) when force bypasses the duplicate check", async () => {
    const cookie = authCookie("user-dup-force-cat");
    await CategorizationRule.create({
      userId: "user-dup-force-cat",
      matchField: "merchant",
      matchType: "contains",
      matchValue: "SWIGGY",
      categoryId: "cat-dining",
      priority: 1,
    });

    const first = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -500, date: "2026-08-10", merchant: "SWIGGY ORDER" });
    expect(first.status).toBe(201);

    const forced = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -500, date: "2026-08-11", merchant: "SWIGGY ORDER", force: true });
    expect(forced.status).toBe(201);
    expect(forced.body.categoryId).toBe("cat-dining");
  });

  it("does not apply duplicate detection to PATCH (legitimate edits are not blocked)", async () => {
    const cookie = authCookie("user-dup-patch");
    const a = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -500, date: "2026-08-10", merchant: "X" });
    expect(a.status).toBe(201);

    const b = await request(app)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ accountId: "acc-1", amount: -999, date: "2026-08-20", merchant: "Y" });
    expect(b.status).toBe(201);

    // editing b so it now matches a's accountId/amount/date exactly must NOT be rejected as a duplicate
    const patchRes = await request(app)
      .patch(`/transactions/${b.body._id}`)
      .set("Cookie", cookie)
      .send({ amount: -500, date: "2026-08-10" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.amount).toBe(-500);
  });
});
