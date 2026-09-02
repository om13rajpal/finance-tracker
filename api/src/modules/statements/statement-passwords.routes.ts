import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { StatementPassword } from "../../models/StatementPassword.js";
import { encrypt } from "../../lib/encryption.js";

/**
 * CRUD for the flat, unordered per-user list of statement passwords that
 * `pdf-unlock.service.ts` tries against any statement PDF. Mirrors
 * `categorization.routes.ts`'s shape. `GET` deliberately projects only
 * `{_id, label, createdAt}`. The encrypted value (and obviously never the
 * plaintext) is not returned once stored, matching how `GmailConnection`'s
 * refresh token is handled.
 */
export const statementPasswordsRouter = Router();
statementPasswordsRouter.use(requireAuth);

statementPasswordsRouter.get("/", async (req, res, next) => {
  try {
    const rows = await StatementPassword.find({ userId: (req as any).userId })
      .select({ _id: 1, label: 1, createdAt: 1 })
      .sort({ createdAt: 1 });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  label: z.string().optional(),
  password: z.string().min(1),
});

statementPasswordsRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const created = await StatementPassword.create({
      userId: (req as any).userId,
      label: data.label ?? "",
      passwordEncrypted: encrypt(data.password),
    });
    res.status(201).json({ _id: created._id, label: created.label, createdAt: created.createdAt });
  } catch (err) {
    next(err);
  }
});

statementPasswordsRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await StatementPassword.deleteOne({ _id: req.params.id, userId: (req as any).userId });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
