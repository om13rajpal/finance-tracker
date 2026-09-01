import type { PDFExtractPage } from "pdf.js-extract";
import type { StatementRowResult } from "../types.js";
import { parseSbiStatement } from "./sbi.parser.js";
import { parseHdfcStatement } from "./hdfc.parser.js";

export type StatementParser = (pages: PDFExtractPage[]) => StatementRowResult[];

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
