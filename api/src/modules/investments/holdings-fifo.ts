import { HoldingLot } from "../../models/HoldingLot.js";

/**
 * Reduces remainingUnits FIFO (oldest buyDate first) across a user's open lots for a symbol.
 *
 * Correctness properties this relies on and preserves:
 * - Ordering is strictly by buyDate ascending (with _id as a tiebreaker for lots sharing
 *   the same buyDate) — never by insertion/backfill order, which can differ from
 *   chronological order when lots are imported or entered out of sequence.
 * - Availability is checked BEFORE any lot is mutated. If unitsSold exceeds the total
 *   remainingUnits held for the symbol, this throws and leaves every lot completely
 *   untouched — no partial deduction happens first. This matters for the CSV import
 *   flow: a caller that catches the error and records the row as "failed" must be able
 *   to trust that a failed sell had zero side effects, not a half-applied one.
 * - Each lot is deducted by at most its own remainingUnits (Math.min), so no lot's
 *   remainingUnits can ever go negative, including on an exact-match sell that zeroes
 *   a lot out exactly.
 *
 * Returns the FIFO-matched lots consumed by this sell, in the order they were matched
 * (oldest buyDate first), each with the units taken and their cost basis
 * (unitsFromLot * lot.buyPrice), plus the lot's buyDate for holding-period
 * classification (short-term vs long-term capital gains).
 */
export async function applySellFifo(
  userId: string,
  symbol: string,
  unitsSold: number
): Promise<{ lotId: string; unitsFromLot: number; costBasis: number; buyDate: Date }[]> {
  if (!(unitsSold > 0)) {
    throw new Error(`unitsSold must be a positive number, got ${unitsSold}`);
  }

  const lots = await HoldingLot.find({ userId, symbol, remainingUnits: { $gt: 0 } }).sort({ buyDate: 1, _id: 1 });

  const totalAvailable = lots.reduce((sum, lot) => sum + lot.remainingUnits, 0);
  if (unitsSold > totalAvailable) {
    throw new Error(
      `Cannot sell ${unitsSold} units of ${symbol}: only ${totalAvailable} units held (userId=${userId})`
    );
  }

  const matched: { lotId: string; unitsFromLot: number; costBasis: number; buyDate: Date }[] = [];
  let remaining = unitsSold;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const deduction = Math.min(lot.remainingUnits, remaining);
    lot.remainingUnits -= deduction;
    remaining -= deduction;
    await lot.save();
    matched.push({
      lotId: lot._id.toString(),
      unitsFromLot: deduction,
      costBasis: deduction * lot.buyPrice,
      buyDate: lot.buyDate,
    });
  }
  return matched;
}
