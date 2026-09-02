/**
 * Sorted · formatting
 *
 * One place for every rupee figure and every date the product prints.
 *
 * Rupees are Indian-grouped (lakh/crore), zero decimals: a personal tracker
 * reasons in whole rupees, and paise in a dense ledger is noise that costs two
 * characters of column width on every single row.
 *
 * Every figure is set in `--num` with `tabular-nums`. That is not decoration:
 * without tabular figures an amount column jitters as digits change and the
 * ledger stops being scannable down its right edge.
 */

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** ₹42,18,650: the house format. Negative amounts keep their minus. */
export function formatInr(amount: number): string {
  return INR.format(amount);
}

/**
 * ₹28,000 with an explicit direction sign in front.
 *
 * Used only where direction is the point (an Upcoming row, a ledger amount).
 * The sign is a THIRD carrier of direction alongside the arrow glyph and the
 * chip fill, so direction survives greyscale and deuteranopia.
 *
 * Uses U+2212 MINUS SIGN, not a hyphen: at mono figure sizes a hyphen is
 * visibly shorter than the plus and the column looks misaligned.
 */
export function formatSignedInr(amount: number): string {
  const magnitude = INR.format(Math.abs(amount));
  if (amount < 0) return `−${magnitude}`;
  return `+${magnitude}`;
}

/** 1,240.5: units, not money. Trims trailing zeros. */
export function formatUnits(units: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(units);
}

/** ₹1,842.55: a per-unit price, where paise genuinely matter. */
export function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** 30 Aug 2026 */
export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Sun 30 Aug: for dense rows where the year is implied by context. */
export function formatDayMonth(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

/** 4 Sept: no weekday, no year. For a dense row where context supplies both. */
export function formatDayMonthShort(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(d);
}

/** Sunday, 30 August: the dashboard's own headline. */
export function formatLongDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

/** `2026-08-30`: the value an `<input type="date">` wants. */
export function toDateInputValue(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today, in the shape `<input type="date">` wants. */
export function todayInputValue(): string {
  return toDateInputValue(new Date());
}

/**
 * "in 3 days" / "today" / "tomorrow" / "4 days ago".
 *
 * Whole days, computed on local midnights rather than on elapsed hours, so
 * something due at 23:00 tonight reads "today" and not "in 0 days".
 */
export function relativeDays(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

/**
 * The Indian financial year containing `date`, as `2026-27`.
 *
 * Mirrors api/src/lib/financialYear.ts exactly: April 1 to March 31, computed
 * on UTC parts, so the FY this pre-fills always matches what the backend would
 * compute for the same instant.
 */
export function financialYearFromDate(date: Date): string {
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  const startYear = month >= 3 ? year : year - 1;
  const endYearShort = ((startYear + 1) % 100).toString().padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

/** The current FY and the four before it, newest first. */
export function recentFinancialYears(count = 5): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) =>
    financialYearFromDate(new Date(Date.UTC(now.getUTCFullYear() - i, now.getUTCMonth(), 15)))
  );
}

/**
 * THE MONTH THE SERVER MEANS BY "this month".
 *
 * `GET /dashboard` computes its window from `new Date().toISOString().slice(0,7)`:
 * a UTC month, with UTC boundaries. In IST (UTC+5:30) that diverges from the
 * local month for five and a half hours at every month end: at 04:35 IST on
 * 1 September the server is still reporting August.
 *
 * Every "this month" label in the UI is therefore computed in UTC too, and
 * every one of them NAMES the month rather than saying "this month". If the
 * two ever disagree the screen says which one it is showing, instead of
 * quietly showing August's numbers under September's heading.
 */
export function apiMonth(now = new Date()): { year: number; month: number } {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

/** `August 2026`: the month the dashboard's figures actually cover. */
export function apiMonthLabel(now = new Date()): string {
  const { year, month } = apiMonth(now);
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month, 1))
  );
}

/** The 1st and last day of that month, as `1 – 31 Aug`. */
export function currentMonthRange(now = new Date()): string {
  const { year, month } = apiMonth(now);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const short = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month, 1))
  );
  return `1 – ${last} ${short}`;
}
