import { Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireAuth } from "../auth/auth.middleware.js";
import { ImportBatch } from "../../models/ImportBatch.js";
import { statementProcessQueue } from "../../jobs/workers/statementProcess.worker.js";

const upload = multer({ storage: multer.memoryStorage() });
export const statementUploadRouter = Router();
statementUploadRouter.use(requireAuth);

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Uploads a (possibly password-protected) bank statement PDF and enqueues it
 * for background processing into review-queue `PendingTransaction`s.
 * Mirrors `csv-import.routes.ts`'s shape (multer memory upload, `accountId`
 * required, one `ImportBatch` per upload) with these deliberate differences:
 *
 *  - Nothing is auto-confirmed. PDF layout extraction is inherently less
 *    reliable than a CSV export, so every parsed row becomes a
 *    `PendingTransaction` (`source: "pdf_statement_parsed"`) for the person
 *    to review, never a confirmed `Transaction` directly, which is also why
 *    this route never calls `invalidateDashboardCache`; only the pending
 *    confirm route does, once something is actually confirmed.
 *  - Re-uploading the exact same bytes is always allowed, not blocked as a
 *    dupe: unlike CSV import (whose rows land as confirmed `Transaction`s
 *    outright), a PDF's rows are never auto-confirmed, so an earlier upload
 *    might have parsed badly (wrong bank layout, since-fixed parser bug) and
 *    the person's only recourse is to try again. Duplicate PROTECTION still
 *    happens, just per-row: each parsed row is checked against `Transaction`
 *    via `findLikelyDuplicate` in the worker, same as CSV import, so a row
 *    that matches something already confirmed is reported as a duplicate in
 *    `rowResults` (see `possible_duplicate`) instead of creating a second
 *    `PendingTransaction` for it. `fileHash` is still recorded on the batch,
 *    purely for display/debugging, not as a gate.
 *  - The actual unlock/parse/insert work happens asynchronously in the
 *    `statement-process` BullMQ worker (`statementProcess.worker.ts`), not
 *    inline in this request. A 500-page statement's unlock + parse + N
 *    inserts, run synchronously in one HTTP request, would hold the request
 *    open and block this app's single event loop for the whole duration:
 *    wrong for a single-process container on a shared-CPU, 512MB free-tier
 *    deployment. This route does only the cheap, fast parts (auth, hash dedup,
 *    writing the upload to a temp file) and returns `202` immediately with a
 *    `batchId` the frontend polls via `GET /transactions/import-pdf/:batchId`.
 *
 * `parserKey` is optional. A bank-specific parser (see
 * `parsers/registry.ts`) is meaningfully more accurate than the generic
 * fallback, but nothing requires the caller to know or supply it.
 */
statementUploadRouter.post("/import-pdf", upload.single("file"), async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const accountId = req.body.accountId as string | undefined;
    if (!accountId) return res.status(400).json({ error: "accountId is required" });

    const parserKey = (req.body.parserKey as string | undefined) || undefined;
    const fileHash = sha256(req.file.buffer);

    // Write the upload to a temp file on local disk and pass only its path
    // through the BullMQ job payload, not the file's bytes (as base64 or
    // otherwise). This app's other workers all carry small payloads (e.g.
    // gmail-email-parse's `{userId, historyId}`); Redis/Upstash is
    // coordination infrastructure, not blob storage, and stuffing a
    // multi-MB base64 blob into a job would both hurt Redis performance and
    // hold the same bytes in memory twice (Express's request buffer AND a
    // Redis-serialized copy) at once. Safe to hand off by path because this
    // app's `render.yaml` runs one single-process container: the worker
    // reading this path is the same machine that wrote it.
    const tempFilePath = path.join(os.tmpdir(), `statement-${crypto.randomUUID()}.pdf`);
    await fs.writeFile(tempFilePath, req.file.buffer);

    const batch = await ImportBatch.create({
      userId,
      accountId,
      source: "pdf_statement",
      filename: req.file.originalname,
      fileHash,
      rowResults: [],
      resultingIds: [],
      status: "processing",
    });

    await statementProcessQueue.add("process", {
      batchId: batch._id.toString(),
      userId,
      accountId,
      parserKey,
      filePath: tempFilePath,
    });

    res.status(202).json({ batchId: batch._id, status: "processing" });
  } catch (err) {
    next(err);
  }
});

/**
 * Polled by the frontend after the `202` above to watch a batch's async
 * processing progress until it reaches a terminal `status`
 * (`"completed"`/`"failed"`). Scoped to `req.userId`: a batch that exists
 * but belongs to someone else 404s exactly like one that doesn't exist at
 * all, so this route never leaks whether a given id belongs to another
 * account.
 */
statementUploadRouter.get("/import-pdf/:batchId", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const batch = await ImportBatch.findOne({ _id: req.params.batchId, userId });
    if (!batch) return res.status(404).json({ error: "Import batch not found" });
    res.status(200).json(batch);
  } catch (err) {
    next(err);
  }
});
