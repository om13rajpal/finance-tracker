import type { PDFExtractPage } from "pdf.js-extract";
import type { StatementRowResult } from "../types.js";
import { linesFromPages } from "../line-builder.js";
import { toIsoDate } from "./utils.js";

/**
 * The best-effort fallback for any bank without its own dedicated parser
 * (see `sbi.parser.ts` / `hdfc.parser.ts` for the real ones) — same
 * graceful-degrade philosophy as `parseGenericBankCsv`. Single date + trailing
 * amount, one physical line per transaction, no multi-line description
 * absorption. Deliberately the least accurate parser here: every row it
 * produces still lands in the pending-transaction review queue rather than
 * being trusted outright, which is what makes this an acceptable fallback
 * rather than a silent correctness risk.
 */
const DATE_RE = /(\d{2}\/\d{2}\/\d{4})/;
// The LAST decimal amount on the line — a negative-lookahead for another
// later decimal amount is what makes this "last", not "first".
const AMOUNT_RE = /(-?[\d,]+\.\d{2})(?!.*-?[\d,]+\.\d{2})/;

export function parseGenericStatement(pages: PDFExtractPage[]): StatementRowResult[] {
  const lines = linesFromPages(pages).flat();
  const results: StatementRowResult[] = [];

  for (const line of lines) {
    const dateMatch = DATE_RE.exec(line);
    const amountMatch = AMOUNT_RE.exec(line);
    if (!dateMatch || !amountMatch) continue; // not transaction-shaped — not an error, just noise

    const amount = parseFloat(amountMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;

    results.push({
      date: toIsoDate(dateMatch[1]),
      amount,
      merchant: line.trim(),
      note: "",
    });
  }

  return results;
}
