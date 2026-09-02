import type { PDFExtractPage } from "pdf.js-extract";
import type { StatementRowResult } from "../types.js";
import { linesFromPages } from "../line-builder.js";
import { isMoneyOrDashToken, parseIndianAmount, toIsoDate } from "./utils.js";

/**
 * SBI's row structure, verified directly against a real, unlocked SBI
 * statement during planning (26 pages, 318 transactions; see the plan doc):
 *
 *   WDL TFR                                                        <- narration label, own line, just above the row
 *   01/08/2026   01/08/2026   UPI/DR/.../MERCHANT   -   500.00   -   24,690.65   <- row start: two dates, then description-start, then ref | debit | credit | balance
 *   YA/SBIN/.../UPI                                                <- description continues...
 *   0000000000000 AT 00001 MAIN                                    <- ...across 1-3 more lines...
 *   BRANCH , CITY                                                  <- ...until the next date-starting line (or the label just above it)
 *
 * The label line "belongs" to the row that FOLLOWS it, not the row above.
 * It's disambiguated with one line of lookahead (see the main loop below): a
 * non-row-start line is only ever absorbed as the CURRENT row's description
 * continuation if the line after it is not itself a row start. If it is, this
 * line is the label for that upcoming row instead, UNLESS that line doesn't
 * look like a label at all (see `looksLikeLabel`), in which case it's really
 * the current row's own trailing continuation that just happens to sit
 * immediately before the next row starts (confirmed against real data: a row
 * whose description is already inline, e.g. "INTEREST CREDIT", has no
 * separate label line of its own).
 *
 * A closing summary row and disclaimer boilerplate follow the last
 * transaction. Nothing there matches the two-date row-start pattern, so the
 * detector below skips it without special-casing, except the well-known
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
 * A genuine narration LABEL for the upcoming row ("WDL TFR", "DEP TFR",
 * "CASH WITHDRAWAL SELF AT", "CASH DEPOSIT SELF AT 00652": every real
 * example seen) is a short, standalone phrase, never a comma-separated
 * address fragment. Confirmed against a real 118-page SBI statement: a row
 * type that carries its own description inline (e.g. "INTEREST CREDIT",
 * already present as that row's own on-line text) never has a separate
 * label line above it at all, so the line immediately before it is
 * actually the PREVIOUS row's trailing continuation (typically its branch
 * address, e.g. "MAIN BRANCH , HISAR"), which just happens to sit right
 * before the next row starts. Mistaking that for the next row's label (the
 * single-lookahead rule below would, without this check) loses it from the
 * row it actually describes AND attaches unrelated text as a false `note`
 * on the row that follows. The comma is what reliably tells the two apart
 * in every real example seen: a label is never comma-punctuated, an
 * address continuation line practically always is.
 */
function looksLikeLabel(line: string): boolean {
  return !line.includes(",");
}

/**
 * Safety cap on how many continuation lines a single row absorbs. The real
 * SBI sample never needed more than 3, but this exists specifically so the
 * LAST transaction on a statement, which has no next row-start to stop
 * absorption, can't run away consuming everything after it if some
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

    if (nextIsRowStart && looksLikeLabel(line)) {
      // This line is the narration label for the UPCOMING row, not
      // continuation text for the current one.
      carryLabel = line;
      continue;
    }

    if (current && current.descParts.length < MAX_CONTINUATION_LINES) {
      current.descParts.push(line);
    }
    // Otherwise: a stray line with nothing to attribute it to (e.g. before the
    // very first row): ignored.
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

/**
 * The account's actual CURRENT balance ("Clear Balance" in SBI's own Account
 * Summary block on page 1, "As on <today's date>"), deliberately NOT the
 * same thing as the last transaction row's own balance, or the "Closing
 * Balance" in the "Statement Summary" block at the very end of the document.
 * Confirmed against a real 118-page SBI export: those two numbers can be
 * meaningfully different: that document's printed transaction rows
 * happened to stop over a year before the statement's own generation date
 * (an SBI export quirk/limit, not a parsing bug), so the trailing summary's
 * "Closing Balance" reflected only the last transaction actually included,
 * not reality. "Clear Balance" is the one number in the document that's
 * always the true, as-of-now balance regardless of whether the transaction
 * list itself is complete, which is exactly what reconciling
 * `Account.currentBalance` needs.
 *
 * The page-1 Account Summary is a two-column layout, and this specific
 * field's label and value don't reliably end up on the same reconstructed
 * line the way every other field on that page does: empirically, "Clear
 * Balance" prints as its own standalone line, while its value shows up on a
 * DIFFERENT line that starts with a bare `:` (the colon that would normally
 * follow the label) immediately followed by the amount and a `CR`/`DR`
 * suffix, e.g. `": 9,894.83CR Branch Phone : 9275532076"`, merged with an
 * unrelated field from the page's other column that happens to sit at a
 * similar height. Matching on that bare-colon-prefixed shape directly (never
 * seen anywhere else on this page or in the transaction table, which starts
 * every line with a date) is more robust than trying to first re-pair it
 * with the "Clear Balance" label text across that layout quirk.
 */
const CLEAR_BALANCE_RE = /^:\s*([\d,]+\.\d{2})\s*(CR|DR)?\b/i;

export function findSbiClosingBalance(pages: PDFExtractPage[]): number | null {
  for (const line of linesFromPages(pages).flat()) {
    const m = CLEAR_BALANCE_RE.exec(line.trim());
    if (!m) continue;
    const amount = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;
    return m[2]?.toUpperCase() === "DR" ? -amount : amount;
  }
  return null;
}
