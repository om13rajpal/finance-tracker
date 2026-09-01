import { Schema, model } from "mongoose";

const rowResultSchema = new Schema(
  {
    row: { type: Number, required: true },
    status: { type: String, enum: ["success", "failed"], required: true },
    reason: { type: String },
    transactionId: { type: String },
  },
  { _id: false }
);

const importBatchSchema = new Schema({
  userId: { type: String, required: true, index: true },
  source: {
    type: String,
    enum: ["zerodha_csv", "groww_csv", "bank_statement", "pdf_statement"],
    required: true,
  },
  filename: { type: String, required: true },
  importedAt: { type: Date, default: Date.now },
  rowResults: { type: [rowResultSchema], default: [] },
  resultingIds: { type: [String], default: [] },
  // File-level idempotency for PDF statement uploads (both the manual upload
  // route and the Gmail attachment path). `null` for every other source —
  // CSV/investment imports have no equivalent re-upload guard today.
  fileHash: { type: String, index: true, default: null },
  // Async lifecycle for a batch whose rows are still being processed by a
  // background worker (currently only the PDF-statement-upload route — see
  // `statementProcess.worker.ts`). Every other import path (CSV, investment
  // CSV, the Gmail PDF-attachment path) still builds its `ImportBatch` in one
  // synchronous shot, only ever calling `.create()` once all rows are already
  // known — so `"completed"` as the default preserves their exact existing
  // behavior unchanged; they never need to set this field themselves.
  status: { type: String, enum: ["processing", "completed", "failed"], default: "completed" },
  // Set only when `status` is `"failed"` (e.g. the PDF could not be unlocked
  // with any stored password) — `null` otherwise.
  error: { type: String, default: null },
});

export const ImportBatch = model("ImportBatch", importBatchSchema);
