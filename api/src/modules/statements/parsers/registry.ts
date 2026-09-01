import type { PDFExtractPage } from "pdf.js-extract";
import type { StatementRowResult } from "../types.js";
import { parseSbiStatement, findSbiClosingBalance } from "./sbi.parser.js";
import { parseHdfcStatement, findHdfcClosingBalance, findHdfcOpeningBalance } from "./hdfc.parser.js";

export type StatementParser = (pages: PDFExtractPage[]) => StatementRowResult[];
export type ClosingBalanceFinder = (pages: PDFExtractPage[]) => number | null;
export type OpeningBalanceFinder = (pages: PDFExtractPage[]) => number | null;

/**
 * Mirrors the existing `PARSER_REGISTRY` pattern in
 * `email-ingestion/parsers/registry.ts` — one real parser per known bank
 * layout. An unregistered (or absent) key falls back to the generic parser;
 * see `statement-row-parser.service.ts`.
 */
export const STATEMENT_PARSER_REGISTRY: Record<string, StatementParser> = {
  sbi_statement: parseSbiStatement,
  hdfc_statement: parseHdfcStatement,
};

/**
 * A second, OPTIONAL registry, deliberately separate from (and a subset of)
 * `STATEMENT_PARSER_REGISTRY` — not every bank layout has a closing-balance
 * finder written (the generic fallback parser has no dedicated layout
 * knowledge to lean on at all), and that's fine: `findStatementClosingBalance`
 * below just returns `null` for a `parserKey` with no entry here, same as
 * "couldn't determine a balance" rather than an error.
 */
export const STATEMENT_CLOSING_BALANCE_REGISTRY: Record<string, ClosingBalanceFinder> = {
  hdfc_statement: findHdfcClosingBalance,
  sbi_statement: findSbiClosingBalance,
};

/**
 * A THIRD, narrower registry — HDFC only today. SBI's own "closing balance"
 * (`findSbiClosingBalance`) is actually its page-1 Account Summary's "Clear
 * Balance ... As on <today>", a current-as-of-generation-date figure, NOT
 * derived from "opening balance + this statement's own transaction rows" the
 * way HDFC's is — so an opening-balance-based sanity check would be comparing
 * two unrelated numbers for SBI, not a real cross-check. See
 * `findSbiClosingBalance`'s own doc comment for why that distinction exists.
 */
export const STATEMENT_OPENING_BALANCE_REGISTRY: Record<string, OpeningBalanceFinder> = {
  hdfc_statement: findHdfcOpeningBalance,
};
