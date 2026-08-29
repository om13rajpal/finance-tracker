import { Router } from "express";
import { env } from "../../config/env.js";
import { makeQueue } from "../../jobs/queue.js";

export const gmailWebhookRouter = Router();

export const gmailEmailParseQueue = makeQueue<{ userId: string; historyId: string }>(
  "gmail-email-parse"
);

/**
 * Pub/Sub push receiver for Gmail's `users.watch()` notifications.
 *
 * NOT behind `requireAuth` — Pub/Sub calls this directly, with no Finance
 * Tracker session. Instead it's verified with a shared-secret query param
 * (`GMAIL_WEBHOOK_SECRET`, configured as part of the Pub/Sub push
 * subscription's endpoint URL). A plain `!==` comparison is used rather than
 * a constant-time compare — this app has a single user and the secret isn't
 * guessable from timing differences on a personal deployment, so the added
 * complexity isn't worth it here. What matters is that it's a full-value
 * equality check, not `startsWith`/`includes`, so a partially-correct guess
 * is never treated as valid.
 *
 * Does the ABSOLUTE MINIMUM before responding: validate the secret, extract
 * the notification's payload, enqueue a job, and return 204. No Gmail API
 * call and no parsing happens here — Pub/Sub retries (with backoff, then
 * eventually gives up) if this endpoint is slow or errors, so keeping this
 * handler fast and simple is the whole point of doing the real work in
 * `processGmailNotification` via a queued job instead.
 */
gmailWebhookRouter.post("/", async (req, res, next) => {
  try {
    if (req.query.token !== env.GMAIL_WEBHOOK_SECRET) {
      res.status(403).json({ error: "Invalid webhook token" });
      return;
    }

    const dataB64 = req.body?.message?.data as string | undefined;
    const decoded = dataB64
      ? (JSON.parse(Buffer.from(dataB64, "base64").toString("utf8")) as { historyId: string })
      : { historyId: undefined };

    // Same `state` convention as the OAuth callback in gmail.routes.ts: the
    // Pub/Sub push subscription is configured (out of band, via its endpoint
    // URL or push config) to echo the userId back as `state` on each
    // notification it forwards, since Gmail's own notification payload only
    // carries `emailAddress`/`historyId`, not this app's userId.
    const userId = req.body?.state as string | undefined;

    if (!userId || !decoded.historyId) {
      res.status(400).json({ error: "Malformed Pub/Sub notification" });
      return;
    }

    await gmailEmailParseQueue.add("parse", { userId, historyId: decoded.historyId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
