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
  // route and the Gmail attachment path). `null` for every other source.
  // CSV/investment imports have no equivalent re-upload guard today.
  fileHash: { type: String, index: true, default: null },
  // Async lifecycle for a batch whose rows are still being processed by a
  // background worker (currently only the PDF-statement-upload route, see
  // `statementProcess.worker.ts`). Every other import path (CSV, investment
  // CSV, the Gmail PDF-attachment path) still builds its `ImportBatch` in one
  // synchronous shot, only ever calling `.create()` once all rows are already
  // known, so `"completed"` as the default preserves their exact existing
  // behavior unchanged; they never need to set this field themselves.
  status: { type: String, enum: ["processing", "completed", "failed"], default: "completed" },
  // Set only when `status` is `"failed"` (e.g. the PDF could not be unlocked
  // with any stored password), `null` otherwise.
  error: { type: String, default: null },
  // The statement's own closing balance, when the bank-specific parser could
  // find one (see `findStatementClosingBalance`, currently HDFC only,
  // `null` for every other source/parser). When present, the
  // statement-process worker uses it to reconcile the linked Account's
  // `currentBalance` automatically once the import completes. See
  // `statementProcess.worker.ts`'s doc comment for why this is safe to do
  // unconditionally (it's read straight off the statement, not derived from
  // whichever rows this parser managed to extract).
  closingBalance: { type: Number, default: null },
  // Data-quality signal, HDFC-only today (the only bank with an exported opening-
  // balance finder, see `STATEMENT_OPENING_BALANCE_REGISTRY`): the closing balance
  // this statement's OWN "Opening Balance" plus the sum of every successfully-parsed
  // row's amount would predict. Compared against `closingBalance` (the statement's
  // own PRINTED closing figure) once processing completes. A mismatch beyond
  // rounding means some row(s) on this statement were missed or misparsed, even
  // though `closingBalance` itself (read straight off the document) is still trusted
  // and still used to reconcile the account. Flagged, not blocking: never fails or
  // holds up the import. `null` whenever there's no opening-balance finder for this
  // parser, or the statement had no closing balance to compare against at all.
  expectedClosingBalance: { type: Number, default: null },
  closingBalanceMismatch: { type: Boolean, default: false },
  // The account this batch's rows belong to. `null` for batches created
  // before this field existed: those are simply never checked for overlap
  // (see `overlapWarning` below) or matched against by a later import; they
  // aren't retroactively backfilled. Set for every NEW pdf_statement batch
  // (`statement-upload.routes.ts`) and bank_statement CSV batch
  // (`csv-import.routes.ts`).
  accountId: { type: String, default: null },
  // This statement's own date span, derived from its successfully-parsed
  // rows' dates (min/max). `null` when there were no dateable rows at all,
  // or for a batch predating this field. Used only to detect overlap with
  // another statement already imported for the SAME account (see
  // `overlapWarning`); never used for anything balance- or transaction-
  // affecting.
  dateRange: {
    type: new Schema({ start: { type: Date, required: true }, end: { type: Date, required: true } }, { _id: false }),
    default: null,
  },
  // Non-blocking, informational: set when this batch's `dateRange` overlaps
  // an already-imported, still-existing `pdf_statement` batch for the same
  // account: a real, common scenario (re-downloading a statement, or
  // downloading a fresh one that covers some of the same days as one
  // already imported). Naming which prior file and how much it overlaps by,
  // so the person knows to expect some of this batch's rows to look like
  // duplicates of already-confirmed transactions (flagged individually via
  // `GET /pending-transactions`'s `possibleDuplicate`) or of each other's
  // still-pending rows once they get to reviewing them. `null` when no
  // overlap was found, there was no dateable row to compare, or no prior
  // batch for this account has a stored `dateRange` to compare against.
  overlapWarning: { type: String, default: null },
});

export const ImportBatch = model("ImportBatch", importBatchSchema);
