import { google } from "googleapis";
import { env } from "../../config/env.js";
import { getOAuthClientForUser } from "./gmail-oauth.service.js";
import { GmailConnection } from "../../models/GmailConnection.js";
import { isTokenRevokedError } from "./token-errors.js";

/**
 * Registers (or renews) a Gmail push-notification watch for the given user's
 * connected mailbox, and persists the resulting `historyId`/`watchExpiration`
 * onto their existing `GmailConnection` document (matched by `userId`, so a
 * renewal updates the same document rather than creating a duplicate).
 *
 * If the stored refresh token has been revoked, the connection is marked
 * `disconnected` (per spec: "if Google reports the token revoked/invalid,
 * GmailConnection is marked disconnected... rather than failing silently on
 * every subsequent job run") instead of throwing; any other error is
 * rethrown so the caller (e.g. the renewal worker) can decide how to handle
 * an unexpected failure.
 */
export async function registerWatch(userId: string): Promise<void> {
  const auth = await getOAuthClientForUser(userId);
  const gmail = google.gmail({ version: "v1", auth });

  try {
    const response = await gmail.users.watch({
      userId: "me",
      requestBody: { topicName: env.GMAIL_PUBSUB_TOPIC, labelIds: ["INBOX"] },
    });

    // Gmail returns `expiration` as an epoch-ms value serialized as a STRING.
    // `Number(...)` before constructing the Date so downstream comparisons
    // (e.g. the renewal worker's `$lte` query) operate on a real timestamp,
    // not a string that would silently break Date semantics.
    await GmailConnection.findOneAndUpdate(
      { userId },
      {
        historyId: response.data.historyId,
        watchExpiration: new Date(Number(response.data.expiration)),
      }
    );
  } catch (err) {
    if (isTokenRevokedError(err)) {
      await GmailConnection.findOneAndUpdate(
        { userId },
        { status: "disconnected", refreshTokenEncrypted: null }
      );
      return;
    }
    throw err;
  }
}
