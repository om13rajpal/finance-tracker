export interface ParsedEmailTransaction {
  amount: number;
  merchant: string;
  date: string;
  note: string;
}

export type EmailParser = (emailBody: string, subject: string) => ParsedEmailTransaction | null;
