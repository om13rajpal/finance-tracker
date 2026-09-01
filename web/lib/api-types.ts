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

export type TransactionSource = "manual" | "csv_import" | "email_parsed";

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

/** Cursor pagination. `nextCursor` is null on the last page — never undefined. */
export interface TransactionsPage {
  items: Transaction[];
  nextCursor: string | null;
}

/**
 * A transaction the Gmail parser produced from a bank alert, waiting to be
 * confirmed. `accountId` is nullable because an email says what was spent but
 * not always from where — which is why confirming one can require picking an
 * account first.
 */
export interface PendingTransaction {
  _id: string;
  accountId: string | null;
  categoryId: string | null;
  amount: number;
  date: string;
  note?: string;
  merchant?: string;
  source: "email_parsed";
}

export interface ImportBatchResult {
  _id: string;
  source: "zerodha_csv" | "groww_csv" | "bank_statement";
  filename: string;
  importedAt: string;
  rowResults: { row: number; status: "success" | "failed"; reason?: string; transactionId?: string }[];
  resultingIds: string[];
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

export interface TaxSlabConfig {
  _id: string;
  financialYear: string;
  regime: "old" | "new";
  standardDeduction: number;
  slabs: { upTo: number | null; rate: number }[];
  section87ARebateLimit: number;
  section87ARebateMaxTax: number;
  section80CLimit: number;
}

// ── gmail ──────────────────────────────────────────────────────────────────

export interface GmailStatus {
  connected: boolean;
}
