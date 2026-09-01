import { Worker, Job } from "bullmq";
import fs from "node:fs/promises";
import { makeQueue, makeWorker } from "../queue.js";
import { PendingTransaction } from "../../models/PendingTransaction.js";
import { ImportBatch } from "../../models/ImportBatch.js";
import type { StatementRowResult } from "../../modules/statements/types.js";
import { findLikelyDuplicate } from "../../modules/transactions/duplicate-detection.js";
import { tryUnlockPdf } from "../../modules/statements/pdf-unlock.service.js";
import {
  parseStatementRows,
  findStatementClosingBalance,
  findStatementOpeningBalance,
} from "../../modules/statements/statement-row-parser.service.js";
import { invalidateDashboardCache } from "../../modules/dashboard/dashboard.service.js";
import { reconcileBalance } from "../../modules/accounts/balance.service.js";

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

/**
 * The latest date among this statement's own successfully-parsed rows — used as
 * the closing balance's "as of" point for `reconcileBalance`'s staleness guard.
 * `null` when there are no dateable rows at all (a statement whose only balance
 * signal is its Opening Balance, with zero transaction rows — see
 * `findHdfcClosingBalance`'s own doc comment), in which case `reconcileBalance`
 * applies unconditionally rather than refusing to reconcile at all.
 *
 * Deliberately the max across every row, not just the last one in array order —
 * correct regardless of whether a parser's rows happen to already be
 * chronologically sorted.
 */
function latestRowDate(rows: StatementRowResult[]): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    if ("error" in row) continue;
    const date = new Date(row.date);
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }
  return latest;
}

const MISMATCH_TOLERANCE = 0.01;

/**
 * Data-quality cross-check: does `openingBalance + sum(every successfully-parsed
 * row's amount)` land on `closingBalance` (within rounding)? Both balances are
 * read straight off the document's own printed figures; the sum comes from
 * whichever rows THIS parser actually managed to extract. A mismatch beyond
 * `MISMATCH_TOLERANCE` means some row(s) were missed or misparsed — worth
 * flagging on the `ImportBatch` for visibility, but never worth blocking the
 * import over (the printed `closingBalance` itself is still trusted and still
 * used to reconcile the account either way).
 */
function checkClosingBalanceReconciliation(
  rows: StatementRowResult[],
  openingBalance: number | null,
  closingBalance: number | null
): { expectedClosingBalance: number | null; mismatch: boolean } {
  if (openingBalance === null || closingBalance === null) {
    return { expectedClosingBalance: null, mismatch: false };
  }
  const sum = rows.reduce((total, row) => total + ("error" in row ? 0 : row.amount), 0);
  const expectedClosingBalance = Math.round((openingBalance + sum) * 100) / 100;
  const mismatch = Math.abs(expectedClosingBalance - closingBalance) > MISMATCH_TOLERANCE;
  return { expectedClosingBalance, mismatch };
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
  // The statement's OWN stated closing balance, when the parser for this
  // bank knows how to find one — read straight off the document, not summed
  // from whichever rows below parse cleanly, so it's used to reconcile the
  // linked Account's balance once processing finishes (see the end of this
  // function). `null` for a parser with no closing-balance support yet
  // (everything except HDFC today) — nothing to reconcile with, not an
  // error.
  const closingBalance = findStatementClosingBalance(unlocked.pages, parserKey);
  // The statement's own printed OPENING balance, when a finder is registered for
  // this parser (HDFC only — see `STATEMENT_OPENING_BALANCE_REGISTRY`'s doc
  // comment). Used purely for the data-quality cross-check below, never to
  // reconcile the account directly.
  const openingBalance = findStatementOpeningBalance(unlocked.pages, parserKey);
  const { expectedClosingBalance, mismatch: closingBalanceMismatch } = checkClosingBalanceReconciliation(
    rows,
    openingBalance,
    closingBalance
  );
  // The statement's own latest transaction date — the "as of" point
  // `reconcileBalance`'s staleness guard compares against, so an older statement
  // (or one processed out of chronological order relative to what's already been
  // reconciled) can never regress a more current balance. `null` when there are
  // no dateable rows at all (see `latestRowDate`'s doc comment).
  const asOfDate = latestRowDate(rows);
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

  // Reconcile the linked account's balance to what the statement itself says
  // it should be — the whole point being that nobody has to go type this in
  // by hand after every import. Runs exactly once per successful completion
  // (this line is only ever reached once the chunk loop above finishes
  // without throwing — a retry of a job that failed mid-loop simply hasn't
  // gotten here yet).
  //
  // STALENESS-GUARDED via `reconcileBalance`: an older statement (or one
  // processed out of chronological order relative to what's already been
  // reconciled — the exact "several overlapping statements imported out of
  // order" scenario this used to be a known, unhandled limitation for) can no
  // longer regress a more current balance. `asOfDate` (this statement's own
  // latest transaction date) is compared against the account's stored
  // `balanceAsOf`; a retried job re-attempting the SAME statement's already-
  // applied reconciliation is naturally a no-op too (equal `asOf`, not
  // strictly newer) rather than double-applying it or leaving two
  // `BalanceSnapshot`s behind.
  if (closingBalance !== null) {
    const reconciled = await reconcileBalance(userId, accountId, closingBalance, asOfDate, "statement_closing_balance");
    await invalidateDashboardCache(userId);

    // If (and only if) that reconciliation actually applied, every pending
    // transaction THIS import created already has its effect captured by it
    // — the statement's closing balance reflects every one of this batch's
    // rows, confirmed or not, the instant the import finishes. Stamping them
    // `balanceReconciledAtImport: true` is what stops the confirm route
    // (`pending.routes.ts`, via `applyConfirmedTransactionBalanceEffect`)
    // from ALSO applying each row's own amount as a delta once someone
    // actually reviews and files it — which would double-count money the
    // closing balance already accounted for. When the reconciliation is
    // instead rejected as stale (an older/out-of-order statement), rows stay
    // unstamped and confirming them applies their delta exactly as it always
    // has, since no batch-level figure actually took effect for this import.
    if (reconciled) {
      const finalBatch = await ImportBatch.findById(batchId).select("resultingIds");
      const resultingIds = finalBatch?.resultingIds ?? [];
      if (resultingIds.length > 0) {
        await PendingTransaction.updateMany(
          { _id: { $in: resultingIds } },
          { balanceReconciledAtImport: true }
        );
      }
    }
  }

  await ImportBatch.findByIdAndUpdate(batchId, {
    status: "completed",
    closingBalance,
    expectedClosingBalance,
    closingBalanceMismatch,
  });
  await cleanupTempFile(filePath);
  // Deliberately no cleanup on a thrown error above (a chunk's DB write
  // failing, `insertMany` rejecting, etc.): that error is left to propagate
  // so BullMQ's existing retry/backoff (`defaultJobOptions`, 3 attempts) can
  // retry the whole job, and a retry needs the same file still on disk. Any
  // chunk that already completed before the failure stays recorded (per the
  // `$push`-not-`$set` persistence above) and is skipped, not redone, by the
  // `alreadyProcessed` resume logic above — so a successful retry ends with
  // each row accounted for exactly once, not duplicated. If every retry
  // attempt is exhausted, the `"failed"` listener registered in
  // `startStatementProcessWorker` below marks the batch failed and cleans up
  // the temp file — this function itself doesn't need to handle that case.
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
  const worker = makeWorker<StatementProcessJob>("statement-process", async (job: Job<StatementProcessJob>) =>
    processStatementUpload(job.data)
  );

  // BullMQ's "failed" event fires after EVERY failed attempt, not just the
  // last one — most of those are expected to retry (that's the whole point
  // of `defaultJobOptions.attempts: 3`), so this only acts once retries are
  // genuinely exhausted. Without this, a job that fails all 3 attempts (a
  // real transient error that never actually clears, a bug, anything) — as
  // opposed to `processStatementUpload`'s own two deliberate non-throwing
  // failure paths (unreadable temp file, unlock failure), which already
  // handle themselves — leaves its `ImportBatch` stuck at `"processing"`
  // forever: nothing else ever marks it failed, so the person just sees
  // "Processing your statement…" spin indefinitely with no error and no way
  // to know anything went wrong. `{status: "processing"}` in the filter
  // makes this a no-op on the rare race where the batch already reached a
  // terminal state some other way.
  worker.on("failed", async (job) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return; // will still retry — not exhausted yet

    try {
      await ImportBatch.findOneAndUpdate(
        { _id: job.data.batchId, status: "processing" },
        {
          status: "failed",
          error: "Something went wrong processing this statement. Please try uploading it again.",
        }
      );
      await cleanupTempFile(job.data.filePath);
    } catch (err) {
      console.error(`[statement-process] failed to finalize permanently-failed job for batch ${job.data.batchId}:`, err);
    }
  });

  return worker;
}
