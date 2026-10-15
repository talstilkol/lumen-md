/**
 * Regression tests for wireEncryption (src/collab/yjs.ts).
 *
 * Bug: every local update triggered `cryptMap.set(...)`, which emitted a
 * new update that was itself encrypted and written to the map again —
 * an unbounded encrypt → write → encrypt loop.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";

const encryptOp = vi.fn(async (_pw: string, data: Uint8Array) => new Uint8Array(data));
const decryptOp = vi.fn(async (_pw: string, data: Uint8Array) => new Uint8Array(data));

vi.mock("../collab/encryption", () => ({
  encryptOp: (pw: string, d: Uint8Array) => encryptOp(pw, d),
  decryptOp: (pw: string, d: Uint8Array) => decryptOp(pw, d),
}));
vi.mock("y-webrtc", () => ({ WebrtcProvider: class {} }));
vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("wireEncryption", () => {
  beforeEach(() => {
    encryptOp.mockClear();
    decryptOp.mockClear();
  });

  it("encrypts a single local insert exactly once (no recursive re-encryption)", async () => {
    const { wireEncryption, CRYPT_MAP_NAME } = await import("../collab/yjs");
    const doc = new Y.Doc();
    wireEncryption(doc, "pw");
    doc.getText("lumen").insert(0, "hello");
    await settle();
    await settle();
    expect(encryptOp).toHaveBeenCalledTimes(1);
    expect(doc.getMap(CRYPT_MAP_NAME).size).toBe(1);
    // Our own crypt-map write must not be decrypted + re-applied either.
    expect(decryptOp).not.toHaveBeenCalled();
  });

  it("keeps the crypt map bounded by the number of local edits", async () => {
    const { wireEncryption, CRYPT_MAP_NAME } = await import("../collab/yjs");
    const doc = new Y.Doc();
    wireEncryption(doc, "pw");
    const text = doc.getText("lumen");
    for (let i = 0; i < 5; i++) {
      text.insert(text.length, String(i));
      await settle();
    }
    await settle();
    expect(encryptOp).toHaveBeenCalledTimes(5);
    expect(doc.getMap(CRYPT_MAP_NAME).size).toBe(5);
  });

  it("decrypts remote crypt entries without re-encrypting them", async () => {
    const { wireEncryption, CRYPT_MAP_NAME } = await import("../collab/yjs");
    const a = new Y.Doc();
    const b = new Y.Doc();
    wireEncryption(a, "pw");
    wireEncryption(b, "pw");
    a.getText("lumen").insert(0, "from a");
    await settle();
    expect(encryptOp).toHaveBeenCalledTimes(1);

    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "remote");
    await settle();
    await settle();
    expect(b.getText("lumen").toString()).toBe("from a");
    expect(decryptOp).toHaveBeenCalledTimes(1);
    // B must not encrypt A's update again.
    expect(encryptOp).toHaveBeenCalledTimes(1);
    expect(b.getMap(CRYPT_MAP_NAME).size).toBe(1);
  });
});
