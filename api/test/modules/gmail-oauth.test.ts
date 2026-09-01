import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { GmailConnection } from "../../src/models/GmailConnection.js";
import { signOAuthState } from "../../src/modules/email-ingestion/gmail-oauth.service.js";

// vi.mock factories are hoisted above ordinary top-level declarations, and
// app.js (imported below) pulls in gmail-oauth.service.js - which imports
// googleapis - as a side effect of module loading, before a plain `const`
// here would have run. vi.hoisted() guarantees watchMock exists by the time
// the factory below executes.
const { watchMock } = vi.hoisted(() => ({
  watchMock: vi.fn().mockResolvedValue({
    data: { historyId: "mock-history-id", expiration: String(Date.now() + 6 * 24 * 60 * 60 * 1000) },
  }),
}));

vi.mock("googleapis", () => {
  const OAuth2 = vi.fn().mockImplementation(() => ({
    generateAuthUrl: vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?mock=1"),
    getToken: vi.fn().mockResolvedValue({ tokens: { refresh_token: "mock-refresh-token" } }),
    setCredentials: vi.fn(),
  }));
  return { google: { auth: { OAuth2 }, gmail: vi.fn().mockReturnValue({ users: { watch: watchMock } }) } };
});

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("gmail oauth flow", () => {
  beforeEach(() => {
    watchMock.mockClear();
    watchMock.mockResolvedValue({
      data: { historyId: "mock-history-id", expiration: String(Date.now() + 6 * 24 * 60 * 60 * 1000) },
    });
  });

  it("requires authentication to initiate connect", async () => {
    const res = await request(app).get("/gmail/connect");
    expect(res.status).toBe(401);
  });

  it("redirects to Google's auth URL on connect", async () => {
    const res = await request(app).get("/gmail/connect").set("Cookie", authCookie());
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/accounts\.google\.com/);
  });

  it("stores an encrypted refresh token and marks the connection connected on callback", async () => {
    const res = await request(app)
      .get("/gmail/oauth/callback?code=mock-code&state=" + encodeURIComponent(signOAuthState("user-1")) + "")
      .set("Cookie", authCookie());

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/settings?gmail=connected");

    const connection = await GmailConnection.findOne({ userId: "user-1" });
    expect(connection?.status).toBe("connected");
    expect(connection?.refreshTokenEncrypted).not.toBe("mock-refresh-token");
    expect(connection?.refreshTokenEncrypted).not.toBeNull();
    // The raw token must never appear anywhere in the stored ciphertext.
    expect(connection?.refreshTokenEncrypted).not.toContain("mock-refresh-token");
  });

  // Regression: the callback used to save the token and mark the connection
  // "connected" without ever registering the actual Gmail push-notification
  // watch, so nothing Google-side was ever watching the inbox and no email
  // ever triggered ingestion, even though /gmail/status reported connected.
  it("registers a Gmail watch immediately as part of a successful callback, not just on the next renewal run", async () => {
    await request(app)
      .get("/gmail/oauth/callback?code=mock-code&state=" + encodeURIComponent(signOAuthState("watch-user")) + "")
      .set("Cookie", authCookie("watch-user"));

    expect(watchMock).toHaveBeenCalledTimes(1);
    const connection = await GmailConnection.findOne({ userId: "watch-user" });
    expect(connection?.historyId).toBe("mock-history-id");
    expect(connection?.watchExpiration).toBeInstanceOf(Date);
  });

  it("still saves the token and redirects to connected even if watch registration fails", async () => {
    watchMock.mockRejectedValueOnce(new Error("Pub/Sub topic misconfigured"));

    const res = await request(app)
      .get("/gmail/oauth/callback?code=mock-code&state=" + encodeURIComponent(signOAuthState("watch-fail-user")) + "")
      .set("Cookie", authCookie("watch-fail-user"));

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/settings?gmail=connected");
    const connection = await GmailConnection.findOne({ userId: "watch-fail-user" });
    expect(connection?.status).toBe("connected");
    expect(connection?.refreshTokenEncrypted).not.toBeNull();
  });

  it("never returns the raw refresh token in the callback response body", async () => {
    const res = await request(app)
      .get("/gmail/oauth/callback?code=mock-code&state=" + encodeURIComponent(signOAuthState("user-1")) + "")
      .set("Cookie", authCookie());

    expect(JSON.stringify(res.body ?? {})).not.toContain("mock-refresh-token");
    expect(res.text ?? "").not.toContain("mock-refresh-token");
  });

  it("disconnects and clears the stored token", async () => {
    await request(app).get("/gmail/oauth/callback?code=mock-code&state=" + encodeURIComponent(signOAuthState("user-1")) + "").set("Cookie", authCookie());

    const res = await request(app).delete("/gmail/disconnect").set("Cookie", authCookie());
    expect(res.status).toBe(200);

    const connection = await GmailConnection.findOne({ userId: "user-1" });
    expect(connection?.status).toBe("disconnected");
    expect(connection?.refreshTokenEncrypted).toBeNull();
  });

  // /gmail/oauth/callback cannot sit behind requireAuth (Google redirects the browser
  // to it directly), so the userId it acts on comes entirely from the `state` query
  // param. These pin that `state` must be a value this API itself minted — an
  // attacker-supplied one must never be able to attach THEIR Gmail account to this
  // user's data, or create a connection document for an arbitrary userId.
  // Google redirects the browser straight to this callback from accounts.google.com,
  // so it must resolve WITHOUT any session cookie. Reaching the gmail router's own
  // 400 (rather than a 401 from an earlier, root-mounted authenticated router) is what
  // proves that — see the mount-order comment in app.ts.
  it("is reachable with no session cookie at all — the callback is not behind requireAuth", async () => {
    const res = await request(app).get("/gmail/oauth/callback?code=mock-code&state=whatever");
    expect(res.status).not.toBe(401);
  });

  it("rejects a callback whose state is a bare, unsigned userId", async () => {
    const res = await request(app).get("/gmail/oauth/callback?code=mock-code&state=victim-user");

    expect(res.status).toBe(400);
    expect(await GmailConnection.findOne({ userId: "victim-user" })).toBeNull();
  });

  it("rejects a callback with no state at all instead of upserting a userId-less connection", async () => {
    const before = await GmailConnection.countDocuments({});
    const res = await request(app).get("/gmail/oauth/callback?code=mock-code");

    expect(res.status).toBe(400);
    expect(await GmailConnection.countDocuments({})).toBe(before);
  });

  it("rejects a session JWT replayed as state — the signed state is purpose-scoped, not any token signed with the same secret", async () => {
    const sessionToken = jwt.sign({ userId: "replay-user" }, process.env.JWT_SECRET as string);
    const res = await request(app).get(`/gmail/oauth/callback?code=mock-code&state=${sessionToken}`);

    expect(res.status).toBe(400);
    expect(await GmailConnection.findOne({ userId: "replay-user" })).toBeNull();
  });

  it("rejects a state signed with the wrong secret", async () => {
    const forged = jwt.sign({ userId: "forged-user", purpose: "gmail_oauth" }, "not-the-real-secret");
    const res = await request(app).get(`/gmail/oauth/callback?code=mock-code&state=${forged}`);

    expect(res.status).toBe(400);
    expect(await GmailConnection.findOne({ userId: "forged-user" })).toBeNull();
  });

  it("requires authentication to disconnect", async () => {
    const res = await request(app).delete("/gmail/disconnect");
    expect(res.status).toBe(401);
  });

  it("disconnecting when no connection ever existed does not error", async () => {
    const res = await request(app).delete("/gmail/disconnect").set("Cookie", authCookie("brand-new-user"));
    expect(res.status).toBe(200);
  });

  it("reconnecting after a disconnect updates the same document rather than creating a duplicate", async () => {
    await request(app).get("/gmail/oauth/callback?code=mock-code&state=" + encodeURIComponent(signOAuthState("user-2")) + "").set("Cookie", authCookie("user-2"));
    await request(app).delete("/gmail/disconnect").set("Cookie", authCookie("user-2"));
    await request(app).get("/gmail/oauth/callback?code=mock-code&state=" + encodeURIComponent(signOAuthState("user-2")) + "").set("Cookie", authCookie("user-2"));

    const connections = await GmailConnection.find({ userId: "user-2" });
    expect(connections).toHaveLength(1);
    expect(connections[0].status).toBe("connected");
    expect(connections[0].refreshTokenEncrypted).not.toBeNull();
  });
});

describe("gmail connection status", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/gmail/status");
    expect(res.status).toBe(401);
  });

  it("reports not connected when no connection document exists for the user", async () => {
    const res = await request(app).get("/gmail/status").set("Cookie", authCookie("brand-new-status-user"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it("reports connected after completing the oauth callback", async () => {
    await request(app)
      .get("/gmail/oauth/callback?code=mock-code&state=" + encodeURIComponent(signOAuthState("status-user")) + "")
      .set("Cookie", authCookie("status-user"));

    const res = await request(app).get("/gmail/status").set("Cookie", authCookie("status-user"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true });
  });

  it("reports not connected after disconnecting", async () => {
    await request(app)
      .get("/gmail/oauth/callback?code=mock-code&state=" + encodeURIComponent(signOAuthState("status-user-2")) + "")
      .set("Cookie", authCookie("status-user-2"));
    await request(app).delete("/gmail/disconnect").set("Cookie", authCookie("status-user-2"));

    const res = await request(app).get("/gmail/status").set("Cookie", authCookie("status-user-2"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });
});
