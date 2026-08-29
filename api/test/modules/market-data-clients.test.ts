import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchMutualFundNav } from "../../src/modules/market-data/mfapi.client.js";
import { fetchStockPrice } from "../../src/modules/market-data/yahoo.client.js";

// These tests exercise the actual HTTP clients (not mocked at the client-module
// level) with `fetch` itself stubbed, so they genuinely prove withRetry integration:
// a malformed/failed response is retried the expected number of times, and a
// well-formed response is parsed correctly (including the string->number NAV coercion).
// Fake timers keep the retry backoff delays from costing real wall-clock time.

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("mfapi.in client (fetchMutualFundNav)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("parses nav as a NUMBER even though mfapi.in returns it as a string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ nav: "45.5000" }] }))
    );

    const nav = await fetchMutualFundNav("119551");
    expect(nav).toBe(45.5);
    expect(typeof nav).toBe("number");
  });

  it("retries a malformed response shape (missing nav) via withRetry, then throws after exhausting attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{}] }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchMutualFundNav("999999").catch((err) => err as Error);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3); // withRetry's default attempts
  });

  it("retries a network error (fetch rejects) and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ nav: "10.25" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchMutualFundNav("119551");
    await vi.runAllTimersAsync();
    const nav = await promise;

    expect(nav).toBe(10.25);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a non-ok HTTP status and eventually throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchMutualFundNav("119551").catch((err) => err as Error);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("Yahoo Finance client (fetchStockPrice)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("parses chart.result[0].meta.regularMarketPrice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { chart: { result: [{ meta: { regularMarketPrice: 2543.6 } }] } }))
    );

    const price = await fetchStockPrice("TCS");
    expect(price).toBe(2543.6);
  });

  it("retries a malformed response shape (empty result array) via withRetry, then throws after exhausting attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { chart: { result: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchStockPrice("BADSYM").catch((err) => err as Error);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a network error entirely (fetch rejects) and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse(200, { chart: { result: [{ meta: { regularMarketPrice: 100 } }] } }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchStockPrice("TCS");
    await vi.runAllTimersAsync();
    const price = await promise;

    expect(price).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a 404 and eventually throws after exhausting attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchStockPrice("NOSUCHTICKER").catch((err) => err as Error);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
