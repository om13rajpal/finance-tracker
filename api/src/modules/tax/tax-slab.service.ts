import { TaxSlabConfig } from "../../models/TaxSlabConfig.js";

export async function getSlabConfig(financialYear: string, regime: "old" | "new") {
  const config = await TaxSlabConfig.findOne({ financialYear, regime });
  if (!config) {
    const err = new Error(
      `No tax slab config found for FY ${financialYear} (${regime} regime). Add one via POST /tax/slab-config before using this feature for that year.`
    );
    (err as any).status = 404;
    throw err;
  }
  return config;
}

export interface CapitalGainsEquityConfig {
  stcgHoldingDays: number;
  stcgRate: number | null;
  ltcgRate: number | null;
  ltcgExemptionLimit: number;
  /** True when no `TaxSlabConfig` exists for the FY and this is the built-in
   * statutory fallback below, not a user-confirmed config. */
  isDefault: boolean;
}

const EQUITY_FIELDS = ["stcgHoldingDays", "stcgRate", "ltcgRate", "ltcgExemptionLimit"] as const;

/**
 * The current statutory equity capital-gains rule (365-day STCG threshold,
 * 20%/12.5% rates, ₹1,25,000 LTCG exemption per FY: the rule set by the
 * July 2024 Union Budget, unchanged since). Used ONLY as a fallback when a
 * financial year has no `TaxSlabConfig` document yet.
 *
 * This narrow rule (needed just to classify a sale as STCG/LTCG) is
 * deliberately NOT the same thing as "the full tax slab config is
 * optional": income-tax slabs, rebate limits, and 80C figures genuinely do
 * change every Budget and still hard-require an explicit, human-confirmed
 * `TaxSlabConfig` wherever they're used (`getSlabConfig`, untouched by this
 * fallback). The STCG/LTCG holding-period rule is comparatively stable law,
 * and gating an unrelated feature (recording a sale at all) behind a
 * document nobody has any UI to create was a real production bug: every
 * `POST /holdings/sell` 404'd once the seeded FY2025-26 config aged out.
 * Still verify against the current FY's actual notification before relying
 * on this for anything beyond "did this sale happen": see
 * `usedDefaultCapitalGainsConfig` on `SellEvent`, stamped whenever this
 * fallback is what classified a sale.
 */
const DEFAULT_EQUITY_CAPITAL_GAINS: Omit<CapitalGainsEquityConfig, "isDefault"> = {
  stcgHoldingDays: 365,
  stcgRate: 0.2,
  ltcgRate: 0.125,
  ltcgExemptionLimit: 125000,
};

/**
 * Resolves the FY's canonical equity capital gains rules.
 *
 * Capital gains rules (holding-period thresholds, rates, exemption limits) do NOT
 * differ by income-tax regime under Indian law, but TaxSlabConfig nests the
 * `capitalGains` block inside a REGIME-SPECIFIC document, and neither the schema nor
 * POST /tax/slab-config stops the "old" and "new" documents for one FY from drifting
 * apart (e.g. a user updating only the old regime's config after a Budget change).
 *
 * That drift would otherwise be silent and wrong in two places: STCG/LTCG
 * classification arbitrarily reads one regime's holding-period threshold, and the
 * dual-regime estimate would report different capital gains tax per regime on
 * identical gains. So this reads every regime document that exists for the FY and
 * requires their `capitalGains.equity` blocks to agree, failing loudly (409) if they
 * don't. Because the block is regime-independent, a single regime's document is
 * enough: classification does not hard-depend on the "new" document existing.
 *
 * When NO config exists for the FY at all, this falls back to
 * `DEFAULT_EQUITY_CAPITAL_GAINS` (`isDefault: true`) instead of throwing: see
 * that constant's doc comment for why. A drift between two EXISTING regime
 * documents still throws (409): that's always a data-entry error worth
 * surfacing loudly, unlike simply not having gotten around to configuring
 * this FY yet.
 */
export async function getCapitalGainsConfig(financialYear: string): Promise<CapitalGainsEquityConfig> {
  const configs = await TaxSlabConfig.find({ financialYear });
  const present: { regime: string; equity: Omit<CapitalGainsEquityConfig, "isDefault"> }[] = [];
  for (const config of configs) {
    const equity = config.capitalGains?.equity;
    if (!equity) continue;
    present.push({
      regime: config.regime ?? "unknown",
      equity: {
        stcgHoldingDays: equity.stcgHoldingDays,
        stcgRate: equity.stcgRate ?? null,
        ltcgRate: equity.ltcgRate ?? null,
        ltcgExemptionLimit: equity.ltcgExemptionLimit ?? 0,
      },
    });
  }

  if (present.length === 0) {
    return { ...DEFAULT_EQUITY_CAPITAL_GAINS, isDefault: true };
  }

  const [canonical, ...rest] = present;
  for (const other of rest) {
    const differing = EQUITY_FIELDS.filter((field) => canonical.equity[field] !== other.equity[field]);
    if (differing.length > 0) {
      const err = new Error(
        `TaxSlabConfig for FY ${financialYear} has divergent capitalGains.equity between the "${canonical.regime}" and "${other.regime}" regimes (${differing.join(", ")}). ` +
          `Capital gains rules do not differ by income-tax regime, so both regime documents must carry the same block. Update them via POST /tax/slab-config.`
      );
      (err as any).status = 409;
      throw err;
    }
  }

  return { ...canonical.equity, isDefault: false };
}
