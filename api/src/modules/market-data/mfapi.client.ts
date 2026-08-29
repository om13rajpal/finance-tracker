import { withRetry } from "../../lib/withRetry.js";

interface MfApiLatestResponse {
  data?: { nav?: string }[];
}

/**
 * Fetches the latest NAV for a mutual fund scheme from mfapi.in.
 *
 * mfapi.in returns `nav` as a STRING (e.g. `"45.5000"`), so it's explicitly coerced
 * to a number here — a silent string/number bug would make downstream `currentValue`
 * calculations wrong or NaN without ever throwing.
 *
 * Any malformed/unexpected response shape (missing `data`, missing `nav`, non-numeric
 * `nav`) throws rather than silently returning `NaN`, so `withRetry` actually retries
 * that case instead of it slipping through as a bad price.
 */
export async function fetchMutualFundNav(schemeCode: string): Promise<number> {
  return withRetry(async () => {
    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}/latest`);
    if (!res.ok) {
      throw new Error(`mfapi.in request failed for scheme ${schemeCode}: ${res.status}`);
    }

    const body = (await res.json()) as MfApiLatestResponse;
    const rawNav = body?.data?.[0]?.nav;
    const nav = Number(rawNav);
    if (rawNav === undefined || rawNav === null || !Number.isFinite(nav)) {
      throw new Error(`mfapi.in returned an unexpected response shape for scheme ${schemeCode}`);
    }

    return nav;
  });
}
