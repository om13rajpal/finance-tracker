import { Worker, Job } from "bullmq";
import fs from "node:fs/promises";
import { makeQueue, makeWorker } from "../queue.js";
import { PendingTransaction } from "../../models/PendingTransaction.js";
import { ImportBatch } from "../../models/ImportBatch.js";
import { findLikelyDuplicate } from "../../modules/transactions/duplicate-detection.js";
import { tryUnlockPdf } from "../../modules/statements/pdf-unlock.service.js";
import { parseStatementRows } from "../../modules/statements/statement-row-parser.service.js";

export type StatementProcessJob = {
  batchId: string;
  userId: string;
  accountId: string;
  parserKey?: string;
  /**
   * Path to the uploaded PDF's bytes on local disk, written by the route
   * handler before enqueueing. Deliberately a path, not the file's bytes
   * (base64 or otherwise) — this app's other 7 workers all carry small,
   * cheap-to-serialize job payloads (e.g. gmail-email-parse's `{userId,
   * historyId}`), and Redis/BullMQ is coordination infrastructure, not blob
   * storage. A multi-MB statement belongs on disk, referenced by a short
   * string, not duplicated into a Redis-serialized copy of an Express
   * request body that's already sitting in memory. Safe only because this
   * app runs `connectDB()` -> `startBackgroundWorkers()` -> `app.listen()`
   * in one single process/container (confirmed via `render.yaml`) — the
   * worker reading this path is the same machine, often the same process,
   * that wrote it.
   */
  filePath: string;
};

type RowResult = { row: number; status: "success" | "failed"; reason?: string; transactionId?: string };

// Roughly what ~20 real-world statement pages produce at the observed
// ~12 rows/page density. The point isn't hitting this figure exactly — it's
// bounding how much synchronous work (a DB read + a DB write per row) runs
// before this worker yields back to the event loop, so one huge statement
// can't monopolize the single Node process this app runs everything else
// in (dashboard requests, other workers, etc. all share it on Render's free
// tier).
const CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Best-effort delete — a leaked temp file on a container's ephemeral disk is a
 * nuisance, never worth failing (or retrying) a job over. */
async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    console.error(`[statement-process] failed to remove temp file ${filePath}:`, err);
  }
}

/**
 * Processes one queued PDF-statement upload: unlocks it, parses every row,
 * and turns each parseable, non-duplicate row into a `PendingTransaction` —
 * the exact same per-row logic `statement-upload.routes.ts` used to run
 * synchronously inline, moved here so a large statement's page-by-page work
 * happens in bounded chunks inside a background worker instead of blocking
 * the request thread for the whole upload.
 *
 * Progress is persisted to the `ImportBatch` incrementally, once per chunk
 * (`$push` with `$each`, not a full re-`save()`), so:
 *  - the frontend's poll of `GET /transactions/import-pdf/:batchId` can show
 *    real progress on a large statement instead of nothing until the end;
 *  - if something goes wrong partway through (see the error handling below),
 *    every chunk that already completed stays recorded rather than being
 *    lost with the rest of the job.
 */
export async function processStatementUpload(data: StatementProcessJob): Promise<void> {
  const { batchId, userId, accountId, parserKey, filePath } = data;

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (err) {
    // The temp file is gone (already cleaned up by a prior attempt, or the
    // disk was wiped) — nothing left to process. This can only recur, so
    // fail the batch outright rather than burning retries on it.
    await ImportBatch.findByIdAndUpdate(batchId, {
      status: "failed",
      error: "The uploaded file could not be read. Please try uploading again.",
    });
    return;
  }

  const unlocked = await tryUnlockPdf(buffer, userId);
  if (!unlocked.success) {
    // Not a transient failure — retrying with the same stored passwords 3
    // more times (BullMQ's default) would never succeed. Update the batch
    // and return normally (don't throw) so BullMQ marks this job complete,
    // not failed-and-retried.
    await ImportBatch.findByIdAndUpdate(batchId, {
      status: "failed",
      error:
        "Could not open this PDF. If it's password-protected, add the right password in Settings and try again.",
    });
    await cleanupTempFile(filePath);
    return;
  }

  const rows = parseStatementRows(unlocked.pages, parserKey);
  // Pair each row with its 1-based row number up front (rather than
  // `rows.indexOf(row)` inside the loop below) so numbering a chunk stays
  // O(chunk size), not O(n) per row / O(n^2) per statement.
  const numberedRows = rows.map((row, i) => ({ row, rowNumber: i + 1 }));

  // Resume rather than restart: if a prior attempt at THIS job already
  // persisted some chunks before failing (see the error handling at the
  // bottom of this function — a chunk-processing error is deliberately left
  // to throw so BullMQ retries the whole job), a retry re-parses the same
  // deterministic bytes into the same rows, but must not redo the chunks
  // that already succeeded — replaying them would insert a second
  // `PendingTransaction` for each already-inserted row and double-append
  // their `rowResults`. Every persisted chunk is a full `CHUNK_SIZE` (only
  // the very last chunk of a statement can be shorter, and by construction
  // that only ever happens right before the final "completed" update, never
  // mid-retry), so however many `rowResults` are already on the batch is
  // exactly how many leading rows to skip.
  const existingBatch = await ImportBatch.findById(batchId).select("rowResults");
  const alreadyProcessed = existingBatch?.rowResults.length ?? 0;
  const chunks = chunk(numberedRows.slice(alreadyProcessed), CHUNK_SIZE);

  for (const rowsInChunk of chunks) {
    const rowResults: RowResult[] = [];
    const resultingIds: string[] = [];
    // Rows that pass the duplicate check in this chunk, paired with the row
    // number they came from — collected up front so the actual inserts can
    // happen in one `insertMany` round-trip instead of N sequential
    // `.create()` calls. The duplicate check itself has to stay one query
    // per row (each is a genuine conditional read against current
    // `Transaction` data, and doesn't depend on anything this loop writes),
    // but nothing requires the *writes* to be sequential too.
    const docsToInsert: { row: number; doc: Record<string, unknown> }[] = [];

    for (const { row, rowNumber } of rowsInChunk) {
      if ("error" in row) {
        rowResults.push({ row: rowNumber, status: "failed", reason: row.error });
        continue;
      }

      const date = new Date(row.date);
      const duplicate = await findLikelyDuplicate(userId, { accountId, amount: row.amount, date });
      if (duplicate) {
        rowResults.push({ row: rowNumber, status: "failed", reason: "possible_duplicate" });
        continue;
      }

      docsToInsert.push({
        row: rowNumber,
        doc: {
          userId,
          accountId,
          categoryId: null,
          amount: row.amount,
          date,
          note: row.note,
          merchant: row.merchant,
          source: "pdf_statement_parsed",
        },
      });
    }

    if (docsToInsert.length > 0) {
      const inserted = await PendingTransaction.insertMany(
        docsToInsert.map((d) => d.doc),
        { ordered: true }
      );
      for (let i = 0; i < inserted.length; i++) {
        const id = inserted[i]._id.toString();
        resultingIds.push(id);
        rowResults.push({ row: docsToInsert[i].row, status: "success", transactionId: id });
      }
    }

    // Append this chunk's results rather than replacing the array, so a
    // concurrent read (the poll route) always sees a strict superset of what
    // it saw before, and so a later chunk's failure (see below) never wipes
    // out what an earlier chunk already persisted.
    await ImportBatch.findByIdAndUpdate(batchId, {
      $push: {
        rowResults: { $each: rowResults },
        resultingIds: { $each: resultingIds },
      },
    });

    // Yield to the event loop between chunks so this job can't monopolize
    // the single process this app's HTTP server and every other worker also
    // run in — the whole point of moving this off the request thread.
    await new Promise((resolve) => setImmediate(resolve));
  }

  await ImportBatch.findByIdAndUpdate(batchId, { status: "completed" });
  await cleanupTempFile(filePath);
  // Deliberately no cleanup on a thrown error above (a chunk's DB write
  // failing, `insertMany` rejecting, etc.): that error is left to propagate
  // so BullMQ's existing retry/backoff (`defaultJobOptions`, 3 attempts) can
  // retry the whole job, and a retry needs the same file still on disk. Any
  // chunk that already completed before the failure stays recorded (per the
  // `$push`-not-`$set` persistence above) and is skipped, not redone, by the
  // `alreadyProcessed` resume logic above — so a successful retry ends with
  // each row accounted for exactly once, not duplicated. Worst case (every
  // retry attempt is exhausted), a statement's temp file outlives all of
  // them and leaks one small file on an ephemeral container disk, which is
  // an acceptable tradeoff at this app's scale.
}

export const statementProcessQueue = makeQueue<StatementProcessJob>("statement-process");

/**
 * Constructs the BullMQ Worker that processes queued statement-upload jobs.
 * Deliberately NOT instantiated at module load time (same reasoning as every
 * other `start*Worker` factory in this directory — see e.g.
 * `startGmailWatchRenewalWorker`'s doc comment) — a top-level `export const
 * statementProcessWorker = makeWorker(...)` would open a real Redis-backed
 * listener as a side effect of simply importing this module, including from
 * this task's own test file, which only needs `processStatementUpload`
 * directly. Call this explicitly from wherever the app wires up its
 * background workers.
 */
export function startStatementProcessWorker(): Worker<StatementProcessJob> {
  return makeWorker<StatementProcessJob>("statement-process", async (job: Job<StatementProcessJob>) =>
    processStatementUpload(job.data)
  );
}
