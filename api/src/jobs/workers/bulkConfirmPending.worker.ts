import { Worker, Job } from "bullmq";
import { makeQueue, makeWorker } from "../queue.js";
import { PendingTransaction } from "../../models/PendingTransaction.js";
import { Transaction } from "../../models/Transaction.js";
import { BulkConfirmBatch } from "../../models/BulkConfirmBatch.js";
import { findLikelyDuplicate } from "../../modules/transactions/duplicate-detection.js";
import { applyCategorizationRules } from "../../modules/categorization/categorization.engine.js";
import { applyConfirmedTransactionBalanceEffect } from "../../modules/accounts/balance.service.js";
import { invalidateDashboardCache } from "../../modules/dashboard/dashboard.service.js";

export type BulkConfirmPendingJob = {
  batchId: string;
  userId: string;
  ids: string[];
};

type BulkConfirmResult = {
  id: string;
  status: "success" | "skipped";
  reason?: "not_found" | "account_required" | "possible_duplicate";
  transactionId?: string;
};

// Confirming one pending transaction is several sequential DB round trips
// (categorization lookup, duplicate check, Transaction.create, balance
// effect, PendingTransaction delete), meaningfully heavier per-item than a
// parsed statement row, which is why this chunk is smaller than
// `statementProcess.worker.ts`'s 200. The point is the same: bound how much
// synchronous work runs before yielding back to the event loop this app's
// single process shares with the HTTP server and every other worker.
const CHUNK_SIZE = 25;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Confirms every listed pending transaction, exactly the per-item logic
 * `pending.routes.ts`'s `/bulk-confirm` used to run synchronously inline:
 * moved here so a large batch's work happens in bounded chunks inside a
 * background worker instead of blocking the request thread (and, in
 * production, exceeding the request-timeout path: see this file's own
 * regression coverage) for the whole batch.
 *
 * Progress is persisted to the `BulkConfirmBatch` incrementally, once per
 * chunk, so a poll of `GET /pending-transactions/bulk-confirm/:batchId` can
 * show real progress, and a retry after a mid-batch failure resumes rather
 * than reprocessing (and re-confirming) items a prior attempt already
 * finished.
 */
export async function processBulkConfirm(data: BulkConfirmPendingJob): Promise<void> {
  const { batchId, userId, ids } = data;

  const existingBatch = await BulkConfirmBatch.findById(batchId).select("results");
  const alreadyProcessed = existingBatch?.results.length ?? 0;
  const chunks = chunk(ids.slice(alreadyProcessed), CHUNK_SIZE);

  let confirmedAny = false;

  for (const idsInChunk of chunks) {
    const results: BulkConfirmResult[] = [];

    for (const id of idsInChunk) {
      const pending = await PendingTransaction.findOne({ _id: id, userId });
      if (!pending) {
        results.push({ id, status: "skipped", reason: "not_found" });
        continue;
      }
      if (!pending.accountId) {
        results.push({ id, status: "skipped", reason: "account_required" });
        continue;
      }

      let categoryId: string | null = pending.categoryId ?? null;
      if (!categoryId) {
        categoryId = await applyCategorizationRules(userId, {
          merchant: pending.merchant,
          note: pending.note,
        });
      }

      const duplicate = await findLikelyDuplicate(userId, {
        accountId: pending.accountId,
        amount: pending.amount,
        date: pending.date,
      });
      if (duplicate) {
        results.push({ id, status: "skipped", reason: "possible_duplicate" });
        continue;
      }

      const balanceDeltaApplied = await applyConfirmedTransactionBalanceEffect(
        userId,
        pending.accountId,
        pending.amount,
        pending.emailBalance ?? null,
        pending.date,
        pending.balanceReconciledAtImport === true
      );
      const transaction = await Transaction.create({
        userId,
        accountId: pending.accountId,
        categoryId,
        amount: pending.amount,
        date: pending.date,
        note: pending.note,
        merchant: pending.merchant,
        source: pending.source,
        status: "confirmed",
        balanceDeltaApplied,
      });
      await PendingTransaction.deleteOne({ _id: pending._id });

      confirmedAny = true;
      results.push({ id, status: "success", transactionId: transaction._id.toString() });
    }

    await BulkConfirmBatch.findByIdAndUpdate(batchId, { $push: { results: { $each: results } } });

    // Yield to the event loop between chunks (see CHUNK_SIZE's doc comment).
    await new Promise((resolve) => setImmediate(resolve));
  }

  if (confirmedAny) await invalidateDashboardCache(userId);
  await BulkConfirmBatch.findByIdAndUpdate(batchId, { status: "completed" });
}

export const bulkConfirmPendingQueue = makeQueue<BulkConfirmPendingJob>("bulk-confirm-pending");

/**
 * Constructs the BullMQ Worker that processes queued bulk-confirm jobs.
 * Deliberately NOT instantiated at module load time. See
 * `startStatementProcessWorker`'s doc comment for why (a top-level
 * `makeWorker(...)` would open a real Redis-backed listener as a side
 * effect of importing this module, including from this file's own tests).
 */
export function startBulkConfirmPendingWorker(): Worker<BulkConfirmPendingJob> {
  const worker = makeWorker<BulkConfirmPendingJob>("bulk-confirm-pending", async (job: Job<BulkConfirmPendingJob>) =>
    processBulkConfirm(job.data)
  );

  // See `startStatementProcessWorker`'s identical "failed" handler for why
  // this exists: without it, a batch whose job exhausts every retry (a real
  // bug, a persistent DB error, anything not already handled by a per-item
  // skip above) is left stuck at "processing" forever with no way for the
  // person polling it to know anything went wrong.
  worker.on("failed", async (job) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;

    try {
      await BulkConfirmBatch.findOneAndUpdate(
        { _id: job.data.batchId, status: "processing" },
        { status: "failed", error: "Something went wrong filing these transactions. Please try again." }
      );
    } catch (err) {
      console.error(`[bulk-confirm-pending] failed to finalize permanently-failed job for batch ${job.data.batchId}:`, err);
    }
  });

  return worker;
}
