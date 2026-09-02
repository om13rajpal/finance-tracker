/**
 * Sorted · the API's shapes, as the API actually returns them
 *
 * Written against api/src/modules/*. Two conventions to hold on to:
 *
 *  1. `_id`, never `id`.
 *  2. AMOUNT SIGN: negative is an expense, positive is income. Every "spend"
 *     figure the API computes filters `amount < 0` and reports `Math.abs()`,
 *     so a spend total is always positive and a raw transaction amount is not.
 */

import type { Bucket, CategoryNode, CategoryType } from "@/lib/buckets";

export type { Bucket, CategoryNode, CategoryType };

// ── accounts ───────────────────────────────────────────────────────────────

export type AccountType = "bank" | "credit_card" | "ppf" | "cash";

export interface Account {
  _id: string;
  type: AccountType;
  institution: string;
  nickname: string;
  currentBalance: number;
  /** Server-derived: true iff `type === "credit_card"`. Never sent on create. */
  isLiability: boolean;
  dueDate: string | null;
  lastUpdated: string;
}

export interface BalanceSnapshot {
  _id: string;
  accountId: string;
  balance: number;
  date: string;
}

// ── transactions ───────────────────────────────────────────────────────────

export type TransactionSource = "manual" | "csv_import" | "email_parsed" | "pdf_statement_parsed";

export interface Transaction {
  _id: string;
  accountId: string;
  categoryId: string | null;
  amount: number;
  date: string;
  note?: string;
  merchant?: string;
  source?: TransactionSource;
  status?: "confirmed" | "pending_review";
}

/** Cursor pagination. `nextCursor` is null on the last page: never undefined. */
export interface TransactionsPage {
  items: Transaction[];
  nextCursor: string | null;
}

/**
 * A transaction the Gmail parser or a PDF statement import produced, waiting
 * to be confirmed. `accountId` is nullable because an email (and, for the
 * automatic Gmail-attachment path, a PDF too) says what was spent but not
 * always from where: which is why confirming one can require picking an
 * account first. A PDF uploaded manually through Transactions always knows
 * its account up front, so `pdf_statement_parsed` rows from that path DO
 * carry an `accountId`: it is only the automatic Gmail-attachment path that
 * leaves it null, same reasoning as `email_parsed`.
 */
export interface PendingTransaction {
  _id: string;
  accountId: string | null;
  categoryId: string | null;
  amount: number;
  date: string;
  note?: string;
  merchant?: string;
  source: "email_parsed" | "pdf_statement_parsed";
  /**
   * True when a confirmed Transaction already exists on the same account,
   * for the same amount, within 2 days of this row's date: the same check
   * `POST /:id/confirm` and `/bulk-confirm` apply before filing anything,
   * surfaced here up front so the review queue itself can show it instead of
   * the person only discovering it via a skip/409 after trying to confirm.
   * Always `false` for a row with no `accountId` yet (nothing to check
   * against).
   */
  possibleDuplicate: boolean;
}

export interface ImportBatchResult {
  _id: string;
  source: "zerodha_csv" | "groww_csv" | "bank_statement" | "pdf_statement";
  filename: string;
  importedAt: string;
  rowResults: { row: number; status: "success" | "failed"; reason?: string; transactionId?: string }[];
  resultingIds: string[];
  /**
   * Async lifecycle. Every source except `pdf_statement` is created already
   * `"completed"` (they still build their `ImportBatch` in one synchronous
   * shot): only a PDF-statement upload starts `"processing"` and is polled
   * via `GET /transactions/import-pdf/:batchId` until it reaches a terminal
   * state.
   */
  status: "processing" | "completed" | "failed";
  error: string | null;
  /**
   * Non-blocking heads-up: this statement's own date range overlaps an
   * already-imported statement on the same account (a common, ordinary
   * scenario: re-downloading one, or downloading a newer one that covers
   * some of the same days). `null` when no overlap was found, or for a
   * source other than `pdf_statement`.
   */
  overlapWarning?: string | null;
}

/** The immediate response from `POST /transactions/import-pdf`: enqueues a
 * background job and returns before any row has been processed. */
export interface ImportPdfEnqueuedResult {
  batchId: string;
  status: "processing";
}

// ── bulk-confirm (async) ────────────────────────────────────────────────────

export interface BulkConfirmEnqueuedResult {
  batchId: string;
  status: "processing";
}

export interface BulkConfirmBatchResult {
  _id: string;
  status: "processing" | "completed" | "failed";
  total: number;
  results: {
    id: string;
    status: "success" | "skipped";
    reason?: "not_found" | "account_required" | "possible_duplicate";
    transactionId?: string;
  }[];
  error?: string | null;
}

// ── statement passwords ────────────────────────────────────────────────────

/**
 * Never carries the password in any form: `label` is the user's own note
 * only, never used to pick which password to try against a given file. Every
 * stored password is attempted, in no particular order, until one unlocks
 * the PDF.
 */
export interface StatementPassword {
  _id: string;
  label: string;
  createdAt: string;
}

// ── trusted senders (automatic Gmail ingestion) ────────────────────────────

/**
 * Gates BOTH automatic bank-alert-email parsing and automatic PDF-statement-
 * attachment processing: an email from a sender with no matching row here is
 * skipped entirely, before either ever runs.
 */
export interface EmailSource {
  _id: string;
  senderPattern: string;
  institution: string;
  /** True when alert-email BODY parsing is actually wired up for this
   * institution (HDFC only, today). PDF-statement attachments work for any
   * trusted sender regardless of this flag. */
  hasEmailBodyParser: boolean;
}

// ── categorization ─────────────────────────────────────────────────────────

export type MatchField = "merchant" | "note";
export type MatchType = "contains" | "exact";

export interface CategorizationRule {
  _id: string;
  matchField: MatchField;
  matchType: MatchType;
  matchValue: string;
  categoryId: string;
  /** Lower runs first. First match wins. */
  priority: number;
}

/**
 * A merchant that keeps showing up without a category (3+ times, across the
 * pending queue and/or already-confirmed transactions) and has no existing
 * rule that would already match it. `pendingIds`/`transactionIds` are the
 * EXACT items behind `count`: accepting a suggestion (`POST
 * /categorization-rules` with `applyToPendingIds`/`applyToTransactionIds`)
 * categorizes only these specific items, never a broader retroactive sweep.
 */
export interface CategorizationSuggestion {
  key: string;
  merchant: string;
  count: number;
  pendingIds: string[];
  transactionIds: string[];
}

/**
 * A (account, merchant) pair that repeats at a regular interval in confirmed
 * transaction history and isn't already tracked as a `RecurringItem`: see
 * `GET /recurring/suggestions`. Nothing persists this; accepting one just
 * means calling `POST /recurring` with these fields pre-filled.
 */
export interface RecurringSuggestion {
  key: string;
  merchant: string;
  accountId: string;
  type: RecurringType;
  amount: number;
  frequency: Frequency;
  nextDueDate: string;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  categoryId: string | null;
}

// ── dashboard ──────────────────────────────────────────────────────────────

/**
 * One row per TOP-LEVEL expense category only. A sub-category's transactions
 * roll into its parent's `spent` server-side and never get their own row.
 */
export interface BudgetVsSpendRow {
  categoryId: string;
  name: string;
  budgetLimit: number;
  spent: number;
}

export interface DashboardData {
  netWorth: number;
  guiltFreeMoney: { planned: number; spent: number; remaining: number };
  budgetVsSpend: BudgetVsSpendRow[];
}

// ── recurring ──────────────────────────────────────────────────────────────

export type RecurringType = "expense" | "income";
export type Frequency = "monthly" | "weekly" | "yearly" | "custom";
export type RecurringStatus = "active" | "paused" | "cancelled";

export interface RecurringItem {
  _id: string;
  name: string;
  type: RecurringType;
  amount: number;
  frequency: Frequency;
  nextDueDate: string;
  accountId: string;
  categoryId: string;
  linkedHoldingSymbol: string | null;
  autoCreate: boolean;
  status: RecurringStatus;
}

// ── investments ────────────────────────────────────────────────────────────

export type Platform = "zerodha" | "groww";
export type InstrumentType = "stock" | "mutual_fund";

export interface Holding {
  symbol: string;
  instrumentType: string;
  totalUnits: number;
  /** Weighted over REMAINING units only, not a naive mean of buy prices. */
  avgCost: number;
  /** null when no price has ever been fetched for the symbol. */
  currentPrice: number | null;
  currentValue: number | null;
  /** true when there is no price to trust yet, not only when one has aged. */
  priceStale: boolean;
}

export interface HoldingLot {
  _id: string;
  symbol: string;
  instrumentType: InstrumentType;
  platform: "zerodha" | "groww" | "other";
  units: number;
  remainingUnits: number;
  buyPrice: number;
  buyDate: string;
  isElss?: boolean;
}

/**
 * Response from `POST /holdings` (manual buy). `transaction` is null unless an
 * `accountId` was supplied on the request: a buy with no funding account
 * creates only the `HoldingLot`, matching the CSV import path's shape (no
 * account context available), and never touches any account's balance.
 */
export interface BuyHoldingResult {
  lot: HoldingLot;
  transaction: Transaction | null;
}

/**
 * Response from `POST /holdings/sell` (manual sell). `events` are the same
 * per-lot capital-gains `SellEventRow`s the Tax screen reads. `transaction` is
 * null unless an `accountId` was supplied, symmetric with `BuyHoldingResult`.
 */
export interface SellHoldingResult {
  events: SellEventRow[];
  transaction: Transaction | null;
  // True when no tax slab config existed for the sell's financial year, so
  // classification used the built-in statutory default (still correct under
  // current law, just not a config anyone explicitly confirmed).
  usedDefaultConfig: boolean;
}

// ── goals ──────────────────────────────────────────────────────────────────

export interface Goal {
  _id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string | null;
}

// ── tax ────────────────────────────────────────────────────────────────────

export type Classification = "STCG" | "LTCG";

export interface SellEventRow {
  _id: string;
  symbol: string;
  lotId: string;
  buyDate: string;
  sellDate: string;
  unitsSold: number;
  costBasis: number;
  sellPrice: number;
  gainAmount: number;
  classification: Classification;
  financialYear: string;
}

export interface CapitalGainsResponse {
  events: SellEventRow[];
  totals: { stcg: number; ltcg: number; stcgCount: number; ltcgCount: number };
}

export type DeductionSource = "auto_ppf" | "auto_elss" | "manual";

export interface TaxDeductionRow {
  _id: string;
  section: string;
  amount: number;
  financialYear: string;
  source: DeductionSource;
}

export type IncomeType = "salary" | "other";

export interface IncomeSourceRow {
  _id: string;
  type: IncomeType;
  financialYear: string;
  annualAmount: number;
  breakdown?: {
    basic?: number | null;
    hra?: number | null;
    allowances?: number | null;
    rentPaidAnnual?: number | null;
    isMetro?: boolean | null;
  } | null;
}

export interface TaxEstimateResult {
  taxableIncome: number;
  taxOnSlabIncome: number;
  taxOnCapitalGains: number;
  totalTaxBeforeRebate: number;
  rebateApplied: number;
  totalTax: number;
}

export interface TaxEstimateResponse {
  old: TaxEstimateResult;
  new: TaxEstimateResult;
  recommendation: "old" | "new";
}

export interface CapitalGainsBucket {
  stcgHoldingDays: number;
  stcgRate: number | null;
  ltcgRate: number | null;
  ltcgExemptionLimit: number;
}

export interface TaxSlabConfig {
  _id: string;
  financialYear: string;
  regime: "old" | "new";
  standardDeduction: number;
  slabs: { upTo: number | null; rate: number }[];
  section87ARebateLimit: number;
  section87ARebateMaxTax: number;
  section80CLimit: number;
  capitalGains: { equity: CapitalGainsBucket; debt: CapitalGainsBucket };
}

// ── gmail ──────────────────────────────────────────────────────────────────

export interface GmailStatus {
  connected: boolean;
}
