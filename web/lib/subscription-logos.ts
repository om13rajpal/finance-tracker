/**
 * Sorted · merchant logos on Recurring
 *
 * A small, hand-curated table of merchant-name → domain, used ONLY to build a
 * logo.dev image URL for the Recurring screen's chip. This is deliberately not
 * a guess: a name that doesn't case-insensitively contain one of these keys
 * resolves to `null`, and the chip falls back to its normal bucket glyph.
 *
 * logo.dev serves a brand's logo by domain (`img.logo.dev/{domain}`), so the
 * table's values are domains, not display names.
 */

const MERCHANT_DOMAINS: Record<string, string> = {
  swiggy: "swiggy.com",
  zomato: "zomato.com",
  netflix: "netflix.com",
  spotify: "spotify.com",
  airtel: "airtel.in",
  "cult.fit": "cult.fit",
  cultfit: "cult.fit",
  bookmyshow: "bookmyshow.com",
  blinkit: "blinkit.com",
  zepto: "zeptonow.com",
  amazon: "amazon.in",
  hotstar: "hotstar.com",
  jio: "jio.com",
  google: "google.com",
  apple: "apple.com",
  youtube: "youtube.com",
  myntra: "myntra.com",
  uber: "uber.com",
  ola: "olacabs.com",
  rapido: "rapido.bike",
  licious: "licious.in",
};

/**
 * Case-insensitive substring match of `name` against the table above. Returns
 * a ready-to-render logo.dev URL, or `null` when there is no confident match
 * (never guessed) or the publishable token env var isn't set (fails safe to
 * the plain bucket icon rather than a broken/blank image).
 */
export function resolveLogoUrl(name: string): string | null {
  const token = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;
  if (!token) return null;

  const haystack = name.toLowerCase();
  const domain = Object.entries(MERCHANT_DOMAINS).find(([needle]) =>
    haystack.includes(needle)
  )?.[1];
  if (!domain) return null;

  return `https://img.logo.dev/${domain}?token=${token}&size=64&format=png`;
}
