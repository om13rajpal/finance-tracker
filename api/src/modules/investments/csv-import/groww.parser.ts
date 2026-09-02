import { parseTradeCsv, ParsedTradeRowResult } from "./zerodha.parser.js";

// Groww's trade-history CSV export uses the same column shape as Zerodha's
// (Symbol, Trade Date, Trade Type, Quantity, Price); see zerodha.parser.ts
// for the shared parsing/validation logic.
export function parseGrowwCsv(csvText: string): ParsedTradeRowResult[] {
  return parseTradeCsv(csvText);
}
