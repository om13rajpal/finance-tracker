import type { PDFExtractPage } from "pdf.js-extract";
import { linesFromPages } from "./line-builder.js";

/**
 * Reads the statement's OWN text for a bank name, so "Detect automatically"
 * (the manual upload form's default) actually detects something instead of
 * silently falling through to the generic parser every time nobody happens
 * to pick a bank from the dropdown. Checked against the already-unlocked
 * PDF's real content, not the filename or any user-supplied label.
 *
 * `/hdfc bank limited/i` mirrors the exact boilerplate line `hdfc.parser.ts`
 * already filters as boilerplate, confirmed against a real HDFC e-statement's
 * footer. `/state bank of india/i` and the `sbi.co.in` branch-email domain
 * (see `sbi.parser.ts`'s doc comment, e.g. "SBI.00652@SBI.CO.IN") are the
 * two SBI signals: either alone is enough, since neither plausibly appears
 * on a different bank's statement.
 *
 * Returns `undefined` (not a guess) when neither signal is found: `undefined`
 * already means "use the generic parser" everywhere this is called, so an
 * unrecognized bank degrades exactly the same as it did before this existed.
 */
export function detectStatementParserKey(pages: PDFExtractPage[]): string | undefined {
  const text = linesFromPages(pages).flat().join("\n").toLowerCase();

  if (text.includes("hdfc bank limited")) return "hdfc_statement";
  if (text.includes("state bank of india") || text.includes("sbi.co.in")) return "sbi_statement";

  return undefined;
}
