import { HoldingLot } from "../../models/HoldingLot.js";
import { getLatestPrice } from "../market-data/price-cache.service.js";

export interface HoldingRollup {
  symbol: string;
  instrumentType: string;
  totalUnits: number;
  avgCost: number;
  currentPrice: number | null;
  currentValue: number | null;
  priceStale: boolean;
}

/**
 * Rolls open (partially or fully unsold) lots up per symbol, merging in the latest
 * known market price for each symbol.
 * - Lots with remainingUnits === 0 (fully sold) are excluded entirely: a symbol
 *   whose every lot is fully sold does not appear in the result at all.
 * - avgCost is the weighted average cost across the symbol's *remaining* units
 *   (sum(remainingUnits * buyPrice) / sum(remainingUnits)), not a naive average
 *   of buyPrice across lots: a naive average would ignore quantity and be wrong
 *   whenever lots differ in size or how much of them has been sold.
 * - currentPrice/currentValue/priceStale come from `getLatestPrice`. When a symbol
 *   has NEVER been fetched (no cache entry, no PriceSnapshot at all), `getLatestPrice`
 *   returns null. This does not throw or abort the whole rollup; that symbol's row
 *   simply reports `currentPrice: null`, `currentValue: null`, `priceStale: true`
 *   (no price to trust, so treat it as maximally stale rather than silently 0/false).
 */
export async function getHoldingsRollup(userId: string): Promise<HoldingRollup[]> {
  const lots = await HoldingLot.find({ userId, remainingUnits: { $gt: 0 } }).lean();
  const bySymbol = new Map<string, { instrumentType: string; totalUnits: number; totalCost: number }>();

  for (const lot of lots) {
    const existing = bySymbol.get(lot.symbol) ?? {
      instrumentType: lot.instrumentType,
      totalUnits: 0,
      totalCost: 0,
    };
    existing.totalUnits += lot.remainingUnits;
    existing.totalCost += lot.remainingUnits * lot.buyPrice;
    bySymbol.set(lot.symbol, existing);
  }

  const results: HoldingRollup[] = [];
  for (const [symbol, agg] of bySymbol.entries()) {
    const priceInfo = await getLatestPrice(symbol, agg.instrumentType);
    results.push({
      symbol,
      instrumentType: agg.instrumentType,
      totalUnits: agg.totalUnits,
      avgCost: agg.totalCost / agg.totalUnits,
      currentPrice: priceInfo?.price ?? null,
      currentValue: priceInfo ? priceInfo.price * agg.totalUnits : null,
      priceStale: priceInfo?.stale ?? true,
    });
  }

  return results;
}
