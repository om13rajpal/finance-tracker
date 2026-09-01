import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { PDFExtractPage, PDFExtractText } from "pdf.js-extract";
import { app } from "../../src/app.js";
import { Account } from "../../src/models/Account.js";
import { BalanceSnapshot } from "../../src/models/BalanceSnapshot.js";
import { ImportBatch } from "../../src/models/ImportBatch.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";
import { Transaction } from "../../src/models/Transaction.js";
import { processBulkConfirm } from "../../src/jobs/workers/bulkConfirmPending.worker.js";

function authCookie(userId: string) {
  return `token=${jwt.sign({ userId }, process.env.JWT_SECRET as string)}`;
}

/**
 * These tests exercise `processStatementUpload`'s real reconciliation logic
 * end-to-end (real ImportBatch/Account/BalanceSnapshot writes) against
 * PRECISELY controlled statement content — the staleness-guard scenario this
 * file is built for (process a newer statement, then an older one, confirm the
 * balance stays at the newer figure) needs two statements with specific,
 * different transaction dates and closing balances, which no pair of the
 * checked-in fixture PDFs provides. `tryUnlockPdf` (the PDF-decoding boundary)
 * is mocked so each test can hand `processStatementUpload` fabricated
 * `PDFExtractPage`s built the same way `statement-row-parser.test.ts` does for
 * the parser's own unit tests — everything past that boundary (parsing,
 * chunking, duplicate detection, reconciliation, persistence) is the real code.
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

const SUMMARY_LINES = (openingBalance: string, crCount: number, credits: string, closingBal: string) => [
  ["STATEMENT", "SUMMARY", ":-"],
  ["Opening", "Balance", "Dr", "Count", "Cr", "Count", "Debits", "Credits", "Closing", "Bal"],
  [openingBalance, "0", String(crCount), "0.00", credits, closingBal],
];

async function writeFakeTempFile(): Promise<string> {
  const p = path.join(os.tmpdir(), `statement-recon-test-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(p, Buffer.from("fake pdf bytes — never actually parsed, tryUnlockPdf is mocked"));
  return p;
}

async function createProcessingBatch(userId: string) {
  return ImportBatch.create({
    userId,
    source: "pdf_statement",
    filename: "statement.pdf",
    fileHash: crypto.randomBytes(16).toString("hex"),
    rowResults: [],
    resultingIds: [],
    status: "processing",
  });
}

async function createAccount(userId: string, currentBalance: number) {
  return Account.create({ userId, type: "bank", institution: "HDFC Bank", nickname: "Savings", currentBalance });
}

describe("processStatementUpload — balance reconciliation staleness guard", () => {
  afterEach(() => {
    unlockMock.mockReset();
  });

  it("processing a NEWER statement first, then an OLDER one, leaves the balance at the newer figure (does not regress)", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
    const userId = "user-staleness-guard";
    const account = await createAccount(userId, 0);

    const newerPages = [
      mkPage([HEADER_ROW, ["14/08/2026", "TEST", "NEWER", "-", "14/08/2026", "0.00", "6,000.00", "6,000.00"]]),
    ];
    const olderPages = [
      mkPage([HEADER_ROW, ["01/08/2026", "TEST", "OLDER", "-", "01/08/2026", "0.00", "5,000.00", "5,000.00"]]),
    ];

    // Process the NEWER statement (last transaction dated 2026-08-14) first.
    unlockMock.mockResolvedValueOnce({ success: true, pages: newerPages });
    const batch1 = await createProcessingBatch(userId);
    await processStatementUpload({
      batchId: batch1._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });

    expect((await Account.findById(account._id))!.currentBalance).toBe(6000);

    // Now process the OLDER statement (last transaction dated 2026-08-01) —
    // must NOT overwrite the more current 6000 figure with its own 5000.
    unlockMock.mockResolvedValueOnce({ success: true, pages: olderPages });
    const batch2 = await createProcessingBatch(userId);
    await processStatementUpload({
      batchId: batch2._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });

    const finalAccount = await Account.findById(account._id);
    expect(finalAccount!.currentBalance).toBe(6000);
    expect(finalAccount!.balanceAsOf!.toISOString()).toBe(new Date("2026-08-14").toISOString());

    // Both statements' own rows are still imported as PendingTransactions
    // regardless — the staleness guard protects only the balance FIGURE, not
    // the transaction history.
    const { PendingTransaction } = await import("../../src/models/PendingTransaction.js");
    expect(await PendingTransaction.countDocuments({ userId })).toBe(2);

    // Only ONE BalanceSnapshot — the older statement's rejected reconciliation
    // attempt must not have written one.
    expect(await BalanceSnapshot.countDocuments({ accountId: account._id.toString() })).toBe(1);
  });

  it("processing statements in chronological order applies each one (the later one wins, as expected)", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
    const userId = "user-staleness-chronological";
    const account = await createAccount(userId, 0);

    const olderPages = [
      mkPage([HEADER_ROW, ["01/08/2026", "TEST", "OLDER", "-", "01/08/2026", "0.00", "5,000.00", "5,000.00"]]),
    ];
    const newerPages = [
      mkPage([HEADER_ROW, ["14/08/2026", "TEST", "NEWER", "-", "14/08/2026", "0.00", "6,000.00", "6,000.00"]]),
    ];

    unlockMock.mockResolvedValueOnce({ success: true, pages: olderPages });
    const batch1 = await createProcessingBatch(userId);
    await processStatementUpload({
      batchId: batch1._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });
    expect((await Account.findById(account._id))!.currentBalance).toBe(5000);

    unlockMock.mockResolvedValueOnce({ success: true, pages: newerPages });
    const batch2 = await createProcessingBatch(userId);
    await processStatementUpload({
      batchId: batch2._id.toString(),
      userId,
      accountId: account._id.toString(),
      parserKey: "hdfc_statement",
      filePath: await writeFakeTempFile(),
    });
    expect((await Account.findById(account._id))!.currentBalance).toBe(6000);
  });

  describe("opening/closing balance data-quality cross-check (HDFC only)", () => {
    it("flags no mismatch when opening balance + summed rows agrees with the printed closing balance", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
      const userId = "user-mismatch-clean";
      const account = await createAccount(userId, 0);
      const pages = [
        mkPage([
          HEADER_ROW,
          ["01/08/2026", "TEST", "CLEAN", "-", "01/08/2026", "0.00", "5,000.00", "5,000.00"],
          ...SUMMARY_LINES("0.00", 1, "5,000.00", "5,000.00"),
        ]),
      ];
      unlockMock.mockResolvedValueOnce({ success: true, pages });
      const batch = await createProcessingBatch(userId);
      await processStatementUpload({
        batchId: batch._id.toString(),
        userId,
        accountId: account._id.toString(),
        parserKey: "hdfc_statement",
        filePath: await writeFakeTempFile(),
      });

      const updated = await ImportBatch.findById(batch._id);
      expect(updated!.closingBalance).toBe(5000);
      expect(updated!.expectedClosingBalance).toBe(5000);
      expect(updated!.closingBalanceMismatch).toBe(false);
    });

    it("flags a mismatch (without blocking the import) when a row's own numbers don't reconcile to the printed closing balance", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
      const userId = "user-mismatch-dirty";
      const account = await createAccount(userId, 0);
      // Opening 0 + this row's own deposit (5,000) implies a running balance of
      // 5,000 — but the row's OWN trailing balance column says 7,000, an
      // internally-inconsistent statement (simulating a missed/misparsed row).
      const pages = [
        mkPage([
          HEADER_ROW,
          ["01/08/2026", "TEST", "DIRTY", "-", "01/08/2026", "0.00", "5,000.00", "7,000.00"],
          ...SUMMARY_LINES("0.00", 1, "5,000.00", "7,000.00"),
        ]),
      ];
      unlockMock.mockResolvedValueOnce({ success: true, pages });
      const batch = await createProcessingBatch(userId);
      await processStatementUpload({
        batchId: batch._id.toString(),
        userId,
        accountId: account._id.toString(),
        parserKey: "hdfc_statement",
        filePath: await writeFakeTempFile(),
      });

      const updated = await ImportBatch.findById(batch._id);
      // closingBalance is still trusted/used for reconciliation as-is (7000) —
      // only flagged, never blocked or substituted.
      expect(updated!.closingBalance).toBe(7000);
      expect(updated!.expectedClosingBalance).toBe(5000);
      expect(updated!.closingBalanceMismatch).toBe(true);
      expect((await Account.findById(account._id))!.currentBalance).toBe(7000);
    });

    it("does not flag a mismatch for a parser with no opening-balance support (e.g. SBI's Clear Balance isn't opening+rows-based)", async () => {
    const processStatementUpload = await loadProcessStatementUpload();
      const userId = "user-mismatch-sbi";
      const account = await createAccount(userId, 0);
      const pages = [
        mkPage([
          ["WDL", "TFR"],
          ["01/08/2026", "01/08/2026", "UPI/DR/111111111111/TESTMERCHANT", "-", "500.00", "-", "10,000.00"],
        ]),
      ];
      unlockMock.mockResolvedValueOnce({ success: true, pages });
      const batch = await createProcessingBatch(userId);
      await processStatementUpload({
        batchId: batch._id.toString(),
        userId,
        accountId: account._id.toString(),
        parserKey: "sbi_statement",
        filePath: await writeFakeTempFile(),
      });

      const updated = await ImportBatch.findById(batch._id);
      expect(updated!.expectedClosingBalance).toBeNull();
      expect(updated!.closingBalanceMismatch).toBe(false);
    });
  });

  describe("does not double-count a reconciled import's own rows once they're confirmed", () => {
    it("stamps every pending row this import created as balanceReconciledAtImport once the closing-balance reconciliation applies", async () => {
      const processStatementUpload = await loadProcessStatementUpload();
      const userId = "user-recon-stamp";
      const account = await createAccount(userId, 0);
      const pages = [
        mkPage([
          HEADER_ROW,
          ["01/08/2026", "NB", "Subscription", "-", "01/08/2026", "0.00", "5,000.00", "5,000.00"],
          ["14/08/2026", "NB", "Subscription", "-", "14/08/2026", "0.00", "35,000.00", "40,000.00"],
        ]),
      ];
      unlockMock.mockResolvedValueOnce({ success: true, pages });
      const batch = await createProcessingBatch(userId);
      await processStatementUpload({
        batchId: batch._id.toString(),
        userId,
        accountId: account._id.toString(),
        parserKey: "hdfc_statement",
        filePath: await writeFakeTempFile(),
      });

      expect((await Account.findById(account._id))!.currentBalance).toBe(40000);
      const pendingRows = await PendingTransaction.find({ userId });
      expect(pendingRows).toHaveLength(2);
      for (const row of pendingRows) {
        expect(row.balanceReconciledAtImport).toBe(true);
      }
    });

    it("confirming a single reconciled-at-import row does NOT double-count its amount into the account balance", async () => {
      const processStatementUpload = await loadProcessStatementUpload();
      const userId = "user-recon-confirm-single";
      const account = await createAccount(userId, 0);
      const pages = [
        mkPage([
          HEADER_ROW,
          ["01/08/2026", "NB", "Subscription", "-", "01/08/2026", "0.00", "5,000.00", "5,000.00"],
        ]),
      ];
      unlockMock.mockResolvedValueOnce({ success: true, pages });
      const batch = await createProcessingBatch(userId);
      await processStatementUpload({
        batchId: batch._id.toString(),
        userId,
        accountId: account._id.toString(),
        parserKey: "hdfc_statement",
        filePath: await writeFakeTempFile(),
      });

      // The reconciliation already set this from the statement's own closing
      // balance, before anyone reviewed anything.
      expect((await Account.findById(account._id))!.currentBalance).toBe(5000);

      const pending = await PendingTransaction.findOne({ userId });
      const res = await request(app)
        .post(`/pending-transactions/${pending!._id}/confirm`)
        .set("Cookie", authCookie(userId))
        .send({});
      expect(res.status).toBe(200);

      // Confirming it must NOT ALSO add 5000 on top — the money was already
      // counted once, via the statement's own printed closing balance.
      expect((await Account.findById(account._id))!.currentBalance).toBe(5000);
    });

    it("bulk-confirming an entire reconciled-at-import batch does NOT double-count any of it", async () => {
      const processStatementUpload = await loadProcessStatementUpload();
      const userId = "user-recon-confirm-bulk";
      const account = await createAccount(userId, 0);
      const pages = [
        mkPage([
          HEADER_ROW,
          ["01/08/2026", "NB", "Subscription", "-", "01/08/2026", "0.00", "5,000.00", "5,000.00"],
          ["14/08/2026", "NB", "Subscription", "-", "14/08/2026", "0.00", "35,000.00", "40,000.00"],
        ]),
      ];
      unlockMock.mockResolvedValueOnce({ success: true, pages });
      const batch = await createProcessingBatch(userId);
      await processStatementUpload({
        batchId: batch._id.toString(),
        userId,
        accountId: account._id.toString(),
        parserKey: "hdfc_statement",
        filePath: await writeFakeTempFile(),
      });
      expect((await Account.findById(account._id))!.currentBalance).toBe(40000);

      const pendingIds = (await PendingTransaction.find({ userId })).map((p) => p._id.toString());
      // Bulk-confirm now only enqueues a job (see pending.routes.ts's doc
      // comment) — no worker runs during tests, so this drives
      // `processBulkConfirm` directly, the same pattern this file already
      // uses for `processStatementUpload` itself.
      const enqueueRes = await request(app)
        .post("/pending-transactions/bulk-confirm")
        .set("Cookie", authCookie(userId))
        .send({ ids: pendingIds });
      expect(enqueueRes.status).toBe(202);
      await processBulkConfirm({ batchId: enqueueRes.body.batchId, userId, ids: pendingIds });
      const confirmedCount = await Transaction.countDocuments({ userId });
      expect(confirmedCount).toBe(2);

      // Still 40000 — bulk-confirming both rows must not add their 5000+35000
      // on top of a balance that already reflects them.
      expect((await Account.findById(account._id))!.currentBalance).toBe(40000);
    });

    it("does NOT stamp (and confirming DOES apply the normal delta) when the reconciliation itself was rejected as stale", async () => {
      const processStatementUpload = await loadProcessStatementUpload();
      const userId = "user-recon-stale-not-stamped";
      const account = await createAccount(userId, 0);

      // Process the NEWER statement first, establishing balanceAsOf = 2026-08-14.
      const newerPages = [
        mkPage([HEADER_ROW, ["14/08/2026", "TEST", "NEWER", "-", "14/08/2026", "0.00", "6,000.00", "6,000.00"]]),
      ];
      unlockMock.mockResolvedValueOnce({ success: true, pages: newerPages });
      const batch1 = await createProcessingBatch(userId);
      await processStatementUpload({
        batchId: batch1._id.toString(),
        userId,
        accountId: account._id.toString(),
        parserKey: "hdfc_statement",
        filePath: await writeFakeTempFile(),
      });
      expect((await Account.findById(account._id))!.currentBalance).toBe(6000);

      // Now an OLDER statement — its own reconciliation attempt is rejected
      // as stale, so its own row must NOT be stamped, and confirming it later
      // must apply its normal delta (nothing already accounted for it).
      const olderPages = [
        mkPage([HEADER_ROW, ["01/08/2026", "TEST", "OLDER", "-", "01/08/2026", "0.00", "1,500.00", "1,500.00"]]),
      ];
      unlockMock.mockResolvedValueOnce({ success: true, pages: olderPages });
      const batch2 = await createProcessingBatch(userId);
      await processStatementUpload({
        batchId: batch2._id.toString(),
        userId,
        accountId: account._id.toString(),
        parserKey: "hdfc_statement",
        filePath: await writeFakeTempFile(),
      });

      // Balance stayed at the newer figure — the older statement's
      // reconciliation was correctly rejected.
      expect((await Account.findById(account._id))!.currentBalance).toBe(6000);

      const olderBatchDoc = await ImportBatch.findById(batch2._id);
      const olderRow = await PendingTransaction.findOne({ _id: olderBatchDoc!.resultingIds[0] });
      expect(olderRow!.balanceReconciledAtImport).toBe(false);

      const res = await request(app)
        .post(`/pending-transactions/${olderRow!._id}/confirm`)
        .set("Cookie", authCookie(userId))
        .send({});
      expect(res.status).toBe(200);

      // This row's own 1,500 was never accounted for by any reconciliation
      // (its own was rejected as stale), so confirming it must apply its
      // normal delta on top of the current 6000.
      expect((await Account.findById(account._id))!.currentBalance).toBe(7500);
    });
  });
});
