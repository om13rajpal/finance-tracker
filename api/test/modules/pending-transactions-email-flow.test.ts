import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { EmailSource } from "../../src/models/EmailSource.js";
import { GmailConnection } from "../../src/models/GmailConnection.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";
import { Account } from "../../src/models/Account.js";
import { encrypt } from "../../src/lib/encryption.js";

// See gmail-webhook.test.ts for why `vi.hoisted` is required here rather than
// plain `const historyListMock = vi.fn()` declarations: this file statically
// imports `app.js`, whose import chain reaches `googleapis` before a later
// `const` in this file's body would have run, so a non-hoisted mock var would
// still be in its temporal dead zone when the mock factory first executes.
const { historyListMock, getMessageMock } = vi.hoisted(() => ({
  historyListMock: vi.fn(),
  getMessageMock: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn() })) },
    gmail: vi.fn().mockReturnValue({
      users: { history: { list: historyListMock }, messages: { get: getMessageMock } },
    }),
  },
}));

function authCookie(userId = "user-email-flow") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("email-parsed transaction confirm flow creates a working categorization rule", () => {
  it("auto-categorizes a later manual transaction from the same merchant", async () => {
    const userId = "user-email-flow";
    await GmailConnection.create({
      userId,
      refreshTokenEncrypted: encrypt("token"),
      status: "connected",
      historyId: "1",
    });
    await EmailSource.create({
      userId,
      senderPattern: "alerts@hdfcbank.net",
      institution: "HDFC",
      parserKey: "hdfc_debit_alert",
    });

    historyListMock.mockResolvedValue({
      data: { history: [{ messagesAdded: [{ message: { id: "email-flow-1" } }] }] },
    });
    getMessageMock.mockResolvedValue({
      data: {
        id: "email-flow-1",
        payload: {
          headers: [
            { name: "From", value: "alerts@hdfcbank.net" },
            { name: "Subject", value: "Debit Alert" },
          ],
          body: {
            data: Buffer.from("Rs.250.00 debited from account XX1234 to ZOMATO on 20-08-26").toString(
              "base64"
            ),
          },
        },
      },
    });

    // Real Task 22 code path — not a hand-constructed PendingTransaction.
    const { processGmailNotification } = await import(
      "../../src/jobs/workers/gmailEmailParse.worker.js"
    );
    await processGmailNotification({ userId, historyId: "2" });

    const pending = await PendingTransaction.findOne({ userId });
    expect(pending).not.toBeNull();
    expect(pending!.merchant).toBe("ZOMATO");

    // Task 22 made accountId nullable on email-parsed pending transactions —
    // confirm must supply one via the edit fields.
    const confirmRes = await request(app)
      .post(`/pending-transactions/${pending!._id}/confirm`)
      .set("Cookie", authCookie(userId))
      .send({ categoryId: "cat-food-delivery", accountId: "acc-1", createRule: true });
    expect(confirmRes.status).toBe(200);

    // A SEPARATE, later /transactions call with the same merchant text and no
    // categoryId — this is the real proof the auto-created rule works, not
    // just that a CategorizationRule document exists somewhere.
    const newTxRes = await request(app)
      .post("/transactions")
      .set("Cookie", authCookie(userId))
      .send({ accountId: "acc-1", amount: -300, date: "2026-08-25", merchant: "ZOMATO", note: "Dinner" });

    expect(newTxRes.status).toBe(201);
    expect(newTxRes.body.categoryId).toBe("cat-food-delivery");
  });
});

describe("HDFC email-embedded balance ('Avl Bal') reconciliation", () => {
  it("captures the balance figure through the real Gmail parse path, then reconciles it on confirm", async () => {
    const userId = "user-email-balance-1";
    const account = await Account.create({
      userId,
      type: "bank",
      institution: "HDFC",
      nickname: "Savings",
      currentBalance: 100,
    });
    await GmailConnection.create({
      userId,
      refreshTokenEncrypted: encrypt("token"),
      status: "connected",
      historyId: "1",
    });
    await EmailSource.create({
      userId,
      senderPattern: "alerts@hdfcbank.net",
      institution: "HDFC",
      parserKey: "hdfc_debit_alert",
    });

    historyListMock.mockResolvedValue({
      data: { history: [{ messagesAdded: [{ message: { id: "email-balance-1" } }] }] },
    });
    getMessageMock.mockResolvedValue({
      data: {
        id: "email-balance-1",
        payload: {
          headers: [
            { name: "From", value: "alerts@hdfcbank.net" },
            { name: "Subject", value: "Debit Alert" },
          ],
          body: {
            data: Buffer.from(
              "Rs.250.00 debited from account XX1234 to ZOMATO on 20-08-26. Avl Bal: Rs.12,345.67"
            ).toString("base64"),
          },
        },
      },
    });

    const { processGmailNotification } = await import(
      "../../src/jobs/workers/gmailEmailParse.worker.js"
    );
    await processGmailNotification({ userId, historyId: "2" });

    const pending = await PendingTransaction.findOne({ userId });
    expect(pending!.emailBalance).toBe(12345.67);

    const confirmRes = await request(app)
      .post(`/pending-transactions/${pending!._id}/confirm`)
      .set("Cookie", authCookie(userId))
      .send({ accountId: account._id.toString() });
    expect(confirmRes.status).toBe(200);

    // Reconciled to the bank's own stated figure, NOT 100 - 250 = -150.
    const updatedAccount = await Account.findById(account._id);
    expect(updatedAccount!.currentBalance).toBe(12345.67);
    expect(updatedAccount!.balanceAsOf!.toISOString()).toBe(new Date("2026-08-20").toISOString());
  });

  it("staleness guard: confirming an OLDER email-balance pending transaction AFTER a newer one must not regress the balance", async () => {
    const userId = "user-email-balance-order";
    const cookie = authCookie(userId);
    const account = await Account.create({
      userId,
      type: "bank",
      institution: "HDFC",
      nickname: "Savings",
      currentBalance: 100,
    });

    // Newer transaction (Aug 20) arrives/confirms FIRST — e.g. Gmail history
    // backfill delivered it out of chronological order.
    const newer = await PendingTransaction.create({
      userId,
      accountId: account._id.toString(),
      amount: -300,
      date: new Date("2026-08-20"),
      merchant: "NEWER",
      source: "email_parsed",
      emailBalance: 9000,
    });
    // Older transaction (Aug 10), confirmed SECOND.
    const older = await PendingTransaction.create({
      userId,
      accountId: account._id.toString(),
      amount: -200,
      date: new Date("2026-08-10"),
      merchant: "OLDER",
      source: "email_parsed",
      emailBalance: 9500,
    });

    const newerRes = await request(app)
      .post(`/pending-transactions/${newer._id}/confirm`)
      .set("Cookie", cookie)
      .send({});
    expect(newerRes.status).toBe(200);
    expect((await Account.findById(account._id))!.currentBalance).toBe(9000);

    const olderRes = await request(app)
      .post(`/pending-transactions/${older._id}/confirm`)
      .set("Cookie", cookie)
      .send({});
    expect(olderRes.status).toBe(200);

    // Must STILL be 9000 — the older email's 9500 figure (and its own -200 delta,
    // which is deliberately never applied as a fallback either — see
    // applyConfirmedTransactionBalanceEffect's doc comment) must not overwrite the
    // more current, already-applied reconciliation.
    const finalAccount = await Account.findById(account._id);
    expect(finalAccount!.currentBalance).toBe(9000);
  });

  it("falls back to plain delta math when there is no emailBalance signal at all (e.g. SBI, which doesn't reliably send one)", async () => {
    const userId = "user-no-email-balance";
    const cookie = authCookie(userId);
    const account = await Account.create({
      userId,
      type: "bank",
      institution: "SBI",
      nickname: "Savings",
      currentBalance: 1000,
    });
    const pending = await PendingTransaction.create({
      userId,
      accountId: account._id.toString(),
      amount: -400,
      date: new Date("2026-08-10"),
      merchant: "SBI MERCHANT",
      source: "email_parsed",
      emailBalance: null,
    });

    const res = await request(app)
      .post(`/pending-transactions/${pending._id}/confirm`)
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(200);

    const updated = await Account.findById(account._id);
    expect(updated!.currentBalance).toBe(600); // plain delta: 1000 - 400
    expect(updated!.balanceAsOf).toBeNull(); // a plain delta never sets balanceAsOf
  });
});
