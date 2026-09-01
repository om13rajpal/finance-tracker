import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EmailSource } from "../../src/models/EmailSource.js";
import { GmailConnection } from "../../src/models/GmailConnection.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";
import { EmailImportLog } from "../../src/models/EmailImportLog.js";
import { ImportBatch } from "../../src/models/ImportBatch.js";
import { encrypt } from "../../src/lib/encryption.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(__dirname, "..", "fixtures", "statement-unprotected.pdf");

// Same reasoning as pending-transactions-email-flow.test.ts for `vi.hoisted`:
// this file's import chain reaches `googleapis` via `app.js`/the worker
// module before a later `const` in this file's body would have run.
const { historyListMock, getMessageMock, getAttachmentMock } = vi.hoisted(() => ({
  historyListMock: vi.fn(),
  getMessageMock: vi.fn(),
  getAttachmentMock: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn() })) },
    gmail: vi.fn().mockReturnValue({
      users: {
        history: { list: historyListMock },
        messages: { get: getMessageMock, attachments: { get: getAttachmentMock } },
      },
    }),
  },
}));

function pdfAttachmentBase64Url(): string {
  const buf = fs.readFileSync(FIXTURE_PDF);
  return buf.toString("base64url");
}

function messageWithAttachment(opts: {
  id: string;
  from: string;
  subject?: string;
  bodyText?: string;
  attachmentId?: string;
  filename?: string;
}) {
  const parts: Array<{
    mimeType?: string;
    filename?: string;
    body: { data?: string; attachmentId?: string; size?: number };
  }> = [];
  if (opts.bodyText !== undefined) {
    parts.push({ mimeType: "text/plain", body: { data: Buffer.from(opts.bodyText).toString("base64") } });
  }
  if (opts.attachmentId) {
    parts.push({
      filename: opts.filename ?? "statement.pdf",
      body: { attachmentId: opts.attachmentId, size: 12345 },
    });
  }
  return {
    data: {
      id: opts.id,
      payload: {
        headers: [
          { name: "From", value: opts.from },
          { name: "Subject", value: opts.subject ?? "Statement" },
        ],
        parts,
      },
    },
  };
}

describe("Gmail worker — PDF statement attachment handling", () => {
  it("never fetches an attachment from an untrusted (unregistered) sender", async () => {
    const userId = "user-pdf-untrusted";
    await GmailConnection.create({ userId, refreshTokenEncrypted: encrypt("t"), status: "connected", historyId: "1" });
    // Deliberately no EmailSource registered for this sender.

    historyListMock.mockResolvedValue({ data: { history: [{ messagesAdded: [{ message: { id: "untrusted-1" } }] }] } });
    getMessageMock.mockResolvedValue(
      messageWithAttachment({ id: "untrusted-1", from: "attacker@evil.com", attachmentId: "att-1" })
    );

    const { processGmailNotification } = await import("../../src/jobs/workers/gmailEmailParse.worker.js");
    await processGmailNotification({ userId, historyId: "2" });

    expect(getAttachmentMock).not.toHaveBeenCalled();
    expect(await PendingTransaction.countDocuments({ userId })).toBe(0);
  });

  it("unlocks and parses a trusted sender's PDF attachment into pending transactions with accountId: null", async () => {
    const userId = "user-pdf-trusted";
    await GmailConnection.create({ userId, refreshTokenEncrypted: encrypt("t"), status: "connected", historyId: "1" });
    await EmailSource.create({
      userId,
      senderPattern: "estatements@sbi.co.in",
      institution: "Test Bank",
      parserKey: "hdfc_debit_alert", // unrelated to the statement parser key — email-body parser namespace
    });

    historyListMock.mockResolvedValue({ data: { history: [{ messagesAdded: [{ message: { id: "trusted-1" } }] }] } });
    getMessageMock.mockResolvedValue(
      messageWithAttachment({ id: "trusted-1", from: "estatements@sbi.co.in", attachmentId: "att-trusted-1" })
    );
    getAttachmentMock.mockResolvedValue({ data: { data: pdfAttachmentBase64Url() } });

    const { processGmailNotification } = await import("../../src/jobs/workers/gmailEmailParse.worker.js");
    await processGmailNotification({ userId, historyId: "2" });

    expect(getAttachmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "me", messageId: "trusted-1", id: "att-trusted-1" })
    );

    const pending = await PendingTransaction.find({ userId });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].accountId).toBeNull();
    expect(pending[0].source).toBe("pdf_statement_parsed");

    const batch = await ImportBatch.findOne({ userId });
    expect(batch).not.toBeNull();
    expect(batch!.source).toBe("pdf_statement");

    const log = await EmailImportLog.findOne({ emailId: "trusted-1:pdf" });
    expect(log).not.toBeNull();
    expect(log!.parseStatus).toBe("success");
  });

  it("does not double-process the same attachment when a Pub/Sub notification is redelivered", async () => {
    const userId = "user-pdf-redelivered";
    await GmailConnection.create({ userId, refreshTokenEncrypted: encrypt("t"), status: "connected", historyId: "1" });
    await EmailSource.create({ userId, senderPattern: "estatements@sbi.co.in", institution: "Test Bank", parserKey: "hdfc_debit_alert" });

    historyListMock.mockResolvedValue({ data: { history: [{ messagesAdded: [{ message: { id: "redelivered-1" } }] }] } });
    getMessageMock.mockResolvedValue(
      messageWithAttachment({ id: "redelivered-1", from: "estatements@sbi.co.in", attachmentId: "att-redelivered-1" })
    );
    getAttachmentMock.mockResolvedValue({ data: { data: pdfAttachmentBase64Url() } });

    const { processGmailNotification } = await import("../../src/jobs/workers/gmailEmailParse.worker.js");
    await processGmailNotification({ userId, historyId: "2" });
    const firstCount = await PendingTransaction.countDocuments({ userId });
    expect(firstCount).toBeGreaterThan(0);

    // Redeliver: same emailId shows up again in a later history.list response.
    historyListMock.mockResolvedValue({ data: { history: [{ messagesAdded: [{ message: { id: "redelivered-1" } }] }] } });
    await processGmailNotification({ userId, historyId: "3" });

    expect(await PendingTransaction.countDocuments({ userId })).toBe(firstCount);
    expect(await ImportBatch.countDocuments({ userId })).toBe(1);
  });

  it("produces both outcomes independently for an email with both a parseable body alert and a PDF attachment", async () => {
    const userId = "user-pdf-both";
    await GmailConnection.create({ userId, refreshTokenEncrypted: encrypt("t"), status: "connected", historyId: "1" });
    await EmailSource.create({ userId, senderPattern: "alerts@hdfcbank.net", institution: "Test Bank", parserKey: "hdfc_debit_alert" });

    historyListMock.mockResolvedValue({ data: { history: [{ messagesAdded: [{ message: { id: "both-1" } }] }] } });
    getMessageMock.mockResolvedValue(
      messageWithAttachment({
        id: "both-1",
        from: "alerts@hdfcbank.net",
        bodyText: "Rs.250.00 debited from account XX1234 to ZOMATO on 20-08-26",
        attachmentId: "att-both-1",
      })
    );
    getAttachmentMock.mockResolvedValue({ data: { data: pdfAttachmentBase64Url() } });

    const { processGmailNotification } = await import("../../src/jobs/workers/gmailEmailParse.worker.js");
    await processGmailNotification({ userId, historyId: "2" });

    // Body-alert outcome: one email_parsed pending transaction with accountId null.
    const emailParsed = await PendingTransaction.findOne({ userId, source: "email_parsed" });
    expect(emailParsed).not.toBeNull();
    expect(emailParsed!.merchant).toBe("ZOMATO");

    // Attachment outcome: at least one pdf_statement_parsed pending transaction, independently created.
    const pdfParsed = await PendingTransaction.findOne({ userId, source: "pdf_statement_parsed" });
    expect(pdfParsed).not.toBeNull();

    // Two independent EmailImportLog rows: the plain emailId (body) and the ":pdf" synthetic key (attachment).
    const bodyLog = await EmailImportLog.findOne({ emailId: "both-1" });
    const pdfLog = await EmailImportLog.findOne({ emailId: "both-1:pdf" });
    expect(bodyLog).not.toBeNull();
    expect(pdfLog).not.toBeNull();
  });

  it("never blocks the rest of the mailbox sync when unlocking the attachment fails", async () => {
    const userId = "user-pdf-unlockfail";
    await GmailConnection.create({ userId, refreshTokenEncrypted: encrypt("t"), status: "connected", historyId: "1" });
    await EmailSource.create({ userId, senderPattern: "estatements@sbi.co.in", institution: "SBI", parserKey: "hdfc_debit_alert" });

    historyListMock.mockResolvedValue({ data: { history: [{ messagesAdded: [{ message: { id: "unlockfail-1" } }] }] } });
    getMessageMock.mockResolvedValue(
      messageWithAttachment({ id: "unlockfail-1", from: "estatements@sbi.co.in", attachmentId: "att-unlockfail-1" })
    );
    // Garbage bytes — not a valid PDF at all.
    getAttachmentMock.mockResolvedValue({ data: { data: Buffer.from("not a real pdf").toString("base64url") } });

    const { processGmailNotification } = await import("../../src/jobs/workers/gmailEmailParse.worker.js");
    await expect(processGmailNotification({ userId, historyId: "2" })).resolves.not.toThrow();

    expect(await PendingTransaction.countDocuments({ userId })).toBe(0);
    // The Gmail connection's historyId should still advance — the sync isn't blocked.
    const connection = await GmailConnection.findOne({ userId });
    expect(connection!.historyId).toBe("2");
  });
});
