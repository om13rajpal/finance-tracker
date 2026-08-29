import type { EmailParser } from "./types.js";
import { parseHdfcDebitAlert } from "./hdfc.parser.js";

export const PARSER_REGISTRY: Record<string, EmailParser> = {
  hdfc_debit_alert: parseHdfcDebitAlert,
};
