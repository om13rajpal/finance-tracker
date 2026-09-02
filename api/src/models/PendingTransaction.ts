import { Schema, model } from "mongoose";

const pendingTransactionSchema = new Schema({
  userId: { type: String, required: true, index: true },
  accountId: { type: String, default: null },
  categoryId: { type: String, default: null },
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  note: { type: String, default: "" },
  merchant: { type: String, default: "" },
  source: {
    type: String,
    enum: ["email_parsed", "pdf_statement_parsed"],
    default: "email_parsed",
  },
  // The bank's own stated running balance at the moment of this transaction, when
  // the email parser could find one (currently only HDFC's "Avl Bal" alert text,
  // see hdfc.parser.ts's AVAILABLE_BALANCE_RE). `null` for every other source/parser,
  // including every PDF-statement-derived pending transaction (a per-row balance
  // isn't part of `StatementRow` at all: the statement's closing balance is
  // reconciled separately, once per import, in statementProcess.worker.ts). When
  // present, confirming this transaction reconciles the account's balance directly
  // to this figure (staleness-guarded via `reconcileBalance`) instead of applying
  // the transaction's own amount as a plain delta. See pending.routes.ts.
  emailBalance: { type: Number, default: null },
  // Set true ONLY by statementProcess.worker.ts, and only for a row belonging
  // to an import whose statement-level closing-balance reconciliation
  // (reconcileBalance, source: "statement_closing_balance") actually applied.
  // That reconciliation already reflects this transaction's effect on the
  // account balance (and every other row from the same import, confirmed or
  // not) the moment the import finishes, well before anyone has reviewed a
  // single row. Confirming a row with this flag set must therefore NOT also
  // apply its own amount as a balance delta (see
  // `applyConfirmedTransactionBalanceEffect` in balance.service.ts): the
  // money was already counted once, via the statement's own printed closing
  // balance, and applying the delta on top would count it again. `false`
  // (the default) for every other pending transaction: plain email-parsed
  // rows, and any PDF-statement row whose import had no closing-balance
  // detection or whose reconciliation was rejected as stale, which still
  // need their own delta applied exactly as before.
  balanceReconciledAtImport: { type: Boolean, default: false },
});

export const PendingTransaction = model("PendingTransaction", pendingTransactionSchema);
