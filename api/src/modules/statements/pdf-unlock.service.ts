import { PDFExtract, type PDFExtractPage } from "pdf.js-extract";
import { StatementPassword } from "../../models/StatementPassword.js";
import { decrypt } from "../../lib/encryption.js";

export type UnlockResult = { success: true; pages: PDFExtractPage[] } | { success: false };

/**
 * pdfjs (the engine behind pdf.js-extract) throws a `PasswordException` — with
 * `.code` 1 (NEED_PASSWORD, no password was supplied at all) or 2
 * (INCORRECT_PASSWORD, one was supplied and it was wrong) — for anything that
 * IS a valid, decryptable-in-principle PDF that just needs the right key. Any
 * other error (most commonly `InvalidPDFException` for a corrupt or
 * non-PDF file) means there is no password that will ever help, so it must
 * short-circuit immediately rather than burning through every stored
 * candidate for nothing.
 */
function isPasswordException(err: unknown): boolean {
  return (err as { name?: string } | undefined)?.name === "PasswordException";
}

/**
 * Tries to unlock (and extract) a statement PDF: first with no password at
 * all (some bank e-statements aren't protected), then every password this
 * user has stored — in whatever order Mongo returns them, since this is
 * deliberately a flat, unordered list per the product decision (no
 * bank↔password mapping) — short-circuiting on the first one that works.
 *
 * A corrupt/non-PDF file fails immediately without trying any password, since
 * that failure has nothing to do with encryption.
 */
export async function tryUnlockPdf(buffer: Buffer, userId: string): Promise<UnlockResult> {
  const pdfExtract = new PDFExtract();

  try {
    const result = await pdfExtract.extractBuffer(buffer, {});
    return { success: true, pages: result.pages };
  } catch (err) {
    if (!isPasswordException(err)) {
      // Not a password problem at all — corrupt file, not a PDF, etc. No
      // stored password will ever fix this, so stop here.
      return { success: false };
    }
  }

  const candidates = await StatementPassword.find({ userId });

  for (const candidate of candidates) {
    let plaintext: string;
    try {
      plaintext = decrypt(candidate.passwordEncrypted);
    } catch {
      // A candidate that fails to decrypt (shouldn't happen in practice) is
      // just not usable — skip it rather than aborting the whole attempt.
      continue;
    }

    try {
      const result = await pdfExtract.extractBuffer(buffer, { password: plaintext });
      return { success: true, pages: result.pages };
    } catch (err) {
      if (isPasswordException(err)) continue; // wrong password — try the next one
      return { success: false }; // some other failure mid-attempt — stop
    }
  }

  return { success: false };
}
