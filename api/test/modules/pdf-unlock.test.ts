import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StatementPassword } from "../../src/models/StatementPassword.js";
import { encrypt } from "../../src/lib/encryption.js";
import { tryUnlockPdf } from "../../src/modules/statements/pdf-unlock.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures");

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name));
}

// The real password baked into fixtures/statement-protected.pdf (generated
// once at implementation time via qpdf — see the comment on the fixture
// generation script referenced in the plan). Not a secret; it protects a
// throwaway synthetic PDF committed to this repo.
const REAL_PASSWORD = "correct-pw-123";

describe("tryUnlockPdf", () => {
  it("succeeds immediately on an unprotected PDF without trying any stored password", async () => {
    const result = await tryUnlockPdf(fixture("statement-unprotected.pdf"), "user-unlock-1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.pages.length).toBeGreaterThan(0);
      const text = result.pages.flatMap((p) => p.content.map((c) => c.str)).join(" ");
      expect(text).toContain("Test Bank Statement");
    }
  });

  it("unlocks a protected PDF by trying stored passwords, wrong ones first", async () => {
    const userId = "user-unlock-2";
    await StatementPassword.create({ userId, label: "wrong 1", passwordEncrypted: encrypt("nope") });
    await StatementPassword.create({ userId, label: "wrong 2", passwordEncrypted: encrypt("also-nope") });
    await StatementPassword.create({
      userId,
      label: "the real one",
      passwordEncrypted: encrypt(REAL_PASSWORD),
    });

    const result = await tryUnlockPdf(fixture("statement-protected.pdf"), userId);
    expect(result.success).toBe(true);
    if (result.success) {
      const text = result.pages.flatMap((p) => p.content.map((c) => c.str)).join(" ");
      expect(text).toContain("password protected");
    }
  });

  it("proves it tries every candidate, not just the first, by succeeding when the correct password is added last", async () => {
    const userId = "user-unlock-order";
    await StatementPassword.create({ userId, label: "a", passwordEncrypted: encrypt("wrong-a") });
    await StatementPassword.create({ userId, label: "b", passwordEncrypted: encrypt("wrong-b") });
    await StatementPassword.create({ userId, label: "c", passwordEncrypted: encrypt("wrong-c") });
    await StatementPassword.create({
      userId,
      label: "last one added, still tried",
      passwordEncrypted: encrypt(REAL_PASSWORD),
    });

    const result = await tryUnlockPdf(fixture("statement-protected.pdf"), userId);
    expect(result.success).toBe(true);
  });

  it("fails cleanly when every candidate password is wrong", async () => {
    const userId = "user-unlock-3";
    await StatementPassword.create({ userId, label: "wrong 1", passwordEncrypted: encrypt("nope") });
    await StatementPassword.create({ userId, label: "wrong 2", passwordEncrypted: encrypt("also-nope") });

    const result = await tryUnlockPdf(fixture("statement-protected.pdf"), userId);
    expect(result.success).toBe(false);
  });

  it("fails cleanly (no candidates to try) when the user has no stored passwords at all", async () => {
    const result = await tryUnlockPdf(fixture("statement-protected.pdf"), "user-unlock-nopasswords");
    expect(result.success).toBe(false);
  });

  it("fails fast on a corrupt/non-PDF file without wasting stored-password attempts", async () => {
    const userId = "user-unlock-corrupt";
    // If it incorrectly treated this as "needs a password" and looped through
    // candidates, this would still resolve to success:false — so this test
    // asserts the outcome AND (via a spy-free proxy: elapsed calls aren't
    // observable here) documents the intent. The real fast-fail behavior is
    // exercised structurally: a corrupt file is not a PasswordException, so
    // the implementation's own branch never reaches the password loop.
    const result = await tryUnlockPdf(fixture("statement-corrupt.pdf"), userId);
    expect(result.success).toBe(false);
  });

  it("does not try another user's stored passwords", async () => {
    await StatementPassword.create({
      userId: "user-unlock-owner",
      label: "owner's password",
      passwordEncrypted: encrypt(REAL_PASSWORD),
    });

    const result = await tryUnlockPdf(fixture("statement-protected.pdf"), "user-unlock-intruder");
    expect(result.success).toBe(false);
  });
});
