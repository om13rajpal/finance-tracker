import type { EmailParser } from "./types.js";

/**
 * HDFC's real-time transaction alerts often embed the account's own running
 * balance right alongside the debit itself, e.g. "...to SWIGGY on 15-08-26.
 * Avl Bal: Rs.12,345.67" — real templates vary in punctuation/spacing/casing
 * ("Avl Bal:", "Avl bal", "Avl.Bal.:", "Rs." vs "INR"), so this is deliberately
 * loose on those while still anchored to the fixed "Avl...Bal" phrase so it can
 * never accidentally match some other number in the email. Searched
 * independently of `DEBIT_ALERT_RE` below (not a single combined regex) since
 * this figure can appear anywhere in the body relative to the debit sentence,
 * and its absence must never prevent the debit itself from parsing.
 */
const AVAILABLE_BALANCE_RE = /Avl\.?\s*Bal\.?:?\s*(?:Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)/i;

const DEBIT_ALERT_RE = /Rs\.(\d+(?:\.\d+)?) debited from account .* to (.+?) on (\d{2}-\d{2}-\d{2})/;

/**
 * Parses an HDFC Bank debit-alert email body, e.g.:
 *   "Rs.499.00 debited from account XX1234 to SWIGGY on 15-08-26"
 * Returns `null` (rather than throwing) for anything that doesn't match this
 * shape — a non-match is a normal, expected outcome (a different HDFC email
 * template, a credit alert, etc.), not an error. The worker records that as
 * an `EmailImportLog` `parseStatus: "failed"` entry so it isn't reprocessed
 * on every redelivery.
 *
 * When the same email also carries an "Avl Bal" figure, it's returned as
 * `availableBalance` — the caller (gmailEmailParse.worker.ts) stores it on the
 * resulting `PendingTransaction` as a real-time balance-reconciliation signal,
 * applied (staleness-guarded) once the transaction is confirmed. Omitted
 * entirely (not `undefined` set explicitly, no key at all) when this email
 * doesn't include one — SBI doesn't reliably send one for every transaction at
 * all, so this must degrade gracefully to "no signal," not a hard requirement.
 */
export const parseHdfcDebitAlert: EmailParser = (emailBody) => {
  const match = emailBody.match(DEBIT_ALERT_RE);
  if (!match) return null;

  const [, amountStr, merchant, dateStr] = match;
  const [day, month, year] = dateStr.split("-");

  const balanceMatch = emailBody.match(AVAILABLE_BALANCE_RE);
  const availableBalance = balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, "")) : undefined;

  return {
    amount: -parseFloat(amountStr),
    merchant: merchant.trim(),
    date: `20${year}-${month}-${day}`,
    note: "Auto-imported from HDFC debit alert email",
    ...(availableBalance !== undefined ? { availableBalance } : {}),
  };
};
