import { Schema, model } from "mongoose";

const bulkConfirmResultSchema = new Schema(
  {
    id: { type: String, required: true },
    status: { type: String, enum: ["success", "skipped"], required: true },
    reason: { type: String, enum: ["not_found", "account_required", "possible_duplicate"] },
    transactionId: { type: String },
  },
  { _id: false }
);

/**
 * Tracks one async bulk-confirm run (`POST /pending-transactions/bulk-confirm`):
 * mirrors `ImportBatch`'s `status`/incremental-results shape, but is its
 * own model rather than reusing `ImportBatch`: bulk-confirm isn't an import
 * (no file, no single `accountId`: the pending rows it confirms can each
 * belong to a different account already), and forcing it through
 * `ImportBatch`'s statement-shaped fields (`filename`, `closingBalance`,
 * `dateRange`, ...) would mean populating several with meaningless values
 * just to satisfy that schema.
 *
 * Moved off the request thread for the same reason `statementProcess.worker.ts`
 * exists: confirming each pending transaction is several sequential DB round
 * trips (categorization lookup, duplicate check, Transaction create, balance
 * effect, PendingTransaction delete), and a large batch (a full statement's
 * worth of pending rows, seen in production at 117 items) running all of
 * that synchronously inside one HTTP request reliably exceeded the
 * production request-timeout path and returned a raw 502 with the work
 * silently still finishing server-side.
 */
const bulkConfirmBatchSchema = new Schema({
  userId: { type: String, required: true, index: true },
  status: { type: String, enum: ["processing", "completed", "failed"], default: "processing" },
  total: { type: Number, required: true },
  results: { type: [bulkConfirmResultSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  error: { type: String, default: null },
});

export const BulkConfirmBatch = model("BulkConfirmBatch", bulkConfirmBatchSchema);
