import { withRetry } from "../../lib/withRetry.js";

interface YahooChartResponse {
  chart?: {
    result?: { meta?: { regularMarketPrice?: number } }[];
  };
}

/**
 * Fetches the latest quoted price for an NSE-listed symbol from Yahoo Finance's
 * unofficial chart endpoint.
 *
 * Any malformed/unexpected response shape (empty `result`, missing `meta`, a
 * non-numeric `regularMarketPrice`) throws rather than silently returning `undefined`
 * or `NaN`, so `withRetry` actually retries that case instead of it slipping through
 * as a bad price.
 */
export async function fetchStockPrice(symbol: string): Promise<number> {
  return withRetry(async () => {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS`);
    if (!res.ok) {
      throw new Error(`Yahoo Finance request failed for ${symbol}: ${res.status}`);
    }

    const body = (await res.json()) as YahooChartResponse;
    const price = body?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price !== "number" || !Number.isFinite(price)) {
      throw new Error(`Yahoo Finance returned an unexpected response shape for ${symbol}`);
    }

    return price;
  });
}
