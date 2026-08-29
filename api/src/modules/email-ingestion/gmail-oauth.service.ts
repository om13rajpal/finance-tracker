import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { decrypt } from "../../lib/encryption.js";
import { GmailConnection } from "../../models/GmailConnection.js";

function buildOAuthClient() {
  return new google.auth.OAuth2(env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET, env.GMAIL_REDIRECT_URI);
}

const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_STATE_PURPOSE = "gmail_oauth";

/**
 * Mints the `state` value carried through Google's OAuth redirect.
 *
 * This is a short-lived signed token rather than a bare userId because
 * `GET /gmail/oauth/callback` cannot sit behind `requireAuth` — Google redirects the
 * browser to it directly, with no session — so the userId the callback acts on comes
 * ENTIRELY from this parameter. Unsigned, anyone who could guess or observe a userId
 * could drive the callback and attach their own Gmail account (and therefore their own
 * parsed transactions) to that user's data, or upsert a `GmailConnection` for an
 * arbitrary id.
 *
 * `purpose` is part of the payload deliberately: session JWTs are signed with this same
 * `JWT_SECRET` and also carry a `userId`, so without it a stolen (or simply
 * self-obtained) session cookie would be a valid `state`. The short expiry bounds how
 * long a leaked authorize URL stays replayable — a connect flow completes in seconds.
 */
export function signOAuthState(userId: string): string {
  return jwt.sign({ userId, purpose: OAUTH_STATE_PURPOSE }, env.JWT_SECRET, {
    expiresIn: OAUTH_STATE_TTL_SECONDS,
  });
}

/**
 * Returns the userId carried by a `state` this API itself minted, or `null` for
 * anything else — unsigned, forged, expired, wrong-purpose, or missing. Callers must
 * treat `null` as "reject the request", never as "fall back to the raw value".
 */
export function verifyOAuthState(state: string | undefined): string | null {
  if (!state) return null;
  try {
    const payload = jwt.verify(state, env.JWT_SECRET) as { userId?: unknown; purpose?: unknown };
    if (payload.purpose !== OAUTH_STATE_PURPOSE) return null;
    if (typeof payload.userId !== "string" || payload.userId.length === 0) return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export function getAuthUrl(userId: string): string {
  const client = buildOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
    state: signOAuthState(userId),
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{ refreshToken: string }> {
  const client = buildOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token — re-consent may be required");
  }
  return { refreshToken: tokens.refresh_token };
}

export async function getOAuthClientForUser(userId: string) {
  const connection = await GmailConnection.findOne({ userId, status: "connected" });
  if (!connection?.refreshTokenEncrypted) {
    throw new Error("No connected Gmail account for this user");
  }

  const client = buildOAuthClient();
  client.setCredentials({ refresh_token: decrypt(connection.refreshTokenEncrypted) });
  return client;
}
