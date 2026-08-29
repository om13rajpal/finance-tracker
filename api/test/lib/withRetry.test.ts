import { describe, it, expect, vi, afterEach } from "vitest";
import { withRetry } from "../../src/lib/withRetry.js";

describe("withRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after transient failures", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return "ok";
    });

    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting attempts", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always fails");
    });

    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the LAST attempt's actual error, not a generic message, even when earlier errors differ", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockRejectedValueOnce(new Error("third and final failure"));

    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow("third and final failure");
  });

  it("does not retry at all when the first attempt succeeds", async () => {
    const fn = vi.fn(async () => "immediate success");
    const result = await withRetry(fn, { attempts: 5, baseDelayMs: 1 });
    expect(result).toBe("immediate success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("defaults to 3 attempts and a 500ms base delay when no options are passed", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn);

    // First attempt fires immediately, synchronously reachable via a microtask flush.
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Should NOT have retried yet just before the default 500ms boundary.
    await vi.advanceTimersByTimeAsync(499);
    expect(fn).toHaveBeenCalledTimes(1);

    // Crossing 500ms triggers the second attempt (which also fails, per the mock queue).
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);

    // Default backoff doubles: the third attempt waits another 1000ms (500 * 2^1).
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toBe("ok");
  });

  it("genuinely waits BETWEEN retries and DOUBLES the delay each time (exponential backoff), not fire-all-instantly", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 500 });

    // Attempt 1 fires immediately (no delay before the first try).
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Delay before attempt 2 is baseDelayMs (500ms) — not yet at 499ms.
    await vi.advanceTimersByTimeAsync(499);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);

    // Delay before attempt 3 is baseDelayMs * 2 (1000ms), i.e. DOUBLED, not another 500ms.
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toBe("ok");
  });

  it("does not wait after the FINAL failed attempt (no trailing delay before throwing)", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new Error("always fails");
    });

    let rejected = false;
    let rejectionError: unknown;
    const promise = withRetry(fn, { attempts: 2, baseDelayMs: 500 }).catch((err) => {
      rejected = true;
      rejectionError = err;
    });

    // attempt 1 fires, fails, schedules a 500ms wait before attempt 2.
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(2);

    // attempt 2 (the last one) has already failed by now — it should reject
    // immediately with no further timer wait required to observe it.
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(rejected).toBe(true);
    expect((rejectionError as Error).message).toBe("always fails");
  });
});
