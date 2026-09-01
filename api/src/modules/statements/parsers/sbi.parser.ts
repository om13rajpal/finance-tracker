import type { PDFExtractPage } from "pdf.js-extract";
import type { StatementRowResult } from "../types.js";
import { linesFromPages } from "../line-builder.js";
import { isMoneyOrDashToken, parseIndianAmount, toIsoDate } from "./utils.js";

/**
 * SBI's row structure, verified directly against a real, unlocked SBI
 * statement during planning (26 pages, 318 transactions — see the plan doc):
 *
 *   WDL TFR                                                        <- narration label, own line, just above the row
 *   01/08/2026   01/08/2026   UPI/DR/.../MERCHANT   -   500.00   -   24,690.65   <- row start: two dates, then description-start, then ref | debit | credit | balance
 *   YA/SBIN/.../UPI                                                <- description continues...
 *   0000000000000 AT 00001 MAIN                                    <- ...across 1-3 more lines...
 *   BRANCH , CITY                                                  <- ...until the next date-starting line (or the label just above it)
 *
 * The label line "belongs" to the row that FOLLOWS it, not the row above —
 * disambiguated with one line of lookahead (see the main loop below): a
 * non-row-start line is only ever absorbed as the CURRENT row's description
 * continuation if the line after it is not itself a row start. If it is, this
 * line is the label for that upcoming row instead.
 *
 * A closing summary row and disclaimer boilerplate follow the last
 * transaction. Nothing there matches the two-date row-start pattern, so the
 * detector below skips it without special-casing — except the well-known
 * fixed phrases and pagination artifacts filtered out up front, which exist
 * only to stop that trailing text (and the "Page no. N" / repeated "Balance"
 * column header that appears at every page break) from being absorbed as
 * description continuation of the transaction physically nearest it.
 */
const ROW_START_RE = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.*)$/;

const BOILERPLATE_RES: RegExp[] = [
  /^page\s*(no\.?)?\s*\d+$/i,
  /^balance$/i,
  /statement summary/i,
  /^brought forward/i,
  /please do not share/i,
  /if your account is operated/i,
  /this is a computer generated statement/i,
];

function isBoilerplate(line: string): boolean {
  return BOILERPLATE_RES.some((re) => re.test(line));
}

/**
 * Safety cap on how many continuation lines a single row absorbs. The real
 * SBI sample never needed more than 3, but this exists specifically so the
 * LAST transaction on a statement — which has no next row-start to stop
 * absorption — can't run away consuming everything after it if some
 * boilerplate phrase isn't in the filter list above.
 */
const MAX_CONTINUATION_LINES = 6;

export function parseSbiStatement(pages: PDFExtractPage[]): StatementRowResult[] {
  const lines = linesFromPages(pages)
    .flat()
    .filter((line) => !isBoilerplate(line));

  interface RawRow {
    txnDate: string;
    tokens: string[];
    note: string | null;
    descParts: string[];
  }

  const rawRows: RawRow[] = [];
  let carryLabel: string | null = null;
  let current: RawRow | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = ROW_START_RE.exec(line);
    const nextIsRowStart = i + 1 < lines.length && ROW_START_RE.test(lines[i + 1]);

    if (match) {
      if (current) rawRows.push(current);
      const [, , txnDate, rest] = match;
      current = { txnDate, tokens: rest.split(/\s+/).filter(Boolean), note: carryLabel, descParts: [] };
      carryLabel = null;
      continue;
    }

    if (nextIsRowStart) {
      // This line is the narration label for the UPCOMING row, not
      // continuation text for the current one.
      carryLabel = line;
      continue;
    }

    if (current && current.descParts.length < MAX_CONTINUATION_LINES) {
      current.descParts.push(line);
    }
    // Otherwise: a stray line with nothing to attribute it to (e.g. before the
    // very first row) — ignored.
  }
  if (current) rawRows.push(current);

  return rawRows.map((row): StatementRowResult => {
    if (row.tokens.length < 4) {
      return { error: `Could not parse SBI row starting ${row.txnDate}: too few columns` };
    }

    const trailing = row.tokens.slice(-4);
    const descStart = row.tokens.slice(0, -4);
    if (!trailing.every(isMoneyOrDashToken)) {
      return { error: `Could not parse SBI row starting ${row.txnDate}: unexpected trailing columns` };
    }

    const [, debitTok, creditTok] = trailing; // [ref, debit, credit, balance]
    const debit = parseIndianAmount(debitTok);
    const credit = parseIndianAmount(creditTok);

    let amount: number;
    if (debit != null) amount = -debit;
    else if (credit != null) amount = credit;
    else return { error: `Could not parse SBI row starting ${row.txnDate}: neither debit nor credit present` };

    const merchant = [...descStart, ...row.descParts].join(" ").replace(/\s+/g, " ").trim();

    return {
      date: toIsoDate(row.txnDate),
      amount,
      merchant,
      note: row.note ?? "",
    };
  });
}
