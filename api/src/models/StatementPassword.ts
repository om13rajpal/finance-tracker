import { Schema, model } from "mongoose";

/**
 * A flat, unordered per-user list of passwords to try against any uploaded or
 * Gmail-ingested statement PDF (see `pdf-unlock.service.ts`) — not a
 * bank→password mapping. `label` is the user's own note only and is never
 * used to pick which password to try; every stored password is attempted in
 * order until one unlocks the file.
 *
 * Mirrors `CategorizationRule`'s has-many-per-user shape (`userId` indexed,
 * not unique) — not `GmailConnection`'s one-per-user shape.
 */
const statementPasswordSchema = new Schema({
  userId: { type: String, required: true, index: true },
  label: { type: String, default: "" },
  passwordEncrypted: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const StatementPassword = model("StatementPassword", statementPasswordSchema);
