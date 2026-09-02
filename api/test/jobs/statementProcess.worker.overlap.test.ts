import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PDFExtractPage, PDFExtractText } from "pdf.js-extract";
import { Account } from "../../src/models/Account.js";
import { ImportBatch } from "../../src/models/ImportBatch.js";

/**
 * Same fabricated-page technique `statementProcess.worker.reconciliation.test.ts`
 * uses (see that file's own doc comment): `tryUnlockPdf` mocked, everything
 * past it (parsing, chunking, the overlap check, persistence) real.
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

const HEADER_ROW = [
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
];

/** One row per date, alternating merchant text so rows never collide with
 * `findLikelyDuplicate`'s own account+amount+date window. */
function pageWithRows(dates: string[]): PDFExtractPage {
  const lines = [HEADER_ROW];
  dates.forEach((d, i) => {
    lines.push([d, "TEST", `ROW${i}`, "-", d, "0.00", `${100 + i}.00`, `${1000 + i}.00`]);
  });
  return mkPage(lines);
}

async function writeFakeTempFile(): Promise<string> {
  const p = path.join(os.tmpdir(), `statement-overlap-test-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(p, Buffer.from("fake pdf bytes, never actually parsed, tryUnlockPdf is mocked"));
  return p;
}

async function createProcessingBatch(userId: string, accountId: string, filename = "statement.pdf") {
  return ImportBatch.create({
    userId,
    accountId,
    source: "pdf_statement",
    filename,
    fileHash: crypto.randomBytes(16).toString("hex"),
    rowResults: [],
    resultingIds: [],
    status: "processing",
  });
}

async function createAccount(userId: string) {
  return Account.create({ userId, type: "bank", institution: "HDFC Bank", nickname: "Savings", currentBalance: 0 });
}

describe("processStatementUpload: cross-statement date-range overlap warning", () => {
  afterEach(() => {
    unlockMock.mockReset();
  });

  it("warns when a second statement's date range overlaps the first, on the same account", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
    const userId = "user-overlap-basic";
    const account = await createAccount(userId);

    unlockMock.mockResolvedValueOnce({
      success: true,
      pages: [pageWithRows(["01/06/2026", "15/06/2026", "30/06/2026"])],
    });
    const batch1 = await createProcessingBatch(userId, account._id.toString(), "june.pdf");
    await processStatementUpload({
      batchId: batch1._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });
    expect((await ImportBatch.findById(batch1._id))!.overlapWarning).toBeNull();

    // Overlaps June 15-30 (15 days) with the first statement.
    unlockMock.mockResolvedValueOnce({
      success: true,
      pages: [pageWithRows(["15/06/2026", "30/06/2026", "15/07/2026"])],
    });
    const batch2 = await createProcessingBatch(userId, account._id.toString(), "june-july.pdf");
    await processStatementUpload({
      batchId: batch2._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });

    const finalBatch = await ImportBatch.findById(batch2._id);
    expect(finalBatch!.overlapWarning).toContain("june.pdf");
    expect(finalBatch!.overlapWarning).toMatch(/\d+ days?/);
  });

  it("does not warn when two statements' date ranges don't overlap at all", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
    const userId = "user-overlap-none";
    const account = await createAccount(userId);

    unlockMock.mockResolvedValueOnce({ success: true, pages: [pageWithRows(["01/06/2026", "30/06/2026"])] });
    const batch1 = await createProcessingBatch(userId, account._id.toString(), "june.pdf");
    await processStatementUpload({
      batchId: batch1._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });

    unlockMock.mockResolvedValueOnce({ success: true, pages: [pageWithRows(["01/08/2026", "30/08/2026"])] });
    const batch2 = await createProcessingBatch(userId, account._id.toString(), "august.pdf");
    await processStatementUpload({
      batchId: batch2._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });

    expect((await ImportBatch.findById(batch2._id))!.overlapWarning).toBeNull();
  });

  it("does not warn about an overlap on a DIFFERENT account for the same user", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
    const userId = "user-overlap-diff-account";
    const accountA = await createAccount(userId);
    const accountB = await createAccount(userId);

    unlockMock.mockResolvedValueOnce({ success: true, pages: [pageWithRows(["01/06/2026", "30/06/2026"])] });
    const batch1 = await createProcessingBatch(userId, accountA._id.toString(), "acct-a.pdf");
    await processStatementUpload({
      batchId: batch1._id.toString(),
      userId,
      accountId: accountA._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });

    unlockMock.mockResolvedValueOnce({ success: true, pages: [pageWithRows(["01/06/2026", "30/06/2026"])] });
    const batch2 = await createProcessingBatch(userId, accountB._id.toString(), "acct-b.pdf");
    await processStatementUpload({
      batchId: batch2._id.toString(),
      userId,
      accountId: accountB._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });

    expect((await ImportBatch.findById(batch2._id))!.overlapWarning).toBeNull();
  });

  it("stores the statement's own date range on the batch", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
    const userId = "user-overlap-daterange";
    const account = await createAccount(userId);

    unlockMock.mockResolvedValueOnce({ success: true, pages: [pageWithRows(["05/06/2026", "20/06/2026"])] });
    const batch = await createProcessingBatch(userId, account._id.toString());
    await processStatementUpload({
      batchId: batch._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });

    const finalBatch = await ImportBatch.findById(batch._id);
    expect(finalBatch!.dateRange!.start.toISOString().slice(0, 10)).toBe("2026-06-05");
    expect(finalBatch!.dateRange!.end.toISOString().slice(0, 10)).toBe("2026-06-20");
  });
});
