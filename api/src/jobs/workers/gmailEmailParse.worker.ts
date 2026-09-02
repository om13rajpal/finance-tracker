import { google, gmail_v1 } from "googleapis";
import type { Job, Worker } from "bullmq";
import crypto from "node:crypto";
import { getOAuthClientForUser } from "../../modules/email-ingestion/gmail-oauth.service.js";
import { EmailSource } from "../../models/EmailSource.js";
import { EmailImportLog } from "../../models/EmailImportLog.js";
import { PendingTransaction } from "../../models/PendingTransaction.js";
import { GmailConnection } from "../../models/GmailConnection.js";
import { ImportBatch } from "../../models/ImportBatch.js";
import { PARSER_REGISTRY } from "../../modules/email-ingestion/parsers/registry.js";
import { isTokenRevokedError } from "../../modules/email-ingestion/token-errors.js";
import { tryUnlockPdf } from "../../modules/statements/pdf-unlock.service.js";
import { parseStatementRows } from "../../modules/statements/statement-row-parser.service.js";
import { guessStatementParserKey } from "../../modules/statements/institution-parser-key.js";
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
 * `alerts@hdfcbank.net`: this is financial-data ingestion, so a lookalike
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
 * This (not the `findOne` pre-check in the loop below) is the actual
 * dedup guarantee. `EmailImportLog.emailId` has a unique index, so if the
 * same Pub/Sub notification is redelivered while an earlier job for it is
 * still in flight (i.e. it already passed the pre-check but hasn't written
 * its log row yet), both jobs can race past that pre-check, but only ONE of
 * them can win this `create()` call. The other gets a MongoDB duplicate-key
 * error (code 11000), which is caught here and treated as "already being
 * processed by another job," not a real error. Only the winner goes on to
 * create the `PendingTransaction` for a `success` result, so a redelivered
 * notification can never produce two `PendingTransaction`s for the same
 * email. This is deliberately not "just trust BullMQ concurrency": a
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
 * Recursively walks `payload.parts` (attachments can be nested a level or two
 * deep, e.g. inside a multipart/mixed wrapper) for the first part that is
 * both named like a PDF and carries a real `body.attachmentId`, the
 * reference needed to actually fetch the bytes via a separate API call. A
 * part with inline `body.data` instead of an `attachmentId` is not an
 * attachment in the sense this code cares about (that path doesn't exist
 * anywhere in this codebase today, confirmed at implementation time).
 */
function findPdfAttachmentPart(
  payload: gmail_v1.Schema$MessagePart | undefined
): gmail_v1.Schema$MessagePart | null {
  if (!payload) return null;
  const stack: gmail_v1.Schema$MessagePart[] = [payload];
  while (stack.length > 0) {
    const part = stack.pop()!;
    if (part.filename && part.filename.toLowerCase().endsWith(".pdf") && part.body?.attachmentId) {
      return part;
    }
    if (part.parts) stack.push(...part.parts);
  }
  return null;
}

/**
 * Unlocks, parses and files a trusted-sender email's PDF statement
 * attachment (if it has one) as `pdf_statement_parsed` `PendingTransaction`s
 * with `accountId: null` (an email says what was spent but never which
 * account, same as the existing body-alert path), so account assignment is
 * deferred entirely to the existing confirm-time flow.
 *
 * Deliberately independent of body-text parsing: one email can have neither,
 * either, or both a parseable alert and a PDF attachment, and this function's
 * own `EmailImportLog` row uses a synthetic `${emailId}:pdf` key (distinct
 * from the plain `emailId` the body-parse claim uses) so the two outcomes,
 * and their own redelivery dedup, never collide.
 *
 * NEVER throws: an unlock or parse failure here must not block the rest of
 * this mailbox's history sync (the caller's `for` loop, or the
 * `historyId` advance after it): it's logged and treated as this one
 * attachment's outcome, nothing more.
 */
async function processPdfAttachment(params: {
  gmail: gmail_v1.Gmail;
  userId: string;
  emailId: string;
  payload: gmail_v1.Schema$MessagePart | undefined;
  sourceId: string;
  institution: string;
}): Promise<void> {
  const { gmail, userId, emailId, payload, sourceId, institution } = params;
  const pdfLogKey = `${emailId}:pdf`;

  try {
    const part = findPdfAttachmentPart(payload);
    if (!part?.body?.attachmentId) return; // no PDF attachment on this email: nothing to do

    // Fast path only, same caveat as the plain-emailId check above: the real
    // dedup guarantee is `tryReserveImportLog`'s unique-index race below.
    const alreadyLogged = await EmailImportLog.findOne({ emailId: pdfLogKey });
    if (alreadyLogged) return;

    const attachmentRes = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: emailId,
      id: part.body.attachmentId,
    });
    const base64Data = attachmentRes.data.data;
    if (!base64Data) {
      await tryReserveImportLog({ userId, emailId: pdfLogKey, sourceId, parseStatus: "failed" });
      return;
    }
    const buffer = Buffer.from(base64Data, "base64url");
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const existingBatch = await ImportBatch.findOne({ userId, fileHash, status: { $ne: "failed" } });
    if (existingBatch) {
      await tryReserveImportLog({ userId, emailId: pdfLogKey, sourceId, parseStatus: "failed" });
      return;
    }

    const unlocked = await tryUnlockPdf(buffer, userId);
    if (!unlocked.success) {
      await tryReserveImportLog({ userId, emailId: pdfLogKey, sourceId, parseStatus: "failed" });
      return;
    }

    const parserKey = guessStatementParserKey(institution);
    const rows = parseStatementRows(unlocked.pages, parserKey);

    const reserved = await tryReserveImportLog({ userId, emailId: pdfLogKey, sourceId, parseStatus: "success" });
    if (!reserved) return; // lost the race to a concurrent job for the same redelivered notification

    const rowResults: { row: number; status: "success" | "failed"; reason?: string; transactionId?: string }[] = [];
    const resultingIds: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if ("error" in row) {
        rowResults.push({ row: i + 1, status: "failed", reason: row.error });
        continue;
      }
      const pending = await PendingTransaction.create({
        userId,
        accountId: null,
        categoryId: null,
        amount: row.amount,
        date: new Date(row.date),
        note: row.note,
        merchant: row.merchant,
        source: "pdf_statement_parsed",
      });
      resultingIds.push(pending._id.toString());
      rowResults.push({ row: i + 1, status: "success", transactionId: pending._id.toString() });
    }

    await ImportBatch.create({
      userId,
      source: "pdf_statement",
      filename: part.filename ?? "statement.pdf",
      fileHash,
      rowResults,
      resultingIds,
    });
  } catch (err) {
    console.error(`PDF attachment processing failed for email ${emailId}:`, err);
    // Swallowed deliberately: see this function's doc comment.
  }
}

/**
 * Processes one Gmail push-notification job: lists the mailbox history since
 * the last known `historyId`, matches each new message's sender against this
 * user's `EmailSource`s, runs the matching parser, and, on a successful
 * parse, creates a `PendingTransaction` (never a confirmed `Transaction`;
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
    // Fast path only: skips a wasted Gmail API call for an email we already
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

    // PDF attachment handling: alongside the body-text parser below, not
    // instead of it. One email can have neither, either, or both.
    await processPdfAttachment({
      gmail,
      userId,
      emailId,
      payload,
      sourceId: source._id.toString(),
      institution: source.institution,
    });

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
      emailBalance: parsed.availableBalance ?? null,
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
 * `startRecurringDueWorker`/`startGmailWatchRenewalWorker`): a top-level
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
