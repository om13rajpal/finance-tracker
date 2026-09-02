import { parse } from "csv-parse/sync";
import { ParsedBankRow } from "./types.js";

// Bank statement dates are DD/MM/YYYY (not the US MM/DD/YYYY that JS's `new Date(string)`
// would assume), parsed explicitly here via a regex on (day, month, year) capture groups,
// never handed to the Date constructor as a raw string, so this is unambiguous even for
// dates like "03/04/2024" where both interpretations would otherwise be valid.
export function parseGenericBankCsv(csvText: string): (ParsedBankRow | { error: string })[] {
  const records: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });

  return records.map((record) => {
    const rawDate = record.Date ?? "";
    const dateMatch = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!dateMatch) return { error: `Unparseable date: "${rawDate}"` };

    const [, ddStr, mmStr, yyyy] = dateMatch;
    const dd = Number(ddStr);
    const mm = Number(mmStr);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
      return { error: `Unparseable date: "${rawDate}"` };
    }
    // ISO (YYYY-MM-DD) date-only strings are parsed by `new Date()` as UTC midnight,
    // so building this string preserves the day/month exactly as read from the CSV.
    const isoDate = `${yyyy}-${mmStr}-${ddStr}`;

    const debitRaw = (record.Debit ?? "").trim();
    const creditRaw = (record["Credit Amount"] ?? "").trim();
    const hasDebit = debitRaw !== "";
    const hasCredit = creditRaw !== "";

    if (hasDebit && hasCredit) {
      return { error: "Row has both Debit and Credit populated" };
    }
    if (!hasDebit && !hasCredit) {
      return { error: "Row has neither Debit nor Credit populated" };
    }

    const amount = hasCredit ? parseFloat(creditRaw) : -parseFloat(debitRaw);
    if (Number.isNaN(amount)) {
      return { error: "Unparseable amount" };
    }

    return { date: isoDate, amount, merchant: record.Description ?? "", note: "" };
  });
}
