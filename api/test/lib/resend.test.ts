import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

describe("sendEmail", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("resolves when Resend reports success", async () => {
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });
    const { sendEmail } = await import("../../src/lib/resend.js");

    await expect(
      sendEmail({ to: "user@example.com", subject: "Hi", text: "Body" })
    ).resolves.toBeUndefined();
  });

  // This is the exact bug found via a real end-to-end test against the live deployment:
  // the Resend SDK resolves normally with an `error` field on API-level failure, it does
  // not reject the promise. A version of sendEmail that only awaits the call and ignores
  // the return value would incorrectly resolve here too — this test fails against that
  // version and passes only once the return value is actually checked.
  it("throws when Resend reports an error, even though the promise resolves", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid `from` field" },
    });
    const { sendEmail } = await import("../../src/lib/resend.js");

    await expect(
      sendEmail({ to: "user@example.com", subject: "Hi", text: "Body" })
    ).rejects.toThrow(/Resend send failed.*validation_error.*Invalid `from` field/);
  });

  it("retries on failure and eventually throws the last real error after exhausting attempts", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Too many requests" },
    });
    const { sendEmail } = await import("../../src/lib/resend.js");

    await expect(
      sendEmail({ to: "user@example.com", subject: "Hi", text: "Body" })
    ).rejects.toThrow(/rate_limit_exceeded/);
    // withRetry's default is 3 attempts.
    expect(sendMock).toHaveBeenCalledTimes(3);
  });
});
