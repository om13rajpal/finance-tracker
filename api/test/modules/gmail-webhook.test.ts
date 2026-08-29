import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { EmailSource } from "../../src/models/EmailSource.js";
import { EmailImportLog } from "../../src/models/EmailImportLog.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";
import { GmailConnection } from "../../src/models/GmailConnection.js";
import { encrypt } from "../../src/lib/encryption.js";

// `vi.mock`'s factory is hoisted above ALL of this file's top-level code,
// including its own imports — and this file statically imports `app.js`,
// whose import chain reaches `googleapis` at module-evaluation time (before
// this file's own body runs). A plain `const historyListMock = vi.fn()`
// declared below would still be in its temporal dead zone when the factory
// first runs, causing a "Cannot access before initialization" error.
// `vi.hoisted()` is hoisted together with `vi.mock`, so these are
// initialized in time.
const { historyListMock, getMessageMock } = vi.hoisted(() => ({
  historyListMock: vi.fn(),
  getMessageMock: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn() })) },
    gmail: vi.fn().mockReturnValue({
      users: {
        history: { list: historyListMock },
        messages: { get: getMessageMock },
      },
    }),
  },
}));

function pubsubBody(userId: string, historyId: string) {
  const data = Buffer.from(JSON.stringify({ emailAddress: "me@example.com", historyId })).toString(
    "base64"
  );
  return {
    message: { data, messageId: "pubsub-msg-1" },
    subscription: "projects/test/subscriptions/test",
    state: userId,
  };
}

function hdfcMessage(id: string, from: string, body: string) {
  return {
    data: {
      id,
      payload: {
        headers: [
          { name: "From", value: from },
          { name: "Subject", value: "Debit Alert" },
        ],
        body: { data: Buffer.from(body).toString("base64") },
      },
    },
  };
}

describe("gmail webhook", () => {
  it("rejects requests without the correct shared secret", async () => {
    const res = await request(app).post("/webhooks/gmail").send(pubsubBody("user-1", "100"));
    expect(res.status).toBe(403);
  });

  it("rejects requests with an incorrect (but non-empty) shared secret", async () => {
    const res = await request(app)
      .post(`/webhooks/gmail?token=${process.env.GMAIL_WEBHOOK_SECRET}-wrong`)
      .send(pubsubBody("user-1", "100"));
    expect(res.status).toBe(403);
  });

  it("accepts, enqueues, and returns 204 immediately without touching the Gmail API synchronously", async () => {
    historyListMock.mockClear();
    getMessageMock.mockClear();

    const { gmailEmailParseQueue } =
      await import("../../src/modules/email-ingestion/gmail-webhook.routes.js");
    await gmailEmailParseQueue.drain();

    const res = await request(app)
      .post(`/webhooks/gmail?token=${process.env.GMAIL_WEBHOOK_SECRET}`)
      .send(pubsubBody("user-1", "100"));

    expect(res.status).toBe(204);

    // The handler must do the minimum — enqueue and respond — never call the
    // Gmail API itself. If it had, these mocks (Gmail is fully mocked in this
    // file) would have been invoked as part of handling the request above.
    expect(historyListMock).not.toHaveBeenCalled();
    expect(getMessageMock).not.toHaveBeenCalled();

    const waiting = await gmailEmailParseQueue.getJobs(["waiting", "completed"]);
    const job = waiting.find((j) => j.data.userId === "user-1" && j.data.historyId === "100");
    expect(job).toBeDefined();
  });

  it("processGmailNotification parses a matching-sender email into a PendingTransaction, skips a non-matching sender, and dedups a redelivered notification for the same email id", async () => {
    await GmailConnection.create({
      userId: "user-1",
      refreshTokenEncrypted: encrypt("token"),
      status: "connected",
      historyId: "99",
    });
    await EmailSource.create({
      userId: "user-1",
      senderPattern: "alerts@hdfcbank.net",
      institution: "HDFC",
      parserKey: "hdfc_debit_alert",
    });

    historyListMock.mockResolvedValue({
      data: {
        history: [
          { messagesAdded: [{ message: { id: "email-1" } }] },
          { messagesAdded: [{ message: { id: "email-2" } }] },
        ],
      },
    });
    getMessageMock.mockImplementation(({ id }: { id: string }) => {
      if (id === "email-1") {
        return Promise.resolve(
          hdfcMessage(
            "email-1",
            "HDFC Bank <alerts@hdfcbank.net>",
            "Rs.499.00 debited from account XX1234 to SWIGGY on 15-08-26"
          )
        );
      }
      return Promise.resolve(
        hdfcMessage("email-2", "no-reply@somenewsletter.com", "Not a bank email")
      );
    });

    const { processGmailNotification } =
      await import("../../src/jobs/workers/gmailEmailParse.worker.js");
    await processGmailNotification({ userId: "user-1", historyId: "101" });

    const pending = await PendingTransaction.find({ userId: "user-1" });
    expect(pending).toHaveLength(1);
    expect(pending[0].merchant).toBe("SWIGGY");
    expect(pending[0].amount).toBe(-499);

    const logs = await EmailImportLog.find({ userId: "user-1" }).sort({ emailId: 1 });
    expect(logs).toHaveLength(2);
    expect(logs.find((l) => l.emailId === "email-1")?.parseStatus).toBe("success");
    expect(logs.find((l) => l.emailId === "email-1")?.resultingPendingTransactionId).toBe(
      pending[0]._id.toString()
    );
    expect(logs.find((l) => l.emailId === "email-2")?.parseStatus).toBe("unmatched");

    // Now simulate the SAME Pub/Sub notification being redelivered (e.g. Pub/Sub
    // didn't see the earlier 204 in time and retried). `test/setup.ts` wipes all
    // collections between separate `it()` blocks, so this has to happen within
    // the same test to actually exercise redelivery against already-written state.
    historyListMock.mockResolvedValue({
      data: { history: [{ messagesAdded: [{ message: { id: "email-1" } }] }] },
    });
    await processGmailNotification({ userId: "user-1", historyId: "102" });

    const pendingAfterRedelivery = await PendingTransaction.find({ userId: "user-1" });
    expect(pendingAfterRedelivery).toHaveLength(1); // still just the one — email-1 was already logged
    const logsAfterRedelivery = await EmailImportLog.find({ userId: "user-1" });
    expect(logsAfterRedelivery).toHaveLength(2); // no new EmailImportLog row was added either
  });

  it("does not match a lookalike sender that merely contains the trusted address as a substring", async () => {
    await GmailConnection.create({
      userId: "user-spoof",
      refreshTokenEncrypted: encrypt("token"),
      status: "connected",
      historyId: "1",
    });
    await EmailSource.create({
      userId: "user-spoof",
      senderPattern: "alerts@hdfcbank.net",
      institution: "HDFC",
      parserKey: "hdfc_debit_alert",
    });

    historyListMock.mockResolvedValue({
      data: { history: [{ messagesAdded: [{ message: { id: "email-spoof-1" } }] }] },
    });
    getMessageMock.mockImplementation(() =>
      Promise.resolve(
        hdfcMessage(
          "email-spoof-1",
          // A lookalike address that a naive `.includes()` check on the raw
          // header would treat as a match for "alerts@hdfcbank.net".
          "HDFC Bank <alerts@hdfcbank.net.evil.com>",
          "Rs.999.00 debited from account XX1234 to ATTACKER on 15-08-26"
        )
      )
    );

    const { processGmailNotification } =
      await import("../../src/jobs/workers/gmailEmailParse.worker.js");
    await processGmailNotification({ userId: "user-spoof", historyId: "2" });

    const pending = await PendingTransaction.find({ userId: "user-spoof" });
    expect(pending).toHaveLength(0);

    const log = await EmailImportLog.findOne({ emailId: "email-spoof-1" });
    expect(log?.parseStatus).toBe("unmatched");
  });

  it("marks the connection disconnected when history.list reports a revoked token", async () => {
    await GmailConnection.create({
      userId: "user-revoked-2",
      refreshTokenEncrypted: encrypt("token"),
      status: "connected",
      historyId: "50",
    });

    historyListMock.mockRejectedValueOnce({ code: 401, message: "invalid_grant" });

    const { processGmailNotification } =
      await import("../../src/jobs/workers/gmailEmailParse.worker.js");
    await processGmailNotification({ userId: "user-revoked-2", historyId: "51" });

    const connection = await GmailConnection.findOne({ userId: "user-revoked-2" });
    expect(connection?.status).toBe("disconnected");
  });

  it("a redelivered notification processed concurrently still produces only one PendingTransaction (dedup race)", async () => {
    await GmailConnection.create({
      userId: "user-race",
      refreshTokenEncrypted: encrypt("token"),
      status: "connected",
      historyId: "1",
    });
    await EmailSource.create({
      userId: "user-race",
      senderPattern: "alerts@hdfcbank.net",
      institution: "HDFC",
      parserKey: "hdfc_debit_alert",
    });

    historyListMock.mockResolvedValue({
      data: { history: [{ messagesAdded: [{ message: { id: "email-race-1" } }] }] },
    });
    getMessageMock.mockImplementation(() =>
      Promise.resolve(
        hdfcMessage(
          "email-race-1",
          "HDFC Bank <alerts@hdfcbank.net>",
          "Rs.100.00 debited from account XX1234 to RACEMERCHANT on 15-08-26"
        )
      )
    );

    const { processGmailNotification } =
      await import("../../src/jobs/workers/gmailEmailParse.worker.js");

    // Simulate the same Pub/Sub notification being redelivered and processed
    // by two overlapping job runs before either has written its
    // EmailImportLog row (the scenario the `findOne` pre-check alone cannot
    // prevent — see the comment on `tryReserveImportLog`).
    await Promise.all([
      processGmailNotification({ userId: "user-race", historyId: "2" }),
      processGmailNotification({ userId: "user-race", historyId: "2" }),
    ]);

    const pending = await PendingTransaction.find({ userId: "user-race" });
    expect(pending).toHaveLength(1);

    const logs = await EmailImportLog.find({ emailId: "email-race-1" });
    expect(logs).toHaveLength(1);
    expect(logs[0].parseStatus).toBe("success");
    expect(logs[0].resultingPendingTransactionId).toBe(pending[0]._id.toString());
  });
});
