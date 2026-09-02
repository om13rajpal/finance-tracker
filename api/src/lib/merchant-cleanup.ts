/**
 * Turns raw bank-statement narration into a short, human-readable merchant
 * label, e.g.
 *   "UPI/DR/103523751353/NETFLIX/HDFC/netflix.bd/Execu 0097691162095 AT
 *    00652 MAIN BRANCH , HISAR"
 * becomes "Netflix".
 *
 * Real UPI/NEFT/ATM narration buries the one useful fact (who this money
 * went to or came from) inside a pile of reference numbers, VPA handles,
 * IFSC-shaped bank codes, and branch addresses that mean nothing to a
 * person reviewing their own spending: see the real narrations exercised
 * in `merchant-cleanup.test.ts` for the actual shapes this handles.
 *
 * This is a best-effort heuristic, not a merchant-identification service:
 * it never invents a merchant that isn't legible in the source text. Three
 * tiers, first match wins:
 *
 *  1. A small dictionary of very common merchants/billers (`KNOWN_MERCHANTS`)
 *     matched anywhere in the uppercased text: highest confidence, and
 *     covers the cases that matter most for categorization/recurring
 *     detection (subscriptions, food delivery, big retail).
 *  2. Structural transaction-type patterns (UPI, NEFT/IMPS/RTGS, ATM
 *     withdrawal, cheque deposit, common fee/interest lines): reliable
 *     because they key off the bank's own fixed vocabulary, not off
 *     guessing an unknown merchant's name.
 *  3. A generic noise-stripping fallback for anything that matches neither:
 *     strip reference-number runs, VPA suffixes, and known boilerplate
 *     tokens, then title-case what's left. Always at least as readable as
 *     the input, never a claim to have identified a specific merchant.
 *
 * The caller is responsible for keeping the original raw text around (this
 * codebase's convention is to put it in the transaction's `note` field when
 * that's otherwise empty); cleanup here is lossy by design.
 */

import { cleanMerchantLabelWithLlm } from "./merchant-llm-cleanup.js";

const KNOWN_MERCHANTS: { pattern: RegExp; label: string }[] = [
  { pattern: /NETFLIX/, label: "Netflix" },
  { pattern: /SPOTIFY/, label: "Spotify" },
  { pattern: /JIOHOTSTAR|HOTSTAR/, label: "JioHotstar" },
  { pattern: /AMAZON\s*PRIME|PRIME\s*VIDEO/, label: "Amazon Prime" },
  { pattern: /GOOGLE\s*\*?\s*PLAY/, label: "Google Play" },
  { pattern: /YOUTUBE\s*PREMIUM|YOUTUBEPREMIUM/, label: "YouTube Premium" },
  { pattern: /AMAZON/, label: "Amazon" },
  { pattern: /FLIPKART/, label: "Flipkart" },
  { pattern: /MYNTRA/, label: "Myntra" },
  { pattern: /SWIGGY\s*INSTAMART|SWIGGYINSTAMART/, label: "Swiggy Instamart" },
  { pattern: /SWIGGY/, label: "Swiggy" },
  { pattern: /ZOMATO/, label: "Zomato" },
  { pattern: /ZEPTO/, label: "Zepto" },
  { pattern: /BLINKIT/, label: "Blinkit" },
  { pattern: /BIGBASKET/, label: "BigBasket" },
  { pattern: /DOMINOS/, label: "Dominos" },
  { pattern: /UBER/, label: "Uber" },
  { pattern: /\bOLA\b/, label: "Ola" },
  { pattern: /NAMMA\s*YATRI/, label: "Namma Yatri" },
  { pattern: /IRCTC/, label: "IRCTC" },
  { pattern: /INDIGO/, label: "IndiGo" },
  { pattern: /PAYTM/, label: "Paytm" },
  { pattern: /PHONEPE/, label: "PhonePe" },
  { pattern: /AIRTEL/, label: "Airtel" },
  { pattern: /\bJIO\b/, label: "Jio" },
  { pattern: /VODAFONE|\bVI\b/, label: "Vi" },
  { pattern: /BESCOM/, label: "BESCOM" },
  { pattern: /INDIAN\s*OIL/, label: "Indian Oil" },
  { pattern: /\bHPCL\b/, label: "HPCL" },
  { pattern: /\bBPCL\b/, label: "BPCL" },
  { pattern: /CULT\.?FIT|CULTFIT/, label: "Cult.fit" },
  { pattern: /APOLLO\s*PHARMACY/, label: "Apollo Pharmacy" },
  { pattern: /\bADOBE\b/, label: "Adobe" },
  { pattern: /DECATHLON/, label: "Decathlon" },
  { pattern: /BLUE\s*TOKAI/, label: "Blue Tokai" },
];

// Bank/IFSC-shaped codes and payment-gateway operator names that show up as
// standalone tokens inside UPI/NEFT narration and carry no merchant
// information of their own (IFSC is always 4 letters + a literal "0" +
// 6 more alphanumerics, e.g. "SBIN0000652", "HDFC0MERUP", "UTIB0000553").
const IFSC_LIKE_RE = /^[A-Z]{4}0[A-Z0-9]{5,7}$/;
const BOILERPLATE_TOKENS = new Set([
  "UPI",
  "UPIINTENT",
  "INTENT",
  "DR",
  "CR",
  "NEFT",
  "IMPS",
  "RTGS",
  "PAYU",
  "OKSBI",
  "OKHDFCBANK",
  "OKICICI",
  "OKAXIS",
  "YBL",
  "YESB",
  "APL",
  "EXECU",
  "AT",
  "MAIN",
  "BRANCH",
]);

/** True for a token that's mostly a reference number/masked card (e.g. "617123446765", "531209XXXXXX8884"); never a merchant name. */
function looksLikeReferenceOrMasked(token: string): boolean {
  const digits = (token.match(/\d/g) ?? []).length;
  const xs = (token.match(/X/gi) ?? []).length;
  return digits + xs >= Math.max(4, token.length - 2);
}

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bAtm\b/g, "ATM")
    .replace(/\bUpi\b/g, "UPI")
    .replace(/\bNeft\b/g, "NEFT")
    .replace(/\bImps\b/g, "IMPS")
    .replace(/\bRtgs\b/g, "RTGS")
    .replace(/\bSms\b/g, "SMS");
}

/** Extracts a payee-ish token from UPI narration, trying both of the two
 * real layouts seen in HDFC/SBI exports: `UPI-<PAYEE>-<vpa>@handle` (payee
 * right after "UPI-") and `UPI/DR/<ref>/<PAYEE>/<bank>/...` (payee at
 * slash-segment index 3). Returns `null` when neither shape is found or
 * the best candidate still looks like a reference number rather than a
 * name. */
function extractUpiPayee(raw: string): string | null {
  const upper = raw.toUpperCase();

  if (upper.includes("/")) {
    const segments = raw.split("/").map((s) => s.trim());
    if (segments.length > 3 && /^UPI$/i.test(segments[0]) && /^(DR|CR)$/i.test(segments[1])) {
      const candidate = segments[3].trim();
      if (candidate && !looksLikeReferenceOrMasked(candidate)) return candidate;
    }
  }

  // Hyphen-delimited style: take the segment right after the LAST "UPI-"
  // (there's frequently a reference number and a duplicate "UPI" token
  // earlier in the string, e.g. "0PTMUPI-617123446765-UPI UPI-ZEPTO-...").
  const lastUpiIdx = upper.lastIndexOf("UPI-");
  if (lastUpiIdx !== -1) {
    const after = raw.slice(lastUpiIdx + 4);
    const candidate = after.split("-")[0].trim();
    if (candidate && !looksLikeReferenceOrMasked(candidate)) return candidate;
  }

  // Some HDFC POS/UPI narration puts the merchant BEFORE the "UPI" marker
  // instead of after it, e.g. "...-SWIGGY UPI-XXXXXXX7543-...". Take the
  // run of alphabetic words immediately preceding a " UPI" marker.
  const beforeMatch = raw.match(/([A-Za-z][A-Za-z ]{2,30}?)\s+UPI[-/]/);
  if (beforeMatch) {
    const candidate = beforeMatch[1].trim();
    if (candidate && !looksLikeReferenceOrMasked(candidate)) return candidate;
  }

  return null;
}

/** Generic last-resort cleanup: strip reference-number runs, VPA suffixes,
 * and known boilerplate tokens, then title-case whatever's left. */
function genericFallback(raw: string): string {
  let text = raw
    // Drop a VPA/email-ish handle entirely ("name@bank" -> "name").
    .replace(/\S+@\S+/g, " ")
    // Drop IFSC-shaped bank codes.
    .split(/(\s+)/)
    .filter((tok) => !IFSC_LIKE_RE.test(tok.trim().toUpperCase()))
    .join("")
    // Drop long digit/reference runs (5+ digits) and masked-card runs.
    .replace(/\b[\dX]{5,}\b/gi, " ")
    // Drop known boilerplate words.
    .split(/\s+/)
    .filter((tok) => tok && !BOILERPLATE_TOKENS.has(tok.toUpperCase().replace(/[^A-Z]/g, "")))
    .join(" ")
    .replace(/[-/,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return raw.trim().slice(0, 40) || "Unknown";

  if (text.length > 40) text = text.slice(0, 40).trim();
  return titleCase(text);
}

/**
 * Same three-tier logic as `cleanMerchantLabel`, but also reports which tier
 * produced the result: tier 3 (generic fallback) is the only case worth
 * spending an LLM call on upgrading, since tiers 1 and 2 are already
 * high-confidence. Kept internal; `cleanMerchantLabel` and
 * `cleanMerchantLabelSmart` are the two public entry points.
 */
function cleanMerchantLabelWithTier(raw: string): { label: string; tier: 1 | 2 | 3 } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { label: "", tier: 3 };

  const upper = trimmed.toUpperCase();

  // Tier 1: known merchants/billers, matched anywhere in the text.
  for (const { pattern, label } of KNOWN_MERCHANTS) {
    if (pattern.test(upper)) return { label, tier: 1 };
  }

  // Tier 2: structural transaction-type patterns.
  if (/^INTEREST\s+CREDIT/.test(upper)) return { label: "Interest Credit", tier: 2 };
  if (/^INTEREST\s+PAID/.test(upper) || /BANK\s+INTEREST\s+PAID/.test(upper)) return { label: "Interest Paid", tier: 2 };

  if (/^CHQ\s*DEP/.test(upper)) return { label: "Cheque Deposit", tier: 2 };

  const atmMatch = trimmed.match(/^AT[WM]-[\dX]+-\w+-([A-Za-z ]+)$/i);
  if (atmMatch) return { label: `ATM Withdrawal · ${titleCase(atmMatch[1].trim())}`, tier: 2 };
  if (/^AT[WM][- ]/.test(upper)) return { label: "ATM Withdrawal", tier: 2 };

  if (/CASH\s*WDL/.test(upper)) {
    if (/COMM/.test(upper)) return { label: "ATM Cash Withdrawal Commission", tier: 2 };
    if (/SERV/.test(upper)) return { label: "ATM Cash Withdrawal Service Charge", tier: 2 };
    return { label: "ATM Cash Withdrawal", tier: 2 };
  }

  if (/DEBIT\s*CARD\s*ISSUANCE\s*FEE/.test(upper)) return { label: "Debit Card Issuance Fee", tier: 2 };
  if (/DEBIT\s*CARD\s*ANNUAL\s*FEE|DEBIT\s*CARD\s*A\/?C\s*FEE/.test(upper)) return { label: "Debit Card Annual Fee", tier: 2 };
  if (/SMS\s*ALERT\s*CHARGES?/.test(upper)) return { label: "SMS Alert Charges", tier: 2 };
  if (/(AMB|MIN(?:IMUM)?\s*BAL(?:ANCE)?)\s*CHARGES?/.test(upper)) return { label: "Minimum Balance Charges", tier: 2 };

  if (/^NEFT/.test(upper) || /^IMPS/.test(upper) || /^RTGS/.test(upper)) {
    const kind = /^NEFT/.test(upper) ? "NEFT" : /^IMPS/.test(upper) ? "IMPS" : "RTGS";
    // A trailing "-<Name>" after the reference-number segment, when present
    // and name-like, is worth keeping (e.g. "NEFT*HDFC0000241234567-ACME
    // CORP" -> "NEFT · Acme Corp").
    const parts = trimmed.split("-").map((p) => p.trim());
    const trailingName = parts.slice(1).find((p) => p && !looksLikeReferenceOrMasked(p) && !IFSC_LIKE_RE.test(p.toUpperCase()));
    return trailingName ? { label: `${kind} · ${titleCase(trailingName)}`, tier: 2 } : { label: `${kind} Transfer`, tier: 2 };
  }

  if (upper.includes("UPI")) {
    const payee = extractUpiPayee(trimmed);
    if (payee) return { label: titleCase(payee), tier: 2 };
  }

  // Tier 3: generic noise-stripped fallback.
  return { label: genericFallback(trimmed), tier: 3 };
}

export function cleanMerchantLabel(raw: string): string {
  return cleanMerchantLabelWithTier(raw).label;
}

/**
 * Same output as `cleanMerchantLabel` for tiers 1-2 (already high
 * confidence, never worth an LLM call). For tier 3 - the noise-stripped
 * fallback that's the actual source of the "UPI/DRs, VKICs, against"-style
 * unreadable names - tries the Gemini-backed cache/LLM upgrade in
 * `merchant-llm-cleanup.ts` first, falling back to the same tier-3 label if
 * that's unavailable or fails. Import pipelines should prefer this over the
 * sync version; it's async only because of that upgrade path.
 */
export async function cleanMerchantLabelSmart(raw: string): Promise<string> {
  const { label, tier } = cleanMerchantLabelWithTier(raw);
  const trimmed = (raw ?? "").trim();
  if (tier !== 3 || !trimmed) return label;

  return cleanMerchantLabelWithLlm(trimmed, label);
}
