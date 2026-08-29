import { google, gmail_v1 } from "googleapis";
import type { Job, Worker } from "bullmq";
import { getOAuthClientForUser } from "../../modules/email-ingestion/gmail-oauth.service.js";
import { EmailSource } from "../../models/EmailSource.js";
import { EmailImportLog } from "../../models/EmailImportLog.js";
import { PendingTransaction } from "../../models/PendingTransaction.js";
import { GmailConnection } from "../../models/GmailConnection.js";
import { PARSER_REGISTRY } from "../../modules/email-ingestion/parsers/registry.js";
import { isTokenRevokedError } from "../../modules/email-ingestion/token-errors.js";
import { makeWorker } from "../queue.js";

type GmailNotificationJob = { userId: string; historyId: string };

function decodeBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  const data = payload?.body?.data ?? payload?.parts?.[0]?.body?.data ?? "";
  return Buffer.from(data, "base64").toString("utf8");
}

function getHeader(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string {
  return payload?.headers?.find((h) => h.name === name)?.value ?? "";
}

/**
 * Extracts the bare, lowercased email address a "From" header refers to,
 * e.g. `"HDFC Bank <alerts@hdfcbank.net>"` -> `"alerts@hdfcbank.net"`.
 *
 * This exists so sender matching (below) can do an exact-equality compare
 * against `EmailSource.senderPattern` instead of a substring check. A
 * substring check on the raw header (`from.includes(senderPattern)`) would
 * treat `alerts@hdfcbank.net.evil.com` as a match for the pattern
 * `alerts@hdfcbank.net` — this is financial-data ingestion, so a lookalike
 * sender must never be treated as trusted. Always trusting the address
 * inside `<...>` (rather than the free-text display name before it) also
 * defeats a spoofed display name like `"alerts@hdfcbank.net" <attacker@evil.com>`.
 */
function extractSenderAddress(fromHeader: string): string {
  const angleMatch = fromHeader.match(/<([^>]+)>/);
  const address = angleMatch ? angleMatch[1] : fromHeader;
  return address.trim().toLowerCase();
}

function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number } | undefined)?.code === 11000;
}

type ImportLogDraft = {
  userId: string;
  emailId: string;
  sourceId?: string | null;
  parseStatus: "success" | "failed" | "unmatched";
};

/**
 * Attempts to create the `EmailImportLog` row that "claims" this `emailId`.
 *
 * This — not the `findOne` pre-check in the loop below — is the actual
 * dedup guarantee. `EmailImportLog.emailId` has a unique index, so if the
 * same Pub/Sub notification is redelivered while an earlier job for it is
 * still in flight (i.e. it already passed the pre-check but hasn't written
 * its log row yet), both jobs can race past that pre-check — but only ONE of
 * them can win this `create()` call. The other gets a MongoDB duplicate-key
 * error (code 11000), which is caught here and treated as "already being
 * processed by another job," not a real error. Only the winner goes on to
 * create the `PendingTransaction` for a `success` result, so a redelivered
 * notification can never produce two `PendingTransaction`s for the same
 * email. This is deliberately not "just trust BullMQ concurrency" — a
 * duplicate delivery can still land on two different job attempts (retries,
 * multiple worker processes) even at concurrency 1.
 */
async function tryReserveImportLog(doc: ImportLogDraft): Promise<boolean> {
  try {
    await EmailImportLog.create(doc);
    return true;
  } catch (err) {
    if (isDuplicateKeyError(err)) return false;
    throw err;
  }
}

/**
 * Processes one Gmail push-notification job: lists the mailbox history since
 * the last known `historyId`, matches each new message's sender against this
 * user's `EmailSource`s, runs the matching parser, and — on a successful
 * parse — creates a `PendingTransaction` (never a confirmed `Transaction`;
 * per spec nothing from email lands as real data until reviewed/confirmed).
 * Every message produces exactly one `EmailImportLog` row recording the
 * outcome (`success`/`failed`/`unmatched`), which is what makes reprocessing
 * a redelivered notification a no-op instead of a duplicate.
 */
export async function processGmailNotification({
  userId,
  historyId,
}: GmailNotificationJob): Promise<void> {
  const connection = await GmailConnection.findOne({ userId });
  if (!connection || connection.status === "disconnected") return;

  const auth = await getOAuthClientForUser(userId);
  const gmail = google.gmail({ version: "v1", auth });

  let history;
  try {
    history = await gmail.users.history.list({
      userId: "me",
      startHistoryId: connection.historyId ?? historyId,
    });
  } catch (err) {
    if (isTokenRevokedError(err)) {
      // Same reasoning as Task 21's registerWatch: a revoked token means every
      // future job for this user will fail the same way, so mark it
      // disconnected once and stop instead of retrying forever.
      await GmailConnection.findOneAndUpdate(
        { userId },
        { status: "disconnected", refreshTokenEncrypted: null }
      );
      return;
    }
    throw err;
  }

  const messageIds = (history.data.history ?? [])
    .flatMap((h) => h.messagesAdded ?? [])
    .map((m) => m.message?.id)
    .filter((id): id is string => Boolean(id));

  const sources = await EmailSource.find({ userId });

  for (const emailId of messageIds) {
    // Fast path only — skips a wasted Gmail API call for an email we already
    // know we've processed. NOT the dedup guarantee itself; see
    // `tryReserveImportLog` for why that matters under concurrent delivery.
    const alreadyLogged = await EmailImportLog.findOne({ emailId });
    if (alreadyLogged) continue;

    let messageRes;
    try {
      messageRes = await gmail.users.messages.get({ userId: "me", id: emailId });
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

    const payload = messageRes.data.payload;
    const from = getHeader(payload, "From");
    const subject = getHeader(payload, "Subject");
    const body = decodeBody(payload);
    const senderAddress = extractSenderAddress(from);

    const source = sources.find(
      (s) => senderAddress === String(s.senderPattern).trim().toLowerCase()
    );
    if (!source) {
      await tryReserveImportLog({ userId, emailId, parseStatus: "unmatched" });
      continue;
    }

    const parser = PARSER_REGISTRY[source.parserKey];
    const parsed = parser ? parser(body, subject) : null;

    if (!parsed) {
      await tryReserveImportLog({
        userId,
        emailId,
        sourceId: source._id.toString(),
        parseStatus: "failed",
      });
      continue;
    }

    const reserved = await tryReserveImportLog({
      userId,
      emailId,
      sourceId: source._id.toString(),
      parseStatus: "success",
    });
    if (!reserved) continue; // lost the race to a concurrent job processing the same redelivered notification

    const pending = await PendingTransaction.create({
      userId,
      accountId: null,
      categoryId: null,
      amount: parsed.amount,
      date: new Date(parsed.date),
      note: parsed.note,
      merchant: parsed.merchant,
      source: "email_parsed",
    });

    await EmailImportLog.findOneAndUpdate(
      { emailId },
      { resultingPendingTransactionId: pending._id.toString() }
    );
  }

  await GmailConnection.findOneAndUpdate(
    { userId },
    { historyId: history.data.historyId ?? historyId }
  );
}

/**
 * Constructs the BullMQ Worker that processes queued notification jobs.
 * Deliberately NOT instantiated at module load time (same reasoning as
 * `startRecurringDueWorker`/`startGmailWatchRenewalWorker`) — a top-level
 * `export const gmailEmailParseWorker = makeWorker(...)` would open a real
 * Redis-backed listener as a side effect of simply importing this module,
 * including from this task's own test file, which only needs
 * `processGmailNotification` directly. Call this explicitly from wherever
 * the app wires up its background workers.
 */
export function startGmailEmailParseWorker(): Worker<GmailNotificationJob> {
  return makeWorker<GmailNotificationJob>(
    "gmail-email-parse",
    async (job: Job<GmailNotificationJob>) => processGmailNotification(job.data)
  );
}
