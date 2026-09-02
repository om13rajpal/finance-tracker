import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { EmailSource } from "../../models/EmailSource.js";
import { PARSER_REGISTRY } from "./parsers/registry.js";

/**
 * CRUD for the trusted-sender list `gmailEmailParse.worker.ts` gates BOTH
 * automatic bank-alert-email parsing and automatic PDF-statement-attachment
 * processing on: an email from a sender with no matching `EmailSource` is
 * skipped as `"unmatched"` before either ever runs. Previously nothing in
 * this codebase ever created one of these documents at all (no route, no
 * auto-promotion of a first-seen sender), which meant automatic ingestion
 * was unreachable for every user regardless of what else was configured.
 *
 * `senderPattern` must be the EXACT sender address the worker's own
 * `extractSenderAddress` extracts from a message's `From` header (not a
 * domain or substring): matching there is exact-equality specifically so a
 * lookalike sender is never trusted, so this route lower-cases and trims but
 * never widens what's stored into a pattern.
 */
export const emailSourcesRouter = Router();
emailSourcesRouter.use(requireAuth);

emailSourcesRouter.get("/", async (req, res, next) => {
  try {
    const rows = await EmailSource.find({ userId: (req as any).userId }).sort({ institution: 1 });
    res.json(
      rows.map((row) => ({
        ...row.toObject(),
        // Lets the UI say plainly, per row, whether alert-email parsing is
        // actually wired up for that institution yet, or whether trusting
        // this sender only unlocks automatic PDF-statement processing:
        // both true for HDFC today, only the latter for everything else.
        hasEmailBodyParser: row.parserKey in PARSER_REGISTRY,
      }))
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Best-effort mapping from a free-text institution name to a registered
 * email-BODY parser key (`parsers/registry.ts`, currently only
 * `hdfc_debit_alert` exists). Deliberately separate from, and narrower than,
 * `guessStatementParserKey` (used for PDF-attachment processing, which reads
 * `EmailSource.institution` directly and isn't gated by this at all): a bank
 * with no registered alert-email parser yet (SBI, today) still gets full
 * automatic PDF-statement processing once trusted here: `PARSER_REGISTRY[key]`
 * simply resolving to `undefined` for it is already handled as a graceful
 * per-email "failed" log in the worker, never a hard failure.
 */
function guessEmailBodyParserKey(institution: string): string {
  const key = institution.toLowerCase();
  if (key.includes("hdfc")) return "hdfc_debit_alert";
  return "none";
}

const createSchema = z.object({
  senderPattern: z.string().trim().toLowerCase().email(),
  institution: z.string().trim().min(1),
});

emailSourcesRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const created = await EmailSource.create({
      userId: (req as any).userId,
      senderPattern: data.senderPattern,
      institution: data.institution,
      parserKey: guessEmailBodyParserKey(data.institution),
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

emailSourcesRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await EmailSource.deleteOne({ _id: req.params.id, userId: (req as any).userId });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
