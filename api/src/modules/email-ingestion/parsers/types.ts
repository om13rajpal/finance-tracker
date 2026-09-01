export interface ParsedEmailTransaction {
  amount: number;
  merchant: string;
  date: string;
  note: string;
  /**
   * The bank's own stated running/available balance at the moment of this
   * transaction, when the email itself carries one (currently only HDFC's "Avl
   * Bal" alert text — see `hdfc.parser.ts`). `undefined` — not present at all,
   * distinct from `0` — when the parser found no such figure in this email, which
   * is the normal case for every parser that doesn't look for one yet (and for an
   * HDFC email that genuinely doesn't include it). A real-time, per-transaction
   * reconciliation signal, more precise than summing deltas since it's read
   * straight off the bank's own account state rather than derived from whichever
   * transactions this app has itself captured.
   */
  availableBalance?: number;
}

export type EmailParser = (emailBody: string, subject: string) => ParsedEmailTransaction | null;
