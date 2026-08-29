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
}

const EQUITY_FIELDS = ["stcgHoldingDays", "stcgRate", "ltcgRate", "ltcgExemptionLimit"] as const;

/**
 * Resolves the FY's canonical equity capital gains rules.
 *
 * Capital gains rules (holding-period thresholds, rates, exemption limits) do NOT
 * differ by income-tax regime under Indian law — but TaxSlabConfig nests the
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
 * enough — classification does not hard-depend on the "new" document existing.
 */
export async function getCapitalGainsConfig(financialYear: string): Promise<CapitalGainsEquityConfig> {
  const configs = await TaxSlabConfig.find({ financialYear });
  const present: { regime: string; equity: CapitalGainsEquityConfig }[] = [];
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
    const err = new Error(
      `No tax slab config with a capitalGains.equity block found for FY ${financialYear}. Add one via POST /tax/slab-config before using this feature for that year.`
    );
    (err as any).status = 404;
    throw err;
  }

  const [canonical, ...rest] = present;
  for (const other of rest) {
    const differing = EQUITY_FIELDS.filter((field) => canonical.equity[field] !== other.equity[field]);
    if (differing.length > 0) {
      const err = new Error(
        `TaxSlabConfig for FY ${financialYear} has divergent capitalGains.equity between the "${canonical.regime}" and "${other.regime}" regimes (${differing.join(", ")}). ` +
          `Capital gains rules do not differ by income-tax regime, so both regime documents must carry the same block — update them via POST /tax/slab-config.`
      );
      (err as any).status = 409;
      throw err;
    }
  }

  return canonical.equity;
}
