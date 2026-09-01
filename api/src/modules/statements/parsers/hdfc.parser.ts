import type { PDFExtractPage } from "pdf.js-extract";
import type { StatementRowResult } from "../types.js";
import { linesFromPages } from "../line-builder.js";
import { isDateToken, isMoneyToken, toIsoDate } from "./utils.js";

/**
 * HDFC's row structure is genuinely different from SBI's, confirmed via
 * read-only `pdftotext -opw <password> -layout` inspection of real HDFC
 * e-statements (not committed anywhere — see fixture files for the synthetic
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
 * Confirmed against a REAL HDFC PPF (Public Provident Fund) e-statement:
 * some HDFC statement variants don't zero-pad the empty side of
 * Withdrawal/Deposit at all — they omit that column's value from the row
 * entirely, so only ONE trailing amount token is printed (plus the closing
 * balance), not two. Every synthetic fixture used elsewhere prints an
 * explicit `0.00` on the empty side, so both shapes have to be handled:
 * `findAnchors` captures whichever 1-or-2 amount tokens are actually present
 * as `amountTokens`, and `resolveAmount` decides direction — trivial when
 * both columns are present (whichever is nonzero wins, as before), but when
 * only one token is printed there's no column position left to read
 * direction from, so it's inferred from whether the account's own stated
 * balance moved up or down since the previous row (`findOpeningBalance`
 * seeds this for the very first row from the statement's own "Opening
 * Balance" summary line). This is real money, so a row whose direction can't
 * be determined this way is reported as a row-level error rather than
 * guessing a sign.
 *
 * The "anchor line" for a transaction is the one physical line containing a
 * `DD/MM/YYYY` date at the start AND the value-date/amount(s)/balance
 * numeric tail at the end — those two things always co-occur on exactly one
 * line per transaction. Narration text can wrap onto lines immediately
 * BEFORE the anchor, immediately AFTER it, both, or neither (some rows are a
 * single self-contained line) — real examples confirmed all four shapes.
 * There is no "label line" like SBI's to disambiguate a shared boundary the
 * way SBI's lookahead does, so the lines physically between two anchors are
 * split at the midpoint: the first half is the earlier row's trailing
 * narration, the second half is the later row's leading narration. A single
 * line in the gap goes to whichever side's own on-anchor-line narration is
 * empty (i.e. the side that structurally "needs" it) — every real gap
 * observed was 0, 1 or 2 lines, and this reduces to the correct split in
 * each of those cases.
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
  // "Closing Bal" on a real statement, not always the full word "Balance" —
  // this has to catch both.
  /^opening balance\b.*closing bal/i,
  /generation date/i,
  /requesting branch code/i,
  // The STATEMENT SUMMARY block's own numeric row (opening balance, Dr/Cr
  // counts, total debits/credits, closing balance — six space-separated
  // number-shaped tokens, the middle two bare integers). Without this, these
  // six tokens are indistinguishable from ordinary text to `isBoilerplate`
  // and — since they don't start with a date — would silently get vacuumed
  // into the last real transaction's narration by the trailing LOOKAROUND_CAP
  // window below instead of being dropped.
  /^-?[\d,]+(?:\.\d+)?\s+\d+\s+\d+\s+-?[\d,]+(?:\.\d+)?\s+-?[\d,]+(?:\.\d+)?\s+-?[\d,]+(?:\.\d+)?$/,
  // The standard "computer generated, no signature needed" disclaimer,
  // wherever it wraps.
  /this is a computer generated statement/i,
  /does not require signature/i,
  // A "Label : value" account-detail/header line (e.g. "Account Branch :
  // Hissar Haryana", "Statement From : 31/07/25 TO : 31/05/26"). Real UPI
  // narration text in this bank's statements never starts this way — a
  // wrapped-narration continuation that legitimately begins with a colon
  // (e.g. ": PAYEE NAME") doesn't match this either, since it requires a
  // letter first.
  /^[a-z][a-z0-9 ./]{0,40}:\s*\S/i,
];

/**
 * The column-header row itself — "Date | Narration | Chq./Ref.No. | Value Dt
 * | Withdrawal Amt(ount). | Deposit Amt(ount). | Closing Balance". Broken out
 * from `isBoilerplate` (which still treats it as boilerplate) because its
 * POSITION also matters: see the `headerBoundary` use in `parseHdfcPage`.
 * Matches both the unabbreviated "Withdrawal Amount" wording every synthetic
 * fixture uses and the abbreviated "Withdrawal Amt." a real HDFC PPF
 * e-statement actually prints — "amount".includes("amt") is false (they only
 * share a prefix, not a substring), so both have to be checked explicitly.
 */
function isColumnHeaderLine(line: string): boolean {
  const lower = line.toLowerCase();
  return lower.includes("narration") && (lower.includes("withdrawal amount") || lower.includes("withdrawal amt"));
}

function isBoilerplate(line: string): boolean {
  if (isColumnHeaderLine(line)) return true;
  return BOILERPLATE_RES.some((re) => re.test(line));
}

/** How many lines to look back/forward at most when there's no anchor on the other side to bound the search. */
const LOOKAROUND_CAP = 3;

interface Anchor {
  index: number;
  date: string;
  onLineNarration: string;
  /** The 1 or 2 amount tokens printed just before the balance, left-to-right
   * (i.e. `[withdrawal, deposit]` when both are present). */
  amountTokens: number[];
  balance: number;
}

function findAnchors(lines: string[]): Anchor[] {
  const anchors: Anchor[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = ANCHOR_RE.exec(lines[i]);
    if (!m) continue;

    const tokens = m[2].split(/\s+/).filter(Boolean);
    if (tokens.length < 3) continue; // minimum: value date + one amount + balance

    const balanceIdx = tokens.length - 1;
    const balanceTok = tokens[balanceIdx];
    if (!isMoneyToken(balanceTok)) continue;

    // Consume 1 or (at most) 2 money tokens immediately before the balance —
    // TWO when both Withdrawal and Deposit are printed (an explicit `0.00`
    // on the empty side, the shape every existing fixture uses); ONE when
    // the empty side is omitted from the row entirely instead of
    // zero-padded (a real HDFC PPF e-statement does this). Capped at 2 so a
    // genuine amount token three back never gets mistaken for part of this
    // run — it has to be the value date, checked next.
    let amountStart = balanceIdx;
    while (amountStart > 0 && isMoneyToken(tokens[amountStart - 1]) && balanceIdx - amountStart < 2) {
      amountStart--;
    }
    if (amountStart === balanceIdx) continue; // no amount token at all — not a real anchor line

    const valueDateIdx = amountStart - 1;
    if (valueDateIdx < 0 || !isDateToken(tokens[valueDateIdx])) continue;

    const amountTokens = tokens.slice(amountStart, balanceIdx).map((t) => parseFloat(t.replace(/,/g, "")));

    // The `Chq. / Ref No.` column, if present, is whatever's left right
    // before the value date. Its own value is never used in the output
    // (blank vs. present doesn't change parsing), only its PRESENCE — it
    // marks where the on-line narration text ends.
    const middle = tokens.slice(0, valueDateIdx);
    const onLineNarration = middle.length > 1 ? middle.slice(0, -1).join(" ") : "";

    anchors.push({
      index: i,
      date: m[1],
      onLineNarration,
      amountTokens,
      balance: parseFloat(balanceTok.replace(/,/g, "")),
    });
  }

  return anchors;
}

/**
 * Resolves an anchor's 1-or-2 raw amount tokens into a single signed amount,
 * or an unresolvable-direction error. `carriedBalance` is the account's
 * balance immediately before this row — the previous anchor's own closing
 * balance, or (for the first row of the whole statement) whatever
 * `findOpeningBalance` found in the STATEMENT SUMMARY block, or `null` if
 * neither is available.
 */
function resolveAmount(anchor: Anchor, carriedBalance: number | null): { amount: number } | { error: string } {
  if (anchor.amountTokens.length === 2) {
    const [withdrawal, deposit] = anchor.amountTokens;
    return { amount: withdrawal !== 0 ? -withdrawal : deposit };
  }

  // Exactly one amount token was printed, so there's no column position
  // left to read direction from — infer it from which way the account's own
  // stated balance moved relative to `carriedBalance`. Real money, so an
  // unresolvable case (no reference balance at all, or the balance
  // implausibly didn't move) is reported as a row-level error rather than
  // guessing a sign, same philosophy as SBI's "garbage row" handling.
  const [amount] = anchor.amountTokens;
  if (carriedBalance === null) {
    return { error: "Could not determine whether this row was a withdrawal or a deposit" };
  }
  if (anchor.balance > carriedBalance) return { amount };
  if (anchor.balance < carriedBalance) return { amount: -amount };
  return { error: "Could not determine whether this row was a withdrawal or a deposit" };
}

/**
 * Parses one page's already-boilerplate-filtered lines. `carriedBalance` is
 * threaded in from the previous page (or the statement's opening balance, on
 * the first page) so balance-direction inference works across a page break,
 * not just within one page. Returns both this page's rows and the balance to
 * carry into the next page (the last anchor's own stated balance, or
 * `carriedBalance` unchanged if this page had no anchors at all).
 *
 * `headerBoundary` is the index, in THIS filtered `lines` array, of the first
 * line that survived filtering after the (removed) column-header row — or
 * -1 if this page had no header row at all. `before[0]`'s lookback is
 * clamped to never cross it. Without this, a statement whose transaction
 * table starts right after the header with no blank separator (confirmed
 * against a real HDFC PPF e-statement) lets the plain `LOOKAROUND_CAP`
 * lookback reach past the header into the repeated account/name/address
 * block above it — which isn't just wrong, it's a real person's name and
 * postal address ending up concatenated into a transaction's merchant text.
 *
 * `summaryBoundary` is the same idea for the OTHER end: the filtered index
 * of the "STATEMENT SUMMARY" marker (or `-1` if this page has none), which
 * `after[last]`'s look-ahead is clamped to never reach past. Bank-boilerplate
 * disclaimer wording varies too much to filter exhaustively line-by-line (a
 * real HDFC e-statement's own disclaimer text wraps across 2-3 physical
 * lines, e.g. "...and does" / "not require signature." — the second half
 * matches none of `BOILERPLATE_RES` on its own), but "STATEMENT SUMMARY" is
 * a reliable, structural start-of-footer signal every one of this bank's
 * statements prints right after the transaction table.
 */
function parseHdfcPage(
  lines: string[],
  carriedBalance: number | null,
  headerBoundary: number,
  summaryBoundary: number
): { rows: StatementRowResult[]; endingBalance: number | null } {
  const anchors = findAnchors(lines);
  if (anchors.length === 0) return { rows: [], endingBalance: carriedBalance };

  const before: string[][] = anchors.map(() => []);
  const after: string[][] = anchors.map(() => []);

  const before0Start = Math.max(headerBoundary === -1 ? 0 : headerBoundary, anchors[0].index - LOOKAROUND_CAP);
  before[0] = lines.slice(Math.max(0, before0Start), anchors[0].index);

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
  const after1End = Math.min(
    summaryBoundary === -1 ? lines.length : summaryBoundary,
    lastIdx + 1 + LOOKAROUND_CAP
  );
  after[anchors.length - 1] = lines.slice(lastIdx + 1, after1End);

  let balance = carriedBalance;
  const rows = anchors.map((anchor, i): StatementRowResult => {
    const resolved = resolveAmount(anchor, balance);
    // Advance the running balance to what this row itself claims, regardless
    // of whether its own direction could be resolved — one unresolvable row
    // must not throw off every row after it.
    balance = anchor.balance;

    if ("error" in resolved) return resolved;

    const merchant = [...before[i], anchor.onLineNarration, ...after[i]]
      .filter((s) => s.trim() !== "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      date: toIsoDate(anchor.date),
      amount: resolved.amount,
      merchant,
      note: "",
    };
  });

  return { rows, endingBalance: balance };
}

const SUMMARY_HEADER_RE = /^opening balance\b.*\bdr count\b.*\bcr count\b.*\bdebits\b.*\bcredits\b.*\bclosing bal/i;

/**
 * Finds this statement's own "Opening Balance" — the value on the line right
 * after the STATEMENT SUMMARY block's column header ("Opening Balance | Dr
 * Count | Cr Count | Debits | Credits | Closing Bal") — searched across
 * every page's UNfiltered lines (the header/value pair is boilerplate and
 * would otherwise never survive `isBoilerplate`, and doesn't need to: it
 * never matches `ANCHOR_RE` either way, since it doesn't start with a date).
 * Seeds `resolveAmount`'s balance-direction inference for the very first
 * ambiguous (single-amount-column) row, when there's no prior row's balance
 * to compare against. Returns `null` if this document has no summary block
 * at all — that just means a first-row ambiguous case falls back to being
 * reported as an error instead of a guess.
 */
function findOpeningBalance(lines: string[]): number | null {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!SUMMARY_HEADER_RE.test(lines[i])) continue;
    const firstToken = lines[i + 1].trim().split(/\s+/)[0];
    if (firstToken && isMoneyToken(firstToken)) return parseFloat(firstToken.replace(/,/g, ""));
  }
  return null;
}

export function parseHdfcStatement(pages: PDFExtractPage[]): StatementRowResult[] {
  const allPageLines = linesFromPages(pages);
  let carriedBalance = findOpeningBalance(allPageLines.flat());

  const results: StatementRowResult[] = [];
  for (const pageLines of allPageLines) {
    // Walk the RAW (unfiltered) lines once, tracking both which ones survive
    // filtering and — separately — the filtered-array index a column-header
    // row would leave behind, since the header itself never appears in
    // `filtered` (see `isColumnHeaderLine`'s doc comment for why its
    // position still matters).
    let headerBoundary = -1;
    let summaryBoundary = -1;
    let kept = 0;
    for (const line of pageLines) {
      if (isColumnHeaderLine(line)) {
        headerBoundary = kept;
        continue;
      }
      if (summaryBoundary === -1 && /statement summary/i.test(line)) summaryBoundary = kept;
      if (!isBoilerplate(line)) kept++;
    }

    const filtered = pageLines.filter((line) => !isBoilerplate(line));
    const { rows, endingBalance } = parseHdfcPage(filtered, carriedBalance, headerBoundary, summaryBoundary);
    results.push(...rows);
    carriedBalance = endingBalance;
  }
  return results;
}
