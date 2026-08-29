import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { EmailSource } from "../../src/models/EmailSource.js";
import { GmailConnection } from "../../src/models/GmailConnection.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";
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
