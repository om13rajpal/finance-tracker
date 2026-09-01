import type { PDFExtractPage } from "pdf.js-extract";
import type { StatementRowResult } from "../types.js";
import { linesFromPages } from "../line-builder.js";
import { isDateToken, isMoneyToken, toIsoDate } from "./utils.js";

/**
 * HDFC's row structure is genuinely different from SBI's, confirmed via
 * read-only `pdftotext -opw <password> -layout` inspection of a real HDFC
 * e-statement (not committed anywhere — see fixture files for the synthetic
 * stand-ins used in tests):
 *
 *   Date | Narration | Chq. / Ref No. | Value Date | Withdrawal Amount | Deposit Amount | Closing Balance*
 *
 * Two separate amount columns (not one signed column, and not SBI's
 * ref/debit/credit/balance framing) — exactly one of Withdrawal/Deposit is
 * ever nonzero per row; whichever is nonzero decides the sign (withdrawal =
 * expense, deposit = income). `Chq. / Ref No.` is often genuinely blank
 * (there's no dash placeholder like SBI's).
 *
 * The "anchor line" for a transaction is the one physical line containing a
 * `DD/MM/YYYY` date at the start AND the withdrawal/deposit/balance numeric
 * triple at the end — those two things always co-occur on exactly one line
 * per transaction. Narration text can wrap onto lines immediately BEFORE the
 * anchor, immediately AFTER it, both, or neither (some rows are a single
 * self-contained line) — real examples confirmed all four shapes. There is no
 * "label line" like SBI's to disambiguate a shared boundary the way SBI's
 * lookahead does, so the lines physically between two anchors are split at
 * the midpoint: the first half is the earlier row's trailing narration, the
 * second half is the later row's leading narration. A single line in the gap
 * goes to whichever side's own on-anchor-line narration is empty (i.e. the
 * side that structurally "needs" it) — every real gap observed was 0, 1 or 2
 * lines, and this reduces to the correct split in each of those cases.
 *
 * The full account/address/column-header block repeats on every page (not
 * just a page-number footer like SBI), so page-boilerplate filtering here is
 * broader than SBI's, including a generic "looks like a `Label : value`
 * account-detail line" pattern rather than an exhaustive phrase list.
 */
const ANCHOR_RE = /^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/;

const BOILERPLATE_RES: RegExp[] = [
  /^page\s+\d+\s+of\s+\d+$/i,
  /hdfc bank limited/i,
  /closing balance includes funds/i,
  /contents of this statement will be considered correct/i,
  /gstin/i,
  /registered office address/i,
  /\*\*end of statement\*\*/i,
  /statement summary/i,
  /^opening balance\b.*closing balance/i,
  /generation date/i,
  /requesting branch code/i,
  // A "Label : value" account-detail/header line (e.g. "Account Branch :
  // Hissar Haryana", "Statement From : 31/07/25 TO : 31/05/26"). Real UPI
  // narration text in this bank's statements never starts this way — a
  // wrapped-narration continuation that legitimately begins with a colon
  // (e.g. ": PAYEE NAME") doesn't match this either, since it requires a
  // letter first.
  /^[a-z][a-z0-9 ./]{0,40}:\s*\S/i,
];

function isBoilerplate(line: string): boolean {
  const lower = line.toLowerCase();
  if (lower.includes("narration") && lower.includes("withdrawal amount")) return true;
  return BOILERPLATE_RES.some((re) => re.test(line));
}

/** How many lines to look back/forward at most when there's no anchor on the other side to bound the search. */
const LOOKAROUND_CAP = 3;

interface Anchor {
  index: number;
  date: string;
  onLineNarration: string;
  withdrawal: number;
  deposit: number;
}

function findAnchors(lines: string[]): Anchor[] {
  const anchors: Anchor[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = ANCHOR_RE.exec(lines[i]);
    if (!m) continue;

    const tokens = m[2].split(/\s+/).filter(Boolean);
    if (tokens.length < 4) continue;

    const balanceTok = tokens[tokens.length - 1];
    const depositTok = tokens[tokens.length - 2];
    const withdrawalTok = tokens[tokens.length - 3];
    const valueDateTok = tokens[tokens.length - 4];

    if (!isMoneyToken(balanceTok) || !isMoneyToken(depositTok) || !isMoneyToken(withdrawalTok)) continue;
    if (!isDateToken(valueDateTok)) continue;

    // The `Chq. / Ref No.` column, if present, is whatever's left right
    // before the value date. Its own value is never used in the output
    // (blank vs. present doesn't change parsing), only its PRESENCE — it
    // marks where the on-line narration text ends.
    const middle = tokens.slice(0, tokens.length - 4);
    const onLineNarration = middle.length > 1 ? middle.slice(0, -1).join(" ") : "";

    anchors.push({
      index: i,
      date: m[1],
      onLineNarration,
      withdrawal: parseFloat(withdrawalTok.replace(/,/g, "")),
      deposit: parseFloat(depositTok.replace(/,/g, "")),
    });
  }

  return anchors;
}

function parseHdfcPage(lines: string[]): StatementRowResult[] {
  const anchors = findAnchors(lines);
  if (anchors.length === 0) return [];

  const before: string[][] = anchors.map(() => []);
  const after: string[][] = anchors.map(() => []);

  before[0] = lines.slice(Math.max(0, anchors[0].index - LOOKAROUND_CAP), anchors[0].index);

  for (let a = 0; a < anchors.length - 1; a++) {
    const gap = lines.slice(anchors[a].index + 1, anchors[a + 1].index);
    if (gap.length === 0) continue;
    if (gap.length === 1) {
      if (anchors[a].onLineNarration.trim() === "") after[a] = gap;
      else before[a + 1] = gap;
      continue;
    }
    const splitAt = Math.floor(gap.length / 2);
    after[a] = gap.slice(0, splitAt);
    before[a + 1] = gap.slice(splitAt);
  }

  const lastIdx = anchors[anchors.length - 1].index;
  after[anchors.length - 1] = lines.slice(lastIdx + 1, lastIdx + 1 + LOOKAROUND_CAP);

  return anchors.map((anchor, i): StatementRowResult => {
    const amount = anchor.withdrawal !== 0 ? -anchor.withdrawal : anchor.deposit;
    const merchant = [...before[i], anchor.onLineNarration, ...after[i]]
      .filter((s) => s.trim() !== "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      date: toIsoDate(anchor.date),
      amount,
      merchant,
      note: "",
    };
  });
}

export function parseHdfcStatement(pages: PDFExtractPage[]): StatementRowResult[] {
  return linesFromPages(pages)
    .map((pageLines) => pageLines.filter((line) => !isBoilerplate(line)))
    .flatMap(parseHdfcPage);
}
