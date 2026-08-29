import type { EmailParser } from "./types.js";

/**
 * Parses an HDFC Bank debit-alert email body, e.g.:
 *   "Rs.499.00 debited from account XX1234 to SWIGGY on 15-08-26"
 * Returns `null` (rather than throwing) for anything that doesn't match this
 * shape — a non-match is a normal, expected outcome (a different HDFC email
 * template, a credit alert, etc.), not an error. The worker records that as
 * an `EmailImportLog` `parseStatus: "failed"` entry so it isn't reprocessed
 * on every redelivery.
 */
export const parseHdfcDebitAlert: EmailParser = (emailBody) => {
  const match = emailBody.match(
    /Rs\.(\d+(?:\.\d+)?) debited from account .* to (.+?) on (\d{2}-\d{2}-\d{2})/
  );
  if (!match) return null;

  const [, amountStr, merchant, dateStr] = match;
  const [day, month, year] = dateStr.split("-");

  return {
    amount: -parseFloat(amountStr),
    merchant: merchant.trim(),
    date: `20${year}-${month}-${day}`,
    note: "Auto-imported from HDFC debit alert email",
  };
};
