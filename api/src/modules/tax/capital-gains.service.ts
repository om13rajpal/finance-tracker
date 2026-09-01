import { applySellFifo } from "../investments/holdings-fifo.js";
import { SellEvent } from "../../models/SellEvent.js";
import { getCapitalGainsConfig } from "./tax-slab.service.js";
import { financialYearFromDate } from "../../lib/financialYear.js";

/**
 * Wraps applySellFifo: matches the sell FIFO against the user's open lots for the
 * symbol, then classifies each matched lot independently as STCG or LTCG (a single
 * sell can span multiple lots with different holding periods, so it can produce
 * multiple SellEvents), and persists one SellEvent per matched lot.
 *
 * Asset class mapping: this app only tracks stock and equity-oriented mutual funds
 * today (see Task 14's CSV import — no debt-fund import path exists), so both
 * instrumentType "stock" and "mutual_fund" map to the slab config's "equity" bucket
 * here. If a debt-fund import path is added later, this mapping needs a real
 * instrument-category field to distinguish equity from debt funds.
 *
 * Debt gains (not reachable today, per the above): the spec notes debt gains are
 * taxed at slab rate regardless of holding period under current rules, with no
 * LTCG treatment — recorded with classification "STCG" for consistency until a
 * real debt asset class exists.
 *
 * Regime lookup: capital gains holding-period/rate rules do NOT differ by
 * income-tax regime (a real feature of Indian tax law) — both the "old" and "new"
 * TaxSlabConfig documents for a given FY must carry identical `capitalGains`
 * blocks. getCapitalGainsConfig resolves that shared block from whichever regime
 * documents exist and REJECTS the FY outright if they have drifted apart, so a
 * config edit that touches only one regime can never silently mis-classify a sale.
 */
export async function recordSale(
  userId: string,
  params: {
    symbol: string;
    instrumentType: "stock" | "mutual_fund";
    sellDate: Date;
    sellPrice: number;
    unitsSold: number;
  }
) {
  // Resolved BEFORE applySellFifo runs, deliberately: applySellFifo persists its
  // per-lot deduction via lot.save() as it matches lots (see holdings-fifo.ts),
  // so it must be the last thing that can fail. If getCapitalGainsConfig ran
  // after it and threw (e.g. no TaxSlabConfig for this FY yet), the sell would
  // be reported as failed to the caller while HoldingLot.remainingUnits had
  // already been partially deducted — breaking the "failed sell has zero side
  // effects" contract holdings-fifo.ts documents and callers (like the CSV
  // import's per-row failure isolation) rely on.
  const financialYear = financialYearFromDate(params.sellDate);
  const { stcgHoldingDays, isDefault } = await getCapitalGainsConfig(financialYear);

  const matchedLots = await applySellFifo(userId, params.symbol, params.unitsSold);

  const events = [];
  for (const lot of matchedLots) {
    const holdingDays = (params.sellDate.getTime() - lot.buyDate.getTime()) / (1000 * 60 * 60 * 24);
    const classification = holdingDays <= stcgHoldingDays ? "STCG" : "LTCG";
    const saleProceeds = params.sellPrice * lot.unitsFromLot;
    const gainAmount = saleProceeds - lot.costBasis;

    const event = await SellEvent.create({
      userId,
      symbol: params.symbol,
      lotId: lot.lotId,
      sellDate: params.sellDate,
      buyDate: lot.buyDate,
      sellPrice: params.sellPrice,
      unitsSold: lot.unitsFromLot,
      costBasis: lot.costBasis,
      gainAmount,
      classification,
      financialYear,
      usedDefaultCapitalGainsConfig: isDefault,
    });
    events.push(event);
  }
  return events;
}
