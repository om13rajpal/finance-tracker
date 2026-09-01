import { describe, it, expect, vi, afterEach } from "vitest";

// env is a module-level singleton parsed once from process.env at import
// time (see config/env.ts), so the only reliable way to test both the
// "key configured" and "key missing" branches is to mock the module itself
// rather than mutate process.env, which env.ts has already read by now.
vi.mock("../../src/config/env.js", () => ({ env: { GEMINI_API_KEY: "test-gemini-key" } }));

import { MerchantCleanupCache } from "../../src/models/MerchantCleanupCache.js";
import { normalizeForCacheKey, cleanMerchantLabelWithLlm } from "../../src/lib/merchant-llm-cleanup.js";

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function geminiReply(text: string) {
  return jsonResponse(200, { candidates: [{ content: { parts: [{ text }] } }] });
}

describe("normalizeForCacheKey", () => {
  it("folds embedded reference numbers so two transactions from the same merchant produce the same key", () => {
    const a = normalizeForCacheKey("P0000011-653601178007-XYZSHOP UPI-XXXXXXX7543-SBIN0000652");
    const b = normalizeForCacheKey("P0000099-112233445566-XYZSHOP UPI-XXXXXXX9981-SBIN0000652");
    expect(a).toBe(b);
  });

  it("produces different keys for structurally different narration", () => {
    const a = normalizeForCacheKey("UPI/DR/103523751353/XYZSHOP/HDFC/xyz.bd/Execu 0097691162095");
    const b = normalizeForCacheKey("NEFT*HDFC0000241234567890-ACME EXPORTS PVT LTD");
    expect(a).not.toBe(b);
  });

  it("drops VPA handles", () => {
    expect(normalizeForCacheKey("UPI-JANE DOE-JANEDOE99887@OKSBI-SBIN0001234-UPI")).not.toContain("@");
  });
});

describe("cleanMerchantLabelWithLlm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the fallback label without calling fetch when the raw text normalizes to nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await cleanMerchantLabelWithLlm("12345 67890", "Fallback Label");

    expect(result).toBe("Fallback Label");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the Gemini API and returns its cleaned name on a cache miss", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiReply("Acme Traders"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await cleanMerchantLabelWithLlm("XYZ SPECIALTY RANDOM SHOP TEXT", "Xyz Specialty Random Shop Text");

    expect(result).toBe("Acme Traders");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("gemini-2.5-flash:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("test-gemini-key");
  });

  it("caches the LLM result so a second call with the same narration shape never hits fetch again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiReply("Acme Traders"));
    vi.stubGlobal("fetch", fetchMock);

    await cleanMerchantLabelWithLlm("P0000011-653601178007-ACME UPI-XXXXXXX7543-SBIN0000652", "fallback-a");
    const second = await cleanMerchantLabelWithLlm("P0000099-112233445566-ACME UPI-XXXXXXX9981-SBIN0000652", "fallback-b");

    expect(second).toBe("Acme Traders");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the heuristic label when the API returns UNKNOWN", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(geminiReply("UNKNOWN")));

    const result = await cleanMerchantLabelWithLlm("SOME TOTALLY OPAQUE NARRATION LINE", "Some Totally Opaque Narration Line");

    expect(result).toBe("Some Totally Opaque Narration Line");
  });

  it("falls back to the heuristic label on a non-OK HTTP response, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));

    await expect(cleanMerchantLabelWithLlm("BREAKS THE API TODAY", "Breaks The Api Today")).resolves.toBe(
      "Breaks The Api Today"
    );
  });

  it("falls back to the heuristic label when fetch itself rejects (network error), without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(cleanMerchantLabelWithLlm("NETWORK IS DOWN RIGHT NOW", "Network Is Down Right Now")).resolves.toBe(
      "Network Is Down Right Now"
    );
  });

  it("falls back to the heuristic label when the response body is malformed JSON-shape (no candidates)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true })));

    await expect(cleanMerchantLabelWithLlm("MALFORMED RESPONSE CASE", "Malformed Response Case")).resolves.toBe(
      "Malformed Response Case"
    );
  });

  it("does not persist a cache entry when the LLM call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await cleanMerchantLabelWithLlm("A ROW THAT NEVER GETS CACHED HERE", "fallback");

    expect(await MerchantCleanupCache.countDocuments({})).toBe(0);
  });
});
