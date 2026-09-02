import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PDFExtractPage, PDFExtractText } from "pdf.js-extract";
import { Account } from "../../src/models/Account.js";
import { ImportBatch } from "../../src/models/ImportBatch.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";

/**
 * Same fabricated-page technique `statementProcess.worker.overlap.test.ts`
 * uses: `tryUnlockPdf` mocked, everything past it (parsing, cleanup,
 * persistence) real.
 */
const { unlockMock } = vi.hoisted(() => ({ unlockMock: vi.fn() }));
vi.mock("../../src/modules/statements/pdf-unlock.service.js", () => ({
  tryUnlockPdf: unlockMock,
}));

async function loadProcessStatementUpload() {
  const mod = await import("../../src/jobs/workers/statementProcess.worker.js");
  return mod.processStatementUpload;
}

function mkPage(lines: string[][]): PDFExtractPage {
  const content: PDFExtractText[] = [];
  lines.forEach((words, lineIdx) => {
    words.forEach((word, wordIdx) => {
      content.push({
        str: word,
        x: wordIdx * 60,
        y: lineIdx * 20,
        width: word.length * 6,
        height: 12,
        transform: [1, 0, 0, 1, wordIdx * 60, lineIdx * 20],
        font: { size: 10 },
        dir: "ltr",
        hasEOL: wordIdx === words.length - 1,
      });
    });
  });
  return {
    info: {
      num: 1,
      scale: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      width: 600,
      height: 800,
      view: { minX: 0, minY: 0, maxX: 600, maxY: 800 },
    },
    content,
  };
}

async function writeFakeTempFile(): Promise<string> {
  const p = path.join(os.tmpdir(), `statement-sbi-note-test-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(p, Buffer.from("fake pdf bytes, never actually parsed, tryUnlockPdf is mocked"));
  return p;
}

async function createProcessingBatch(userId: string, accountId: string) {
  return ImportBatch.create({
    userId,
    accountId,
    source: "pdf_statement",
    filename: "statement.pdf",
    fileHash: crypto.randomBytes(16).toString("hex"),
    rowResults: [],
    resultingIds: [],
    status: "processing",
  });
}

async function createAccount(userId: string) {
  return Account.create({ userId, type: "bank", institution: "State Bank of India", nickname: "Savings", currentBalance: 0 });
}

describe("processStatementUpload: SBI rows keep both their label AND their raw narration in `note`", () => {
  afterEach(() => {
    unlockMock.mockReset();
  });

  // Reproduces a real, silent data-loss bug found against production data:
  // `note: row.note || row.merchant` in statementProcess.worker.ts assumed
  // EVERY parser leaves `row.note` empty (true for HDFC/generic, which
  // always return `note: ""`), so the raw narration text only ever needed
  // rescuing into `note` as a fallback. SBI's parser breaks that assumption
  // on purpose: it deliberately returns a real, non-empty label
  // (`row.note ?? ""`, e.g. "WDL TFR") for essentially every transfer row.
  // Because that label is truthy, the `||` picked it over the raw narration
  // every time, and the raw narration — the ONLY place any payee-identifying
  // text ever existed — was silently discarded and never recoverable again,
  // confirmed directly against 70 real production PendingTransaction
  // documents from a single SBI import, every one of which had `note: "WDL
  // TFR"` instead of its own narration.
  it("keeps the raw narration in note even when the SBI parser also supplies a label, instead of the label silently replacing it", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
    const userId = "user-sbi-note-preserve";
    const account = await createAccount(userId);
    const batch = await createProcessingBatch(userId, account._id.toString());

    unlockMock.mockResolvedValueOnce({
      success: true,
      pages: [
        mkPage([
          ["WDL TFR"],
          ["15/08/2026", "15/08/2026", "UPI/DR/622763219941/HUNGERBOX", "-", "20.00", "-", "1000.00"],
          ["AIRP/hungerbox./UPI"],
        ]),
      ],
    });

    await processStatementUpload({
      batchId: batch._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "sbi_statement",
      filePath: await writeFakeTempFile(),
    });

    const pending = await PendingTransaction.findOne({ userId });
    expect(pending).not.toBeNull();
    // The label is still there...
    expect(pending!.note).toContain("WDL TFR");
    // ...but so is the raw narration: nothing about who the money went to is lost.
    expect(pending!.note).toContain("UPI/DR/622763219941/HUNGERBOX");
  });

  it("still just uses the raw narration for a parser (HDFC/generic) that never supplies a label, unchanged from before", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
    const userId = "user-hdfc-note-unchanged";
    const account = await Account.create({
      userId,
      type: "bank",
      institution: "HDFC Bank",
      nickname: "Savings",
      currentBalance: 0,
    });
    const batch = await createProcessingBatch(userId, account._id.toString());

    unlockMock.mockResolvedValueOnce({
      success: true,
      pages: [
        mkPage([
          [
            "Date",
            "Narration",
            "Chq.",
            "/",
            "Ref",
            "No.",
            "Value",
            "Date",
            "Withdrawal",
            "Amount",
            "Deposit",
            "Amount",
            "Closing",
            "Balance*",
          ],
          ["15/08/2026", "UPI-DR-111", "SOMEPAYEE", "REF999", "15/08/2026", "20.00", "0.00", "980.00"],
        ]),
      ],
    });

    await processStatementUpload({
      batchId: batch._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });

    const pending = await PendingTransaction.findOne({ userId });
    expect(pending).not.toBeNull();
    expect(pending!.note).toBe("UPI-DR-111 SOMEPAYEE");
  });
});
