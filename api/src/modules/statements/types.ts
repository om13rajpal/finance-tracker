export interface StatementRow {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** Signed, this app's existing convention — negative is an expense. */
  amount: number;
  merchant: string;
  note: string;
}

export interface StatementRowError {
  error: string;
}

export type StatementRowResult = StatementRow | StatementRowError;
