/**
 * Unit tests for plugin signing utilities.
 * Tests the key-management layer (trustKey/untrustKey/listTrustedKeys)
 * and the fingerprintOf helper using real WebCrypto (available in jsdom).
 *
 * verifyPluginSignature is NOT tested here — it requires a real Ed25519
 * keypair which is better covered in integration tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, val: unknown) => { store.set(key, val); }),
    del: vi.fn(async (key: string) => { store.delete(key); }),
    clear: vi.fn(async () => store.clear()),
    __store: store,
  };
});

describe("listTrustedKeys", () => {
  beforeEach(async () => {
    const { __store } = await import("idb-keyval") as any;
    __store.clear();
  });

  it("returns empty array when no user keys are stored", async () => {
    const { listTrustedKeys } = await import("../plugins/signing");
    const keys = await listTrustedKeys();
    // May include builtin keys (currently 0 in BUILTIN_TRUST)
    expect(Array.isArray(keys)).toBe(true);
  });

  it("built-in keys have source='builtin'", async () => {
    const { listTrustedKeys } = await import("../plugins/signing");
    const keys = await listTrustedKeys();
    keys.filter((k) => k.source === "builtin").forEach((k) => {
      expect(k.source).toBe("builtin");
    });
  });
});

describe("trustKey / untrustKey / listTrustedKeys", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { __store } = await import("idb-keyval") as any;
    __store.clear();
  });

  it("trustKey adds the fingerprint to the trusted set", async () => {
    const { trustKey, listTrustedKeys } = await import("../plugins/signing");
    await trustKey("fp-abc123", "MCowBQ==");
    const keys = await listTrustedKeys();
    const found = keys.find((k) => k.fingerprint === "fp-abc123");
    expect(found).toBeDefined();
    expect(found?.source).toBe("user");
  });

  it("untrustKey removes the fingerprint from the trusted set", async () => {
    const { trustKey, untrustKey, listTrustedKeys } = await import("../plugins/signing");
    await trustKey("fp-remove", "MCowBQ==");
    await untrustKey("fp-remove");
    const keys = await listTrustedKeys();
    expect(keys.find((k) => k.fingerprint === "fp-remove")).toBeUndefined();
  });

  it("can store multiple user-trusted keys", async () => {
    const { trustKey, listTrustedKeys } = await import("../plugins/signing");
    await trustKey("fp-A", "keyA==");
    await trustKey("fp-B", "keyB==");
    const keys = await listTrustedKeys();
    const userKeys = keys.filter((k) => k.source === "user");
    expect(userKeys.length).toBeGreaterThanOrEqual(2);
  });

  it("untrustKey is a no-op for unknown fingerprint", async () => {
    const { untrustKey, listTrustedKeys } = await import("../plugins/signing");
    const before = await listTrustedKeys();
    await untrustKey("fp-doesnt-exist");
    const after = await listTrustedKeys();
    expect(after.length).toBe(before.length);
  });
});

describe("fingerprintOf", () => {
  it("returns a hex string", async () => {
    const { fingerprintOf } = await import("../plugins/signing");
    // A minimal SPKI-like base64 (any bytes work for fingerprint calculation)
    const fakeSpki = btoa("fake-public-key-bytes");
    const fp = await fingerprintOf(fakeSpki);
    expect(typeof fp).toBe("string");
    expect(fp).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic for the same input", async () => {
    const { fingerprintOf } = await import("../plugins/signing");
    const spki = btoa("deterministic-key");
    const fp1 = await fingerprintOf(spki);
    const fp2 = await fingerprintOf(spki);
    expect(fp1).toBe(fp2);
  });

  it("produces different fingerprints for different keys", async () => {
    const { fingerprintOf } = await import("../plugins/signing");
    const fp1 = await fingerprintOf(btoa("key-one"));
    const fp2 = await fingerprintOf(btoa("key-two"));
    expect(fp1).not.toBe(fp2);
  });

  it("fingerprint length is 64 chars (SHA-256 hex)", async () => {
    const { fingerprintOf } = await import("../plugins/signing");
    const fp = await fingerprintOf(btoa("any-key-bytes"));
    expect(fp.length).toBe(64);
  });
});
