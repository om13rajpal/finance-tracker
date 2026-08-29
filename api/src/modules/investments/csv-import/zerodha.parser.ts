import { parse } from "csv-parse/sync";

export interface ParsedTradeRow {
  symbol: string;
  date: string;
  tradeType: "buy" | "sell";
  quantity: number;
  price: number;
}

export type ParsedTradeRowResult = ParsedTradeRow | { error: string };

// Zerodha and Groww trade-history CSV exports share the same column shape:
// Symbol, Trade Date, Trade Type, Quantity, Price — Trade Date as DD/MM/YYYY.
// Shared here (rather than duplicated per-platform) so date/validation logic
// can't silently drift between the two parsers.
//
// Per-row error isolation (matches the Task 13 generic bank-statement parser
// convention): a malformed row never throws out of this function and never
// aborts parsing of the rest of the file — it comes back as `{ error }` so the
// caller can record just that row as failed and continue the batch.
export function parseTradeCsv(csvText: string): ParsedTradeRowResult[] {
  const records: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });

  return records.map((record) => {
    const rawDate = record["Trade Date"] ?? "";
    const dateMatch = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!dateMatch) {
      return { error: `Unparseable date: "${rawDate}"` };
    }
    const [, ddStr, mmStr, yyyy] = dateMatch;
    const dd = Number(ddStr);
    const mm = Number(mmStr);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
      return { error: `Unparseable date: "${rawDate}"` };
    }
    // ISO (YYYY-MM-DD) date-only strings are parsed by `new Date()` as UTC midnight,
    // so building this string preserves the day/month exactly as read from the CSV
    // (never handed to the Date constructor as the raw DD/MM/YYYY string, which JS
    // would otherwise misread as MM/DD/YYYY).
    const isoDate = `${yyyy}-${mmStr}-${ddStr}`;

    // Upper-cased, not just trimmed: `symbol` is the join key for everything
    // downstream — FIFO sell matching (`applySellFifo` queries lots by exact symbol),
    // the per-symbol holdings rollup, and price lookup/caching. A single case variant
    // between two rows (or two exports) would otherwise silently fork one position
    // into two half-holdings whose sells can no longer find their own buys. NSE/BSE
    // tickers are canonically upper-case, and mfapi scheme codes are digits, so
    // upper-casing is lossless for both instrument types this parser produces.
    const symbol = (record.Symbol ?? "").trim().toUpperCase();
    if (!symbol) {
      return { error: "Missing symbol" };
    }

    const tradeType = (record["Trade Type"] ?? "").trim().toLowerCase();
    if (tradeType !== "buy" && tradeType !== "sell") {
      return { error: `Unrecognized trade type: "${record["Trade Type"]}"` };
    }

    const quantity = parseFloat(record.Quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: `Invalid quantity: "${record.Quantity}"` };
    }

    const price = parseFloat(record.Price);
    if (!Number.isFinite(price) || price < 0) {
      return { error: `Invalid price: "${record.Price}"` };
    }

    return { symbol, date: isoDate, tradeType, quantity, price };
  });
}

export function parseZerodhaCsv(csvText: string): ParsedTradeRowResult[] {
  return parseTradeCsv(csvText);
}
