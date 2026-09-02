import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "../../src/app.js";
import { Transaction } from "../../src/models/Transaction.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";
import { ImportBatch } from "../../src/models/ImportBatch.js";
import { StatementPassword } from "../../src/models/StatementPassword.js";
import { encrypt } from "../../src/lib/encryption.js";
import { statementProcessQueue, processStatementUpload } from "../../src/jobs/workers/statementProcess.worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures");

function fixturePath(name: string): string {
  return path.join(FIXTURES, name);
}

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

const REAL_PASSWORD = "correct-pw-123";

// No BullMQ worker is running in this test process (same reasoning as every
// other test file here that talks to a queue directly, e.g.
// priceRefreshFanout.test.ts): `startBackgroundWorkers` is never called from
// test setup. So a route that enqueues a "statement-process" job leaves it
// sitting `waiting` in Redis until something processes it. This helper plays
// the part of that worker for exactly one queued job: pop it, run the same
// `processStatementUpload` a real worker would, and remove it from the
// queue, letting these tests exercise the full upload -> process -> poll
// flow deterministically, without a real background worker's timing.
async function runNextQueuedJob(): Promise<void> {
  const [job] = await statementProcessQueue.getJobs(["waiting"]);
  if (!job) throw new Error("expected a queued statement-process job, found none");
  await processStatementUpload(job.data);
  await job.remove();
}

beforeEach(async () => {
  await statementProcessQueue.drain(true);
});

afterAll(async () => {
  await statementProcessQueue.drain(true);
  await statementProcessQueue.close();
});

describe("POST /transactions/import-pdf", () => {
  it("requires accountId", async () => {
    const res = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie("user-pdf-noaccount"))
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(res.status).toBe(400);
  });

  it("requires a file", async () => {
    const res = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie("user-pdf-nofile"))
      .field("accountId", "acc-1");
    expect(res.status).toBe(400);
  });

  it("returns 202 immediately with a processing batchId, then completes once the queued job runs", async () => {
    const userId = "user-pdf-happy";
    const res = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));

    expect(res.status).toBe(202);
    expect(res.body.batchId).toBeTruthy();
    expect(res.body.status).toBe("processing");

    // Nothing has actually run yet: no PendingTransactions, no rows recorded.
    const processingBatch = await ImportBatch.findById(res.body.batchId);
    expect(processingBatch!.status).toBe("processing");
    expect(processingBatch!.source).toBe("pdf_statement");
    expect(await PendingTransaction.countDocuments({ userId })).toBe(0);

    await runNextQueuedJob();

    const done = await ImportBatch.findById(res.body.batchId);
    expect(done!.status).toBe("completed");
    expect(done!.rowResults.length).toBeGreaterThan(0);
    expect(done!.resultingIds.length).toBeGreaterThan(0);

    const pendingCount = await PendingTransaction.countDocuments({ userId });
    expect(pendingCount).toBe(done!.resultingIds.length);

    const pending = await PendingTransaction.findOne({ userId });
    expect(pending!.source).toBe("pdf_statement_parsed");
    expect(pending!.accountId).toBe("acc-1");
    expect(pending!.categoryId).toBeNull();
  });

  it("re-uploading identical bytes is always allowed (never blocked as a whole-file dupe)", async () => {
    // Unlike CSV import, a PDF's rows land as PendingTransactions, never
    // auto-confirmed, so an earlier upload might have parsed under the
    // wrong bank layout (a since-fixed parser bug, or the person picked the
    // wrong "Statement format" by mistake): re-uploading has to be allowed,
    // not permanently blocked by the first attempt's bytes.
    const userId = "user-pdf-reupload-allowed";
    const first = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(first.status).toBe(202);
    await runNextQueuedJob();

    const second = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(second.status).toBe(202);
    await runNextQueuedJob();

    // Neither upload's rows are confirmed Transactions, so the second
    // upload's row isn't flagged a duplicate of the first (findLikelyDuplicate
    // only checks confirmed Transactions, see the dedicated test below for
    // the case where it should fire): both batches' rows land as pending.
    expect(await PendingTransaction.countDocuments({ userId })).toBe(2);
  });

  it("flags a re-uploaded row as a duplicate once the earlier upload's row is actually confirmed", async () => {
    const userId = "user-pdf-reupload-after-confirm";
    const first = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(first.status).toBe(202);
    await runNextQueuedJob();

    const firstPending = await PendingTransaction.findOne({ userId });
    await request(app)
      .post(`/pending-transactions/${firstPending!._id}/confirm`)
      .set("Cookie", authCookie(userId))
      .send({ accountId: "acc-1" });

    const second = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(second.status).toBe(202);
    await runNextQueuedJob();

    const secondBatch = await ImportBatch.findById(second.body.batchId);
    const dupRow = secondBatch!.rowResults.find((r: { reason?: string }) => r.reason === "possible_duplicate");
    expect(dupRow).toBeTruthy();
    // The first upload's row was already confirmed (deleted from the pending
    // queue as part of that), and the second upload's matching row never
    // became a second pending row either: zero pending rows either way.
    expect(await PendingTransaction.countDocuments({ userId })).toBe(0);
  });

  it("re-uploading the same bytes after a FAILED prior batch is allowed to retry, not blocked as a dupe", async () => {
    const userId = "user-pdf-retry-after-fail";
    await StatementPassword.create({ userId, label: "wrong", passwordEncrypted: encrypt("nope") });

    const first = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-protected.pdf"));
    expect(first.status).toBe(202);
    await runNextQueuedJob();

    const failedBatch = await ImportBatch.findById(first.body.batchId);
    expect(failedBatch!.status).toBe("failed");

    // Add the real password, then retry the exact same file bytes.
    await StatementPassword.create({ userId, label: "the real one", passwordEncrypted: encrypt(REAL_PASSWORD) });

    const second = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-protected.pdf"));
    expect(second.status).toBe(202);
    await runNextQueuedJob();

    const done = await ImportBatch.findById(second.body.batchId);
    expect(done!.status).toBe("completed");
    expect(done!.rowResults.length).toBeGreaterThan(0);
  });

  it("filters a row that matches an existing confirmed Transaction via findLikelyDuplicate, without creating a PendingTransaction for it", async () => {
    const userId = "user-pdf-dupe-row";
    // The generic-fallback parse of statement-unprotected.pdf's one
    // transaction-shaped line ("01/08/2026 SOME MERCHANT 100.00") yields
    // date 2026-08-01, amount 100. Pre-seed a matching confirmed Transaction.
    await Transaction.create({
      userId,
      accountId: "acc-1",
      amount: 100,
      date: new Date("2026-08-01"),
      source: "manual",
      status: "confirmed",
    });

    const res = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(res.status).toBe(202);
    await runNextQueuedJob();

    const done = await ImportBatch.findById(res.body.batchId);
    expect(done!.status).toBe("completed");
    const dupRow = done!.rowResults.find((r: { reason?: string }) => r.reason === "possible_duplicate");
    expect(dupRow).toBeTruthy();
    expect(dupRow.status).toBe("failed");

    const pendingCount = await PendingTransaction.countDocuments({ userId });
    expect(pendingCount).toBe(0);
  });

  it("sets the batch to failed (with an error message) when the PDF cannot be unlocked with any stored password, once the queued job runs", async () => {
    const userId = "user-pdf-wrongpw";
    await StatementPassword.create({ userId, label: "wrong", passwordEncrypted: encrypt("nope") });

    const res = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-protected.pdf"));

    // The route no longer attempts to unlock the PDF itself: that now
    // happens inside the worker, so this still 202s even though the file
    // will ultimately fail to unlock.
    expect(res.status).toBe(202);
    await runNextQueuedJob();

    const done = await ImportBatch.findById(res.body.batchId);
    expect(done!.status).toBe("failed");
    expect(done!.error).toBeTruthy();
    expect(await PendingTransaction.countDocuments({ userId })).toBe(0);
  });

  it("unlocks successfully when the correct password is a LATER candidate, not the first one tried", async () => {
    const userId = "user-pdf-laterpw";
    await StatementPassword.create({ userId, label: "wrong 1", passwordEncrypted: encrypt("nope-1") });
    await StatementPassword.create({ userId, label: "wrong 2", passwordEncrypted: encrypt("nope-2") });
    await StatementPassword.create({ userId, label: "the real one", passwordEncrypted: encrypt(REAL_PASSWORD) });

    const res = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-protected.pdf"));
    expect(res.status).toBe(202);
    await runNextQueuedJob();

    const done = await ImportBatch.findById(res.body.batchId);
    expect(done!.status).toBe("completed");
    expect(done!.rowResults.length).toBeGreaterThan(0);
  });

  it("does not call invalidateDashboardCache-worthy state changes for pending rows (rows are pending, not confirmed)", async () => {
    const userId = "user-pdf-notconfirmed";
    const res = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(res.status).toBe(202);
    await runNextQueuedJob();

    const confirmedCount = await Transaction.countDocuments({ userId });
    expect(confirmedCount).toBe(0);
  });

  it("requires auth", async () => {
    // Deliberately no file attached here: requireAuth runs before multer and
    // responds 401 immediately, and supertest writing a multipart file body
    // into an already-closed connection throws an unrelated EPIPE rather than
    // exercising anything this test cares about.
    const res = await request(app).post("/transactions/import-pdf").field("accountId", "acc-1");
    expect(res.status).toBe(401);
  });
});

describe("GET /transactions/import-pdf/:batchId", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/transactions/import-pdf/000000000000000000000000");
    expect(res.status).toBe(401);
  });

  it("404s for a batch that doesn't exist", async () => {
    const res = await request(app)
      .get("/transactions/import-pdf/000000000000000000000000")
      .set("Cookie", authCookie("user-pdf-poll-missing"));
    expect(res.status).toBe(404);
  });

  it("404s for another user's batch", async () => {
    const owner = "user-pdf-poll-owner";
    const other = "user-pdf-poll-other";

    const uploadRes = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(owner))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(uploadRes.status).toBe(202);

    const res = await request(app)
      .get(`/transactions/import-pdf/${uploadRes.body.batchId}`)
      .set("Cookie", authCookie(other));
    expect(res.status).toBe(404);

    // Drain the job this test's upload enqueued but never let run, otherwise
    // its temp file (written to the real OS tmp dir, not mongodb-memory-server)
    // outlives this test.
    await runNextQueuedJob();
  });

  it("returns the batch's current status and, once processed, its results", async () => {
    const userId = "user-pdf-poll-happy";
    const uploadRes = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(uploadRes.status).toBe(202);

    const beforeRes = await request(app)
      .get(`/transactions/import-pdf/${uploadRes.body.batchId}`)
      .set("Cookie", authCookie(userId));
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.status).toBe("processing");
    expect(beforeRes.body.rowResults).toEqual([]);

    await runNextQueuedJob();

    const afterRes = await request(app)
      .get(`/transactions/import-pdf/${uploadRes.body.batchId}`)
      .set("Cookie", authCookie(userId));
    expect(afterRes.status).toBe(200);
    expect(afterRes.body.status).toBe("completed");
    expect(afterRes.body.rowResults.length).toBeGreaterThan(0);
    expect(afterRes.body.resultingIds.length).toBeGreaterThan(0);
  });
});
