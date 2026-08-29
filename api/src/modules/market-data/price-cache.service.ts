import { PriceSnapshot } from "../../models/PriceSnapshot.js";
import { getCached } from "../../lib/cache.js";

export type InstrumentType = "stock" | "mutual_fund";

// Stocks move intraday; mutual fund NAVs are published once daily. These are
// DIFFERENT thresholds keyed off instrumentType — do not collapse to one constant.
const STALE_THRESHOLD_MS: Record<InstrumentType, number> = {
  stock: 2 * 60 * 60 * 1000, // 2 hours
  mutual_fund: 2 * 24 * 60 * 60 * 1000, // 2 days
};

export function getStaleThresholdMs(instrumentType: string): number {
  return STALE_THRESHOLD_MS[instrumentType as InstrumentType] ?? STALE_THRESHOLD_MS.stock;
}

export function priceCacheKey(symbol: string): string {
  return `price:${symbol}`;
}

interface CachedPriceEntry {
  price: number;
  fetchedAt: string;
}

export interface CachedPrice {
  price: number;
  fetchedAt: Date;
  stale: boolean;
}

/**
 * Resolves the latest known price for a symbol:
 * 1. Redis cache (written by the price-refresh worker, TTL'd to the instrument's own
 *    staleness threshold — see `processPriceRefreshJob`) — always fresh while present,
 *    since it expires at exactly the point the data would be considered stale anyway.
 * 2. Falls back to the most recent `PriceSnapshot` in Mongo on a cache miss, marking
 *    `stale: true` if that snapshot is older than the instrument-type-specific
 *    threshold (2h for stocks, 2 days for mutual funds).
 * 3. Returns `null` (never throws) when neither Redis nor Mongo has any price data at
 *    all for the symbol — e.g. a symbol that has never been fetched.
 */
export async function getLatestPrice(symbol: string, instrumentType: string): Promise<CachedPrice | null> {
  const cached = await getCached<CachedPriceEntry>(priceCacheKey(symbol));
  if (cached) {
    return { price: cached.price, fetchedAt: new Date(cached.fetchedAt), stale: false };
  }

  const snapshot = await PriceSnapshot.findOne({ symbol }).sort({ fetchedAt: -1 });
  if (!snapshot) return null;

  const threshold = getStaleThresholdMs(instrumentType);
  const stale = Date.now() - snapshot.fetchedAt.getTime() > threshold;
  return { price: snapshot.price, fetchedAt: snapshot.fetchedAt, stale };
}
