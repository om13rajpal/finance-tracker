import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { ImportBatch } from "../../src/models/ImportBatch.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";
import { StatementPassword } from "../../src/models/StatementPassword.js";
import { encrypt } from "../../src/lib/encryption.js";
import { processStatementUpload } from "../../src/jobs/workers/statementProcess.worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures");

function fixtureBuffer(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name));
}

/** Mirrors what the route handler does: copy a fixture's bytes to a fresh temp file. */
async function writeTempFile(buffer: Buffer): Promise<string> {
  const p = path.join(os.tmpdir(), `statement-test-${crypto.randomUUID()}.pdf`);
  await fsp.writeFile(p, buffer);
  return p;
}

async function createProcessingBatch(userId: string, filename = "statement.pdf") {
  return ImportBatch.create({
    userId,
    source: "pdf_statement",
    filename,
    fileHash: crypto.randomBytes(16).toString("hex"),
    rowResults: [],
    resultingIds: [],
    status: "processing",
  });
}

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

describe("processStatementUpload (statement-process worker)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("processes a small unprotected statement end-to-end: completes the batch and creates PendingTransactions", async () => {
    const userId = "user-worker-happy";
    const accountId = "acc-1";
    const batch = await createProcessingBatch(userId);
    const filePath = await writeTempFile(fixtureBuffer("statement-unprotected.pdf"));

    await processStatementUpload({
      batchId: batch._id.toString(),
      userId,
      accountId,
      filePath,
    });

    const updated = await ImportBatch.findById(batch._id);
    expect(updated!.status).toBe("completed");
    expect(updated!.error).toBeNull();
    expect(updated!.rowResults.length).toBeGreaterThan(0);
    expect(updated!.resultingIds.length).toBeGreaterThan(0);

    const pendingCount = await PendingTransaction.countDocuments({ userId });
    expect(pendingCount).toBe(updated!.resultingIds.length);

    const pending = await PendingTransaction.findOne({ userId });
    expect(pending!.source).toBe("pdf_statement_parsed");
    expect(pending!.accountId).toBe(accountId);

    // Terminal (success) path cleans up its own temp file.
    expect(fileExists(filePath)).toBe(false);
  });

  it("an unlock failure sets status:failed with an error message rather than throwing/retrying", async () => {
    const userId = "user-worker-unlock-fail";
    const accountId = "acc-1";
    await StatementPassword.create({ userId, label: "wrong", passwordEncrypted: encrypt("nope") });
    const batch = await createProcessingBatch(userId);
    const filePath = await writeTempFile(fixtureBuffer("statement-protected.pdf"));

    await expect(
      processStatementUpload({ batchId: batch._id.toString(), userId, accountId, filePath })
    ).resolves.toBeUndefined(); // never throws for an unlock failure

    const updated = await ImportBatch.findById(batch._id);
    expect(updated!.status).toBe("failed");
    expect(updated!.error).toBeTruthy();
    expect(updated!.rowResults).toHaveLength(0);
    expect(await PendingTransaction.countDocuments({ userId })).toBe(0);
    expect(fileExists(filePath)).toBe(false);
  });

  it("processes a large statement in multiple chunks, persisting incremental progress along the way", async () => {
    const userId = "user-worker-chunked";
    const accountId = "acc-1";
    const batch = await createProcessingBatch(userId);
    const filePath = await writeTempFile(fixtureBuffer("statement-large.pdf"));

    const updateSpy = vi.spyOn(ImportBatch, "findByIdAndUpdate");

    await processStatementUpload({ batchId: batch._id.toString(), userId, accountId, filePath });

    // More than one $push-style progress update happened before the final
    // status:"completed" update — i.e. this genuinely processed the 270-row
    // fixture across more than one chunk rather than doing it all in one shot.
    const pushCalls = updateSpy.mock.calls.filter(
      (call) => (call[1] as any)?.$push !== undefined
    );
    expect(pushCalls.length).toBeGreaterThan(1);

    const updated = await ImportBatch.findById(batch._id);
    expect(updated!.status).toBe("completed");
    expect(updated!.rowResults).toHaveLength(270);
    expect(updated!.resultingIds).toHaveLength(270);
    expect(await PendingTransaction.countDocuments({ userId })).toBe(270);
  });

  it("a mid-processing DB write failure leaves prior chunks' progress intact instead of losing it", async () => {
    const userId = "user-worker-partial-fail";
    const accountId = "acc-1";
    const batch = await createProcessingBatch(userId);
    const filePath = await writeTempFile(fixtureBuffer("statement-large.pdf"));
    const jobData = { batchId: batch._id.toString(), userId, accountId, filePath };

    const realInsertMany = PendingTransaction.insertMany.bind(PendingTransaction);
    let calls = 0;
    const insertManySpy = vi.spyOn(PendingTransaction, "insertMany").mockImplementation(async (...args: any[]) => {
      calls++;
      if (calls === 2) throw new Error("simulated transient DB failure");
      return (realInsertMany as any)(...args);
    });

    await expect(processStatementUpload(jobData)).rejects.toThrow("simulated transient DB failure");

    const updated = await ImportBatch.findById(batch._id);
    // The first chunk (200 rows) completed and was persisted before the
    // second chunk's insertMany rejected — that progress must survive, not
    // be wiped out by the failure.
    expect(updated!.status).toBe("processing");
    expect(updated!.rowResults).toHaveLength(200);
    expect(updated!.resultingIds).toHaveLength(200);
    expect(await PendingTransaction.countDocuments({ userId })).toBe(200);

    // The thrown (retry-eligible) path deliberately does not clean up the
    // temp file, so a BullMQ retry of the same job can still read it.
    expect(fileExists(filePath)).toBe(true);

    // Simulate BullMQ retrying the same job (same data, same still-on-disk
    // file) now that the transient failure is over. This must RESUME, not
    // restart: the 200 rows already inserted before the failure must not be
    // inserted a second time.
    insertManySpy.mockRestore();
    await processStatementUpload(jobData);

    const final = await ImportBatch.findById(batch._id);
    expect(final!.status).toBe("completed");
    expect(final!.rowResults).toHaveLength(270);
    expect(final!.resultingIds).toHaveLength(270);
    expect(await PendingTransaction.countDocuments({ userId })).toBe(270);
    // Every original row number appears in the final results exactly once —
    // proof the retry didn't reprocess (and re-record) the first chunk.
    const rowNumbers = final!.rowResults.map((r: { row: number }) => r.row).sort((a: number, b: number) => a - b);
    expect(rowNumbers).toEqual(Array.from({ length: 270 }, (_, i) => i + 1));

    expect(fileExists(filePath)).toBe(false);
  });
});
