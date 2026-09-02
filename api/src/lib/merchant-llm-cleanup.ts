import { env } from "../config/env.js";
import { MerchantCleanupCache } from "../models/MerchantCleanupCache.js";

/**
 * Upgrades tier-3 (generic-fallback) results from `cleanMerchantLabel` using
 * Google's free Gemini 2.5 Flash model, with a persistent cache so a given
 * narration SHAPE only ever gets sent to the LLM once. Never throws: a
 * missing key, a network failure, a timeout, or a nonsense response all fall
 * back to the heuristic label the caller already computed. This is a
 * best-effort readability upgrade, never something a statement import
 * depends on to succeed.
 */

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_LABEL_LENGTH = 60;

const IFSC_LIKE_RE = /^[A-Z]{4}0[A-Z0-9]{5,7}$/;

/**
 * Collapses a raw narration down to its structural "shape": VPA handles and
 * IFSC-shaped bank codes dropped, every digit/masked-card run of length 2+
 * folded to a single `#`, punctuation flattened to spaces. Two transactions
 * from the same merchant differ mainly in their embedded reference numbers
 * and dates, so this normalization is what makes the cache actually hit
 * across transactions rather than storing one entry per transaction.
 */
export function normalizeForCacheKey(raw: string): string {
  const key = raw
    .toUpperCase()
    .replace(/\S+@\S+/g, " ")
    .split(/(\s+)/)
    .filter((tok) => !IFSC_LIKE_RE.test(tok.trim()))
    .join("")
    .replace(/[\dX]{2,}/gi, "#")
    .replace(/[^A-Z#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Nothing but folded reference-number placeholders and punctuation - no
  // actual name-like content survived, so there's nothing worth an LLM call.
  return /[A-Z]/.test(key) ? key : "";
}

async function callGemini(raw: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY as string,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                "You clean up raw Indian bank statement narration lines into a short, human-readable merchant or payee name. " +
                "Reply with ONLY the name, nothing else - no punctuation wrapper, no explanation. " +
                "If you genuinely cannot identify who the money went to or came from, reply with exactly: UNKNOWN.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: raw.slice(0, 300) }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 20 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!content || content.length > MAX_LABEL_LENGTH) return null;
    if (/^UNKNOWN$/i.test(content)) return null;
    return content.replace(/^["']|["']$/g, "").trim() || null;
  } catch {
    // Network error, timeout/abort, or malformed JSON - all treated the same:
    // this call didn't help, the caller already has a safe fallback label.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function cleanMerchantLabelWithLlm(raw: string, fallbackLabel: string): Promise<string> {
  if (!env.GEMINI_API_KEY) return fallbackLabel;

  const rawKey = normalizeForCacheKey(raw);
  if (!rawKey) return fallbackLabel;

  const cached = await MerchantCleanupCache.findOne({ rawKey }).lean();
  if (cached) return cached.cleanName;

  const llmName = await callGemini(raw);
  if (!llmName) return fallbackLabel;

  // Concurrent chunk-processing rows can race to cache the same shape - an
  // atomic upsert makes that safe without a duplicate-key error either way.
  await MerchantCleanupCache.findOneAndUpdate(
    { rawKey },
    { $setOnInsert: { rawKey, cleanName: llmName, createdAt: new Date() } },
    { upsert: true }
  );

  return llmName;
}
