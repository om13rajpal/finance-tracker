const DATE_TOKEN_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function isDateToken(token: string): boolean {
  return DATE_TOKEN_RE.test(token);
}

/** `DD/MM/YYYY` -> `YYYY-MM-DD`. Caller must already know `token` matches `isDateToken`. */
export function toIsoDate(token: string): string {
  const m = DATE_TOKEN_RE.exec(token);
  if (!m) throw new Error(`Not a DD/MM/YYYY date token: "${token}"`);
  const [, day, month, year] = m;
  return `${year}-${month}-${day}`;
}

const MONEY_TOKEN_RE = /^-?[\d,]+(?:\.\d+)?$/;

/** A bare `-` (SBI's empty-column placeholder) or an Indian comma-grouped number. */
export function isMoneyOrDashToken(token: string): boolean {
  return token === "-" || MONEY_TOKEN_RE.test(token);
}

export function isMoneyToken(token: string): boolean {
  return MONEY_TOKEN_RE.test(token);
}

/** Strips Indian comma-grouping (`1,23,456.00`) and parses. `-` -> `null` ("no value in this column"). */
export function parseIndianAmount(token: string): number | null {
  if (token === "-") return null;
  const n = parseFloat(token.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
