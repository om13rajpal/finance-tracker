import type { PDFExtractPage, PDFExtractText } from "pdf.js-extract";

/**
 * How close two text items' y-coordinates have to be to count as "the same
 * visual line". `pdf.js-extract` reports y in PDF points, top-to-bottom
 * (confirmed empirically — y increases going down the page); items on one
 * printed line share the same baseline to within float precision, so a small
 * tolerance absorbs that without merging genuinely adjacent lines (statement
 * rows are printed with much more than this much line spacing).
 */
const Y_TOLERANCE = 3;

/**
 * Reconstructs one page's text content into an ordered array of "lines" —
 * each line is every text item whose y falls within `Y_TOLERANCE` of the
 * others, sorted left-to-right by x and joined with single spaces. This is
 * what lets the per-bank row parsers work off plain strings (find lines
 * starting with a date, etc.) instead of raw x/y-positioned fragments, and
 * it's what makes them independently unit-testable with hand-built fixtures —
 * see `statement-row-parser.test.ts`'s `mkPage` helper.
 *
 * Blank lines are dropped; nothing else is filtered here — that's each
 * parser's own responsibility (bank-specific boilerplate differs).
 */
export function linesFromPage(page: PDFExtractPage): string[] {
  const items = page.content.filter((c) => c.str.trim() !== "");
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  const clusters: PDFExtractText[][] = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(last[0].y - item.y) <= Y_TOLERANCE) {
      last.push(item);
    } else {
      clusters.push([item]);
    }
  }

  return clusters
    .map((cluster) =>
      [...cluster]
        .sort((a, b) => a.x - b.x)
        .map((c) => c.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((line) => line.length > 0);
}

/** `linesFromPage`, applied to every page in order. */
export function linesFromPages(pages: PDFExtractPage[]): string[][] {
  return pages.map(linesFromPage);
}
