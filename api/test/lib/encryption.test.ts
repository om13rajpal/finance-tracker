import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../../src/lib/encryption.js";

describe("encryption", () => {
  it("round-trips a plaintext value", () => {
    const ciphertext = encrypt("my-refresh-token");
    expect(ciphertext).not.toBe("my-refresh-token");
    expect(decrypt(ciphertext)).toBe("my-refresh-token");
  });

  it("produces different ciphertext for the same plaintext on repeat calls", () => {
    const a = encrypt("same-value");
    const b = encrypt("same-value");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same-value");
    expect(decrypt(b)).toBe("same-value");
  });

  it("throws when the ciphertext has been tampered with (auth tag mismatch)", () => {
    const ciphertext = encrypt("secret-value");
    const [ivHex, authTagHex, dataHex] = ciphertext.split(":");
    // Flip a byte in the encrypted data portion.
    const tamperedByte = (parseInt(dataHex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, "0");
    const tamperedData = tamperedByte + dataHex.slice(2);
    const tampered = `${ivHex}:${authTagHex}:${tamperedData}`;

    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when the auth tag itself has been tampered with", () => {
    const ciphertext = encrypt("secret-value-2");
    const [ivHex, authTagHex, dataHex] = ciphertext.split(":");
    const tamperedTagByte = (parseInt(authTagHex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, "0");
    const tamperedTag = tamperedTagByte + authTagHex.slice(2);
    const tampered = `${ivHex}:${tamperedTag}:${dataHex}`;

    expect(() => decrypt(tampered)).toThrow();
  });

  it("uses a 32-byte (256-bit) key derived from the hex-encoded TOKEN_ENCRYPTION_KEY", () => {
    // TOKEN_ENCRYPTION_KEY in test/setup.ts is 64 hex chars = 32 bytes, required for AES-256.
    expect(Buffer.from(process.env.TOKEN_ENCRYPTION_KEY as string, "hex").length).toBe(32);
  });
});
