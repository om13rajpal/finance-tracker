export interface SlabConfigShape {
  standardDeduction: number;
  slabs: { upTo: number | null; rate: number }[];
  section87ARebateLimit: number;
  section87ARebateMaxTax: number;
  capitalGains: {
    equity: { ltcgExemptionLimit: number; stcgRate: number; ltcgRate: number };
  };
}

export interface ComputeTaxInput {
  grossSalary: number;
  otherIncome: number;
  stcgAmount: number;
  ltcgAmount: number;
  totalDeductions: number;
  slabConfig: SlabConfigShape;
}

export interface ComputeTaxResult {
  taxableIncome: number;
  taxOnSlabIncome: number;
  taxOnCapitalGains: number;
  totalTaxBeforeRebate: number;
  rebateApplied: number;
  totalTax: number;
}

/**
 * Applies marginal (slab-by-slab) taxation: each slab's rate applies only to the
 * portion of income within that slab, not the whole amount at the top slab's rate.
 *
 * Slabs are expected in ascending order of `upTo`, with the final slab's `upTo`
 * being `null` (no upper bound). Each slab's rate applies to the amount of taxable
 * income strictly above the previous slab's ceiling and up to (inclusive of) this
 * slab's ceiling.
 */
function computeSlabTax(taxableIncome: number, slabs: SlabConfigShape["slabs"]): number {
  let tax = 0;
  let previousUpTo = 0;
  for (const slab of slabs) {
    const slabCeiling = slab.upTo ?? Infinity;
    if (taxableIncome <= previousUpTo) break;
    const amountInSlab = Math.min(taxableIncome, slabCeiling) - previousUpTo;
    tax += amountInSlab * slab.rate;
    previousUpTo = slabCeiling;
  }
  return tax;
}

/**
 * Pure tax computation: no DB access, no async, no hidden state. Task 8's route
 * calls this once per regime (old/new) after fetching that regime's slabConfig and
 * computing HRA exemption itself (HRA exemption only applies under the old regime;
 * this function has no opinion on HRA: the caller folds any HRA exemption into
 * totalDeductions before calling, so this function stays regime-agnostic).
 *
 * Two income streams are taxed completely separately and only combined at the very
 * end:
 *  1. Slab (ordinary) income: grossSalary + otherIncome, less standard deduction
 *     and totalDeductions, taxed via the marginal slabs.
 *  2. Capital gains: stcgAmount and ltcgAmount, taxed at flat rates from
 *     slabConfig.capitalGains.equity, with the LTCG exemption limit subtracted from
 *     the LTCG amount BEFORE the LTCG rate is applied (not applied as a flat
 *     discount off tax computed on the full amount). Capital gains never enter the
 *     slab computation and slab income never enters the capital-gains computation.
 *
 * Section 87A rebate: applies ONLY to tax on slab income, never to capital gains
 * tax: a real, non-obvious rule under current Indian tax law. Eligibility is
 * decided by comparing `taxableIncome` (slab income only, excluding capital gains)
 * against `section87ARebateLimit`. The rebate amount is capped at
 * `section87ARebateMaxTax` and can never exceed `taxOnSlabIncome` itself (so it
 * cannot go negative or "spill over" into reducing capital gains tax). It is
 * subtracted only from `taxOnSlabIncome`'s contribution to the total: structurally,
 * `rebateApplied` is computed from and bounded by `taxOnSlabIncome` alone, and
 * `taxOnCapitalGains` never appears in that computation.
 */
export function computeTax(input: ComputeTaxInput): ComputeTaxResult {
  const grossIncome = input.grossSalary + input.otherIncome;
  const afterStandardDeduction = Math.max(0, grossIncome - input.slabConfig.standardDeduction);
  const taxableIncome = Math.max(0, afterStandardDeduction - input.totalDeductions);

  const taxOnSlabIncome = computeSlabTax(taxableIncome, input.slabConfig.slabs);

  const { ltcgExemptionLimit, stcgRate, ltcgRate } = input.slabConfig.capitalGains.equity;
  const taxableLtcg = Math.max(0, input.ltcgAmount - ltcgExemptionLimit);
  const taxOnCapitalGains = input.stcgAmount * stcgRate + taxableLtcg * ltcgRate;

  // Section 87A rebate applies ONLY to tax on ordinary (slab) income, never to capital
  // gains tax. Eligibility is based on taxableIncome (slab income only, excluding
  // capital gains) against the FY's limit. The rebate is bounded by taxOnSlabIncome
  // itself, so it can never reduce below zero or touch taxOnCapitalGains.
  const rebateEligible = taxableIncome <= input.slabConfig.section87ARebateLimit;
  const rebateApplied = rebateEligible ? Math.min(taxOnSlabIncome, input.slabConfig.section87ARebateMaxTax) : 0;

  const totalTaxBeforeRebate = taxOnSlabIncome + taxOnCapitalGains;
  const totalTax = totalTaxBeforeRebate - rebateApplied;

  return {
    taxableIncome,
    taxOnSlabIncome,
    taxOnCapitalGains,
    totalTaxBeforeRebate,
    rebateApplied,
    totalTax,
  };
}

export interface HraExemptionInput {
  basic?: number;
  hra?: number;
  rentPaidAnnual?: number;
  isMetro?: boolean;
}

/**
 * Computes the HRA (House Rent Allowance) exemption under Section 10(13A),
 * OLD REGIME ONLY. The new regime does not allow this exemption at all; this
 * function has no opinion on regime, it's the caller's job (estimate.routes.ts)
 * to only fold the result into `totalDeductions`-equivalent income reduction for
 * the old-regime `computeTax` call, never the new-regime one. Same architectural
 * pattern as the 80C cap: applied by the route before calling `computeTax`, not
 * inside it.
 *
 * Standard formula: the exemption is the MINIMUM of:
 *   1. Actual HRA received.
 *   2. Rent paid annually, minus 10% of basic salary.
 *   3. 50% of basic salary if the employee is in a metro city, else 40%.
 * The result is clamped to a minimum of 0 (an exemption can never be negative,
 * which leg 2 can otherwise produce when rent paid is very low relative to basic).
 *
 * KNOWN SIMPLIFICATION: uses `basic` alone for the 10%/40%/50% legs. The textbook
 * formula technically uses basic + Dearness Allowance (DA), but this app doesn't
 * separately track DA, so `basic` stands in for "basic + DA" here.
 *
 * Returns 0 (never throws) if `basic`, `hra`, or `rentPaidAnnual` is missing: a
 * salary IncomeSource without full breakdown data simply gets no HRA exemption
 * rather than crashing the estimate.
 */
export function computeHraExemption(breakdown: HraExemptionInput): number {
  const { basic, hra, rentPaidAnnual, isMetro = false } = breakdown;
  if (basic === undefined || hra === undefined || rentPaidAnnual === undefined) return 0;

  const actualHraReceived = hra;
  const rentMinusTenPercentBasic = rentPaidAnnual - 0.1 * basic;
  const metroPercentOfBasic = (isMetro ? 0.5 : 0.4) * basic;

  return Math.max(0, Math.min(actualHraReceived, rentMinusTenPercentBasic, metroPercentOfBasic));
}
