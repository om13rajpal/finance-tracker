import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { IncomeSource } from "../../models/IncomeSource.js";
import { SellEvent } from "../../models/SellEvent.js";
import { TaxDeduction } from "../../models/TaxDeduction.js";
import { getSlabConfig, getCapitalGainsConfig } from "./tax-slab.service.js";
import { syncAutoDeductions } from "./deductions.service.js";
import { computeTax, computeHraExemption, SlabConfigShape } from "./tax-compute.service.js";

export const estimateRouter = Router();
estimateRouter.use(requireAuth);

// Reshapes a TaxSlabConfig mongoose document into the plain SlabConfigShape
// computeTax expects: mongoose subdocuments type `upTo` as `number | null |
// undefined` (vs. the schema's actual `number | null`), so this narrows that back
// down explicitly rather than casting the whole document with `as any`.
function toSlabConfigShape(config: {
  financialYear: string;
  regime: "old" | "new";
  standardDeduction: number;
  slabs: { upTo?: number | null; rate: number }[];
  section87ARebateLimit: number;
  section87ARebateMaxTax: number;
  section80CLimit?: number;
  capitalGains?: {
    equity?: { ltcgExemptionLimit?: number; stcgRate?: number | null; ltcgRate?: number | null } | null;
  } | null;
}): SlabConfigShape {
  const equity = config.capitalGains?.equity;
  if (!equity) {
    throw new Error(
      `TaxSlabConfig for FY ${config.financialYear} (${config.regime} regime) has no capitalGains.equity block configured`
    );
  }
  return {
    standardDeduction: config.standardDeduction,
    slabs: config.slabs.map((s) => ({ upTo: s.upTo ?? null, rate: s.rate })),
    section87ARebateLimit: config.section87ARebateLimit,
    section87ARebateMaxTax: config.section87ARebateMaxTax,
    capitalGains: {
      equity: {
        ltcgExemptionLimit: equity.ltcgExemptionLimit ?? 0,
        stcgRate: equity.stcgRate ?? 0,
        ltcgRate: equity.ltcgRate ?? 0,
      },
    },
  };
}

estimateRouter.get("/", async (req, res, next) => {
  try {
    const fy = req.query.fy as string | undefined;
    if (!fy) return res.status(400).json({ error: "fy query param is required" });
    const userId = (req as any).userId;

    // Refresh auto-derived (ELSS) deductions first, so the estimate reflects the
    // user's current ELSS-tagged holdings and can never disagree with what GET
    // /tax/deductions shows.
    await syncAutoDeductions(userId, fy);

    const [incomeSources, sellEvents, deductions] = await Promise.all([
      IncomeSource.find({ userId, financialYear: fy }).lean(),
      SellEvent.find({ userId, financialYear: fy }).lean(),
      TaxDeduction.find({ userId, financialYear: fy }).lean(),
    ]);

    const grossSalary = incomeSources
      .filter((s) => s.type === "salary")
      .reduce((sum, s) => sum + s.annualAmount, 0);
    const otherIncome = incomeSources
      .filter((s) => s.type === "other")
      .reduce((sum, s) => sum + s.annualAmount, 0);
    // Same STCG/LTCG totalling logic as GET /tax/capital-gains
    // (capital-gains.routes.ts): recomputed here rather than imported since that
    // route doesn't export a standalone helper, but the shape (filter by
    // classification, sum gainAmount) is identical, so the numbers agree.
    const stcgAmount = sellEvents
      .filter((e) => e.classification === "STCG")
      .reduce((sum, e) => sum + e.gainAmount, 0);
    const ltcgAmount = sellEvents
      .filter((e) => e.classification === "LTCG")
      .reduce((sum, e) => sum + e.gainAmount, 0);
    const section80CTotal = deductions
      .filter((d) => d.section === "80C")
      .reduce((sum, d) => sum + d.amount, 0);
    // KNOWN SIMPLIFICATION, affects the accuracy of the estimate: every non-80C
    // deduction (80D, 80CCD(1B), 24(b), etc.) is added in FULL, uncapped: this app
    // doesn't model those sections' real individual limits, so a user could enter an
    // unrealistically large 80D amount and have it accepted wholesale. Treat the
    // estimate as a planning aid, not a filing-grade number, until per-section limits
    // are modelled in TaxSlabConfig.
    const otherSectionTotal = deductions
      .filter((d) => d.section !== "80C")
      .reduce((sum, d) => sum + d.amount, 0);

    // HRA exemption (Section 10(13A)), OLD REGIME ONLY, computed per salary
    // IncomeSource from its own `breakdown` and summed. `computeHraExemption`
    // returns 0 for a source with no/partial breakdown data, so this is safe to sum
    // unconditionally across every salary source. Subtracted from grossSalary
    // BEFORE calling computeTax for the old-regime result only, below: the
    // new-regime result uses the un-reduced grossSalary since the new regime
    // doesn't allow this exemption at all. computeTax itself stays unaware of HRA;
    // this mirrors the same route-applies-the-adjustment pattern already used for
    // the 80C cap.
    const hraExemptionTotal = incomeSources
      .filter((s) => s.type === "salary")
      .reduce(
        (sum, s) =>
          sum +
          computeHraExemption({
            basic: s.breakdown?.basic ?? undefined,
            hra: s.breakdown?.hra ?? undefined,
            rentPaidAnnual: s.breakdown?.rentPaidAnnual ?? undefined,
            isMetro: s.breakdown?.isMetro ?? undefined,
          }),
        0
      );
    const grossSalaryOldRegime = Math.max(0, grossSalary - hraExemptionTotal);

    // getCapitalGainsConfig's return value isn't used here (each regime's own
    // capitalGains block feeds toSlabConfigShape below): it's called for its
    // consistency guard: capital gains rules are regime-independent under Indian
    // law, so if the two regime documents' capitalGains.equity blocks have drifted
    // apart the comparison would report different capital gains tax per regime on
    // identical gains. Better to reject the FY than to publish that number.
    const [oldConfig, newConfig] = await Promise.all([
      getSlabConfig(fy, "old"),
      getSlabConfig(fy, "new"),
      getCapitalGainsConfig(fy),
    ]);

    // The 80C cap is applied HERE, per regime, scoped to ONLY section-80C-tagged
    // deductions, not when storing/summing deductions (Task 5's TaxDeduction totals
    // are raw). The new regime's section80CLimit is 0, so 80C deductions contribute
    // nothing there, matching real tax law.
    //
    // KNOWN SIMPLIFICATION, affects the accuracy of the estimate: this app only
    // models ONE section limit (80C's, via `section80CLimit`). Every other section
    // (80D, 80CCD(1B), 24(b), etc.) is added in full, uncapped, rather than being
    // checked against its own real-world limit, so a user could enter an
    // unrealistically large non-80C deduction and have it accepted wholesale
    // (see the `otherSectionTotal` comment above). This also applies to the NEW
    // regime's calculation below: real law disallows nearly all Chapter VI-A
    // deductions under the new regime, but this app doesn't track which sections are
    // allowed under which regime, so `otherSectionTotal` passes through there too,
    // arguably wrong under real law, a deliberate scope limit rather than a fixed
    // bug. Modelling either of these properly needs a per-section, per-regime limit
    // table in TaxSlabConfig; until then, treat the estimate as a planning aid, not
    // a filing-grade number.
    const oldResult = computeTax({
      grossSalary: grossSalaryOldRegime,
      otherIncome,
      stcgAmount,
      ltcgAmount,
      totalDeductions: Math.min(section80CTotal, oldConfig.section80CLimit) + otherSectionTotal,
      slabConfig: toSlabConfigShape(oldConfig),
    });
    const newResult = computeTax({
      grossSalary,
      otherIncome,
      stcgAmount,
      ltcgAmount,
      totalDeductions: Math.min(section80CTotal, newConfig.section80CLimit) + otherSectionTotal,
      slabConfig: toSlabConfigShape(newConfig),
    });

    res.json({
      old: oldResult,
      new: newResult,
      // Tie-break: on an exact tie, "old" wins. Arbitrary but deterministic and
      // reasonable: there's no tax-law reason to prefer one on a true tie.
      recommendation: oldResult.totalTax <= newResult.totalTax ? "old" : "new",
    });
  } catch (err) {
    next(err);
  }
});
