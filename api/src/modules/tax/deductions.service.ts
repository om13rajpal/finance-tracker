import { HoldingLot } from "../../models/HoldingLot.js";
import { TaxDeduction } from "../../models/TaxDeduction.js";
import { financialYearFromDate } from "../../lib/financialYear.js";

/**
 * Recomputes the auto_elss deduction for a user+FY from scratch and upserts it,
 * keyed on {userId, source: "auto_elss", financialYear}: re-running this never
 * creates a duplicate document, it just overwrites `amount` on the existing one.
 *
 * Sums buyPrice * units (the real contributed amount, NOT remainingUnits: a
 * partial sell later doesn't retroactively shrink the 80C contribution that was
 * actually made) for HoldingLots tagged isElss: true whose buyDate falls within
 * the given FY. The 80C cap is deliberately NOT applied here: this just reports
 * the real total contributed; capping happens once, in Task 8's estimate
 * computation, so this raw number stays available for other uses (e.g. showing
 * the user how much of the cap they've used).
 *
 * Called from the read paths that depend on it (GET /tax/deductions and GET
 * /tax/estimate) rather than from a write hook, so the auto total can never go
 * stale relative to the HoldingLots it is derived from, matching the spec's
 * "no persisted estimate, always computed on demand" stance.
 *
 * When the FY has no ELSS-tagged lots at all, any existing auto row is DELETED
 * rather than zeroed: auto rows are deliberately undeletable through the API, so a
 * lingering Rs. 0 entry would be permanently stuck in the user's deduction list.
 */
export async function syncAutoDeductions(userId: string, financialYear: string): Promise<void> {
  const elssLots = await HoldingLot.find({ userId, isElss: true }).lean();
  const total = elssLots
    .filter((lot) => financialYearFromDate(lot.buyDate) === financialYear)
    .reduce((sum, lot) => sum + lot.buyPrice * lot.units, 0);

  if (total === 0) {
    await TaxDeduction.deleteOne({ userId, source: "auto_elss", financialYear });
    return;
  }

  await TaxDeduction.findOneAndUpdate(
    { userId, source: "auto_elss", financialYear },
    { section: "80C", amount: total, source: "auto_elss", financialYear, userId },
    { upsert: true }
  );
}
