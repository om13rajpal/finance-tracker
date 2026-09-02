import { describe, it, expect, vi, beforeEach } from "vitest";
import { GmailConnection } from "../../src/models/GmailConnection.js";
import { encrypt } from "../../src/lib/encryption.js";

const watchMock = vi.fn().mockResolvedValue({
  data: { historyId: "12345", expiration: String(Date.now() + 6 * 24 * 60 * 60 * 1000) },
});

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn() })) },
    gmail: vi.fn().mockReturnValue({ users: { watch: watchMock } }),
  },
}));

describe("gmail watch service", () => {
  beforeEach(() => {
    watchMock.mockClear();
    watchMock.mockResolvedValue({
      data: { historyId: "12345", expiration: String(Date.now() + 6 * 24 * 60 * 60 * 1000) },
    });
  });

  it("registers a watch and stores historyId + expiration", async () => {
    await GmailConnection.create({
      userId: "user-1",
      refreshTokenEncrypted: encrypt("mock-refresh-token"),
      status: "connected",
    });

    const { registerWatch } = await import("../../src/modules/email-ingestion/gmail-watch.service.js");
    await registerWatch("user-1");

    expect(watchMock).toHaveBeenCalledTimes(1);
    const connection = await GmailConnection.findOne({ userId: "user-1" });
    expect(connection?.historyId).toBe("12345");
    expect(connection?.watchExpiration).toBeInstanceOf(Date);
    // The Gmail API returns `expiration` as an epoch-ms string. Verify it was parsed
    // into an actual numeric timestamp (not left as a string, and not NaN/Invalid Date).
    expect(connection!.watchExpiration!.getTime()).toBeCloseTo(Date.now() + 6 * 24 * 60 * 60 * 1000, -3);
  });

  it("registerWatch called again for the same user updates the existing document, not a duplicate", async () => {
    await GmailConnection.create({
      userId: "user-1",
      refreshTokenEncrypted: encrypt("mock-refresh-token"),
      status: "connected",
    });

    const { registerWatch } = await import("../../src/modules/email-ingestion/gmail-watch.service.js");
    await registerWatch("user-1");
    watchMock.mockResolvedValueOnce({
      data: { historyId: "99999", expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    await registerWatch("user-1");

    const connections = await GmailConnection.find({ userId: "user-1" });
    expect(connections).toHaveLength(1);
    expect(connections[0]?.historyId).toBe("99999");
  });

  it("renewal worker only re-registers watches expiring within 24 hours", async () => {
    await GmailConnection.create({
      userId: "user-expiring-soon",
      refreshTokenEncrypted: encrypt("token-a"),
      status: "connected",
      watchExpiration: new Date(Date.now() + 12 * 60 * 60 * 1000),
    });
    await GmailConnection.create({
      userId: "user-expiring-later",
      refreshTokenEncrypted: encrypt("token-b"),
      status: "connected",
      watchExpiration: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });

    const { renewExpiringWatches } = await import("../../src/jobs/workers/gmailWatchRenewal.worker.js");
    await renewExpiringWatches();

    expect(watchMock).toHaveBeenCalledTimes(1);
  });

  // Regression: `$lte` alone against a null watchExpiration does not match in
  // this query, so a connection whose watch was never registered (e.g. the
  // OAuth callback's own registration attempt failed) sat forever without a
  // working watch: the one job meant to rescue it silently skipped it.
  it("also re-registers a connection whose watch was never registered at all (watchExpiration still null)", async () => {
    await GmailConnection.create({
      userId: "user-never-registered",
      refreshTokenEncrypted: encrypt("token-c"),
      status: "connected",
      // watchExpiration intentionally omitted - defaults to null per the schema.
    });

    const { renewExpiringWatches } = await import("../../src/jobs/workers/gmailWatchRenewal.worker.js");
    await renewExpiringWatches();

    expect(watchMock).toHaveBeenCalledTimes(1);
    const connection = await GmailConnection.findOne({ userId: "user-never-registered" });
    expect(connection?.watchExpiration).toBeInstanceOf(Date);
  });

  it("does not renew a disconnected connection even if its stored watchExpiration looks expired", async () => {
    await GmailConnection.create({
      userId: "user-disconnected",
      refreshTokenEncrypted: null,
      status: "disconnected",
      watchExpiration: new Date(Date.now() - 60 * 60 * 1000),
    });

    const { renewExpiringWatches } = await import("../../src/jobs/workers/gmailWatchRenewal.worker.js");
    await renewExpiringWatches();

    expect(watchMock).not.toHaveBeenCalled();
  });

  it("one connection's registerWatch failure does not stop other connections from being renewed", async () => {
    await GmailConnection.create({
      userId: "user-fails",
      refreshTokenEncrypted: encrypt("token-fail"),
      status: "connected",
      watchExpiration: new Date(Date.now() + 1 * 60 * 60 * 1000),
    });
    await GmailConnection.create({
      userId: "user-succeeds",
      refreshTokenEncrypted: encrypt("token-ok"),
      status: "connected",
      watchExpiration: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    // Neither call is a recognized "token revoked" error, so registerWatch will
    // rethrow for the first user - the renewal loop must catch that and continue.
    watchMock.mockRejectedValueOnce(new Error("network blip"));
    watchMock.mockResolvedValueOnce({
      data: { historyId: "55555", expiration: String(Date.now() + 6 * 24 * 60 * 60 * 1000) },
    });

    const { renewExpiringWatches } = await import("../../src/jobs/workers/gmailWatchRenewal.worker.js");
    // Both connections are attempted even though one rejects - a per-connection
    // failure must not abort the batch or reject the overall call.
    await expect(renewExpiringWatches()).resolves.toBeUndefined();

    // Both were attempted (order of iteration over the two documents isn't
    // guaranteed, so assert on the outcome rather than which named user "won").
    expect(watchMock).toHaveBeenCalledTimes(2);
    const succeeded = await GmailConnection.findOne({ historyId: "55555" });
    expect(succeeded).not.toBeNull();
  });

  it("marks the connection disconnected when the refresh token has been revoked", async () => {
    await GmailConnection.create({
      userId: "user-revoked",
      refreshTokenEncrypted: encrypt("revoked-token"),
      status: "connected",
    });

    watchMock.mockRejectedValueOnce({ code: 401, message: "invalid_grant" });

    const { registerWatch } = await import("../../src/modules/email-ingestion/gmail-watch.service.js");
    await registerWatch("user-revoked");

    const connection = await GmailConnection.findOne({ userId: "user-revoked" });
    expect(connection?.status).toBe("disconnected");
    expect(connection?.refreshTokenEncrypted).toBeNull();
  });
});
