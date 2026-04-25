/**
 * Unit tests for vault encryption (AES-256-GCM).
 *
 * Run with: npx vitest run
 * Note: requires jsdom environment for Web Crypto API
 */

import { describe, it, expect } from "vitest";
import {
  encryptText,
  decryptText,
  isEncrypted,
  wrapEncrypted,
  unwrapEncrypted,
  encryptDocument,
  decryptDocument,
} from "../storage/encryption";

describe("Encryption", () => {
  const password = "test-password-123";
  const plaintext = "# Hello World\n\nThis is a secret document.";

  it("encrypts and decrypts text round-trip", async () => {
    const encrypted = await encryptText(plaintext, password);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.length).toBeGreaterThan(0);

    const decrypted = await decryptText(encrypted, password);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext each time (random salt+IV)", async () => {
    const enc1 = await encryptText(plaintext, password);
    const enc2 = await encryptText(plaintext, password);
    expect(enc1).not.toBe(enc2); // Different due to random salt/IV
  });

  it("fails to decrypt with wrong password", async () => {
    const encrypted = await encryptText(plaintext, password);
    await expect(decryptText(encrypted, "wrong-password")).rejects.toThrow();
  });

  it("detects encrypted content", () => {
    expect(isEncrypted("🔒LUMEN_ENCRYPTED:abc123")).toBe(true);
    expect(isEncrypted("# Normal markdown")).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });

  it("wraps and unwraps encrypted content", () => {
    const cipher = "abc123base64data";
    const wrapped = wrapEncrypted(cipher);
    expect(wrapped).toBe("🔒LUMEN_ENCRYPTED:abc123base64data");
    expect(unwrapEncrypted(wrapped)).toBe(cipher);
  });

  it("encrypts and decrypts a full document", async () => {
    const encrypted = await encryptDocument(plaintext, password);
    expect(isEncrypted(encrypted)).toBe(true);

    const decrypted = await decryptDocument(encrypted, password);
    expect(decrypted).toBe(plaintext);
  });

  it("decryptDocument returns unencrypted content as-is", async () => {
    const result = await decryptDocument("# Not encrypted", password);
    expect(result).toBe("# Not encrypted");
  });
});
