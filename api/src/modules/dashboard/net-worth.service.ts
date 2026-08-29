import { computeNetWorth } from "../accounts/accounts.service.js";
import { getHoldingsRollup } from "../investments/holdings.service.js";

/**
 * Full net worth = account-based net worth (bank/ppf/cash minus credit-card
 * liabilities, Task 9's `computeNetWorth`) + the current market value of all open
 * investment holdings (Task 14/15's `getHoldingsRollup`).
 *
 * A holding whose symbol has never had a price fetched reports `currentValue: null`
 * (see `getHoldingsRollup`'s doc comment) — that case falls back to cost basis
 * (`avgCost * totalUnits`) here rather than being skipped or coerced to 0. Skipping
 * would understate net worth for a real, non-zero position just because the
 * price-refresh job hasn't run for that symbol yet; treating it as 0 would be worse
 * (a held position vanishing from net worth entirely). `avgCost * totalUnits` can
 * never be NaN here: `getHoldingsRollup` only emits a symbol when it has at least one
 * lot with `remainingUnits > 0`, so `totalUnits` is always > 0 wherever `avgCost` is
 * computed from it.
 */
export async function computeFullNetWorth(userId: string): Promise<number> {
  const accountsNetWorth = await computeNetWorth(userId);
  const holdings = await getHoldingsRollup(userId);
  const investmentsValue = holdings.reduce(
    (sum, h) => sum + (h.currentValue ?? h.avgCost * h.totalUnits),
    0
  );
  return accountsNetWorth + investmentsValue;
}
