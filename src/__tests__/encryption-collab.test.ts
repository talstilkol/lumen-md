/**
 * Tests for the collab E2E encryption (P3-13). Roundtrips a Yjs-shaped
 * binary payload through encryptOp → decryptOp under the same password,
 * and proves a wrong password yields null (the auth tag rejects it).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { encryptOp, decryptOp, resetCollabKey } from "../collab/encryption";

describe("collab encryption", () => {
  beforeEach(() => resetCollabKey());

  it("encrypt → decrypt with the same password roundtrips bytes", async () => {
    const password = "open-sesame-1234567";
    const original = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252, 253]);
    const encrypted = await encryptOp(password, original);
    const decrypted = await decryptOp(password, encrypted);
    expect(decrypted).not.toBeNull();
    expect(Array.from(decrypted!)).toEqual(Array.from(original));
  });

  it("each call uses a fresh IV (ciphertexts differ for the same plaintext)", async () => {
    const password = "same-password";
    const original = new Uint8Array([42, 42, 42, 42, 42]);
    const a = await encryptOp(password, original);
    const b = await encryptOp(password, original);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("wrong password returns null (auth tag rejects)", async () => {
    const original = new Uint8Array([9, 8, 7]);
    const encrypted = await encryptOp("right-password-x", original);
    resetCollabKey();
    const decrypted = await decryptOp("wrong-password!!", encrypted);
    expect(decrypted).toBeNull();
  });

  it("truncated ciphertext returns null", async () => {
    const decrypted = await decryptOp("any-password", new Uint8Array(8));
    expect(decrypted).toBeNull();
  });

  it("handles a realistic ~2 KB Yjs-shaped buffer", async () => {
    const password = "foo-bar-baz-quux";
    const buf = new Uint8Array(2048);
    crypto.getRandomValues(buf);
    const enc = await encryptOp(password, buf);
    const dec = await decryptOp(password, enc);
    expect(dec).toEqual(buf);
  });
});
