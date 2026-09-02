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

  it("re-uploading identical bytes returns 409 and creates nothing new", async () => {
    const userId = "user-pdf-dupe-upload";
    const first = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(first.status).toBe(202);
    await runNextQueuedJob();

    const batchCountAfterFirst = await ImportBatch.countDocuments({ userId });
    const pendingCountAfterFirst = await PendingTransaction.countDocuments({ userId });

    const second = await request(app)
      .post("/transactions/import-pdf")
      .set("Cookie", authCookie(userId))
      .field("accountId", "acc-1")
      .attach("file", fixturePath("statement-unprotected.pdf"));
    expect(second.status).toBe(409);

    expect(await ImportBatch.countDocuments({ userId })).toBe(batchCountAfterFirst);
    expect(await PendingTransaction.countDocuments({ userId })).toBe(pendingCountAfterFirst);
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
