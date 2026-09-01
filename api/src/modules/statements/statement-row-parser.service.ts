import type { PDFExtractPage } from "pdf.js-extract";
import type { StatementRowResult } from "./types.js";
import { STATEMENT_PARSER_REGISTRY, STATEMENT_CLOSING_BALANCE_REGISTRY } from "./parsers/registry.js";
import { parseGenericStatement } from "./parsers/generic.parser.js";

export type { StatementRow, StatementRowError, StatementRowResult } from "./types.js";

/**
 * Extracts transaction rows from an already-unlocked statement's pages (see
 * `pdf-unlock.service.ts` for producing these). Dispatches to a per-bank
 * parser by `parserKey` when one is registered; otherwise (no key, or a key
 * nobody's written a parser for yet) falls back to the generic best-effort
 * parser. Every parser iterates ALL pages, never just the first.
 */
export function parseStatementRows(pages: PDFExtractPage[], parserKey?: string): StatementRowResult[] {
  const parser = parserKey ? STATEMENT_PARSER_REGISTRY[parserKey] : undefined;
  return (parser ?? parseGenericStatement)(pages);
}

/**
 * The statement's own closing balance, if the parser for this `parserKey`
 * knows how to find one (see `STATEMENT_CLOSING_BALANCE_REGISTRY`'s doc
 * comment — not every bank layout has this written yet). `null` for no
 * `parserKey`, an unregistered one, or a registered one that genuinely
 * couldn't find a balance in this particular document — all three are
 * "nothing to reconcile with," not an error.
 */
export function findStatementClosingBalance(pages: PDFExtractPage[], parserKey?: string): number | null {
  const finder = parserKey ? STATEMENT_CLOSING_BALANCE_REGISTRY[parserKey] : undefined;
  return finder ? finder(pages) : null;
}
