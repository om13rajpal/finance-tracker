import { Account } from "../../models/Account.js";

/**
 * Net worth = sum of asset account balances (bank, ppf, cash) minus
 * sum of liability account balances (credit cards).
 *
 * Deliberately keys off `type === "credit_card"` rather than trusting the
 * stored `isLiability` flag: the flag is derived at creation time for
 * convenience (e.g. for clients rendering account lists), but the
 * authoritative rule for what counts as a liability is the account type.
 * This keeps net worth correct even if `isLiability` were ever wrong,
 * missing, or out of sync (e.g. from a future edit path or a data issue).
 *
 * Uses `Math.abs(currentBalance)` for credit cards rather than assuming it's
 * always stored as a positive "amount owed": the Accounts page's balance
 * fields are plain freeform number inputs with no sign coercion, and a
 * credit card's balance is displayed back to the user as a negative number
 * (red "Liability" text); nothing in the UI tells a user which sign to
 * type. Negating a value a user may have entered as already-negative would
 * double-negate it and ADD the debt to net worth instead of subtracting it,
 * which is exactly backwards. `Math.abs` makes this correct regardless of
 * which sign ends up stored.
 */
export async function computeNetWorth(userId: string): Promise<number> {
  const accounts = await Account.find({ userId }).lean();
  return accounts.reduce(
    (sum, acc) =>
      sum + (acc.type === "credit_card" ? -Math.abs(acc.currentBalance) : acc.currentBalance),
    0
  );
}
