/**
 * Best-effort mapping from an `EmailSource.institution` string (e.g. "HDFC",
 * "State Bank of India" — free text the user typed when setting up a filing
 * rule) to a registered statement `parserKey` (see `parsers/registry.ts`).
 * There's no UI for picking a statement parser on the automatic Gmail path
 * (unlike the manual upload form), so this is what lets an auto-ingested SBI
 * or HDFC attachment get the accurate bank-specific parser instead of always
 * falling back to the generic one. Returns `undefined` (not a guess) for
 * anything that doesn't confidently match — `parseStatementRows` already
 * falls back to the generic parser for an `undefined` key.
 */
export function guessStatementParserKey(institution: string): string | undefined {
  const key = institution.toLowerCase();
  if (key.includes("sbi") || key.includes("state bank")) return "sbi_statement";
  if (key.includes("hdfc")) return "hdfc_statement";
  return undefined;
}
