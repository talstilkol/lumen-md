/**
 * W6.36 — the vault index snapshot of an encrypted vault, sealed and signed
 * in the index worker (src/storage/snapshotSeal.ts). Until now an encrypted
 * vault had no snapshot (#420), so every open read and decrypted every note.
 *
 * What is checked: the snapshot keys are their own HKDF subkeys and can't be
 * exported; a sealed record holds no note text or path; every tampered,
 * foreign, swapped or wrong-kind record is refused and dropped (the open
 * reads every note instead); a locked vault writes none; and a restart of an
 * unlocked vault takes every unchanged note from the snapshot.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryBackend, setVaultBackend, type VaultBackend } from "../storage/vault";
import { deriveRestKeys } from "../storage/vault/encrypted/format";
import * as session from "../storage/vault/encrypted/session";
import { restSnapshotKeys } from "../storage/vault/restStore";
import { isSealedSnapshot, openSnapshot, SEAL_VERSION, sealSnapshot, snapshotAad, type SealedSnapshot, type SnapshotKeys } from "../storage/snapshotSeal";
import { __putSnapshotRecord, __snapshotRecord, encodeSnapshot, readSnapshotRecord, snapshotRecord } from "../storage/indexSnapshot";
import { __resetWorkspaceIndex, __saveSnapshotNow, ensureIndex, indexedNoteText, searchWorkspace, snapshotCounters } from "../storage/workspaceIndex";
import { VaultIndex, localEngine } from "../storage/vaultIndexLocal";

const keysFor = async (vaultId = "vault-A"): Promise<SnapshotKeys> => (await deriveRestKeys(crypto.getRandomValues(new Uint8Array(32)), vaultId)).snapshot;
const FILES = [
  { path: "Daily/יומן.md", name: "יומן.md", modified: 11, content: "# יומן\nתוכניות סודיות" },
  { path: "Projects/Home.md", name: "Home.md", modified: 12, content: "secret plans [[Daily/יומן]]" },
];
const plain = (vault = "ws") => new TextEncoder().encode(JSON.stringify(encodeSnapshot(vault, FILES)));
const flip = (u: Uint8Array, i = 0) => {
  const c = u.slice();
  c[i] ^= 1;
  return c;
};
const asText = (rec: unknown) => {
  const r = rec as SealedSnapshot;
  // Every byte of the record, read as UTF-8 and as Latin-1, plus its clear fields.
  const parts = [r.ct, r.nonce, r.mac].map((b) => new TextDecoder().decode(b) + String.fromCharCode(...b.slice(0, 4096)));
  return JSON.stringify({ ...r, ct: null, nonce: null, mac: null }) + parts.join("");
};

describe("sealing (snapshotSeal)", () => {
  it("keys are HKDF subkeys of their own, not extractable, and seal a record that opens back", async () => {
    const dataKey = crypto.getRandomValues(new Uint8Array(32));
    const rest = await deriveRestKeys(dataKey.slice(), "vault-A");
    for (const k of [rest.snapshot.enc, rest.snapshot.mac]) {
      expect(k.extractable).toBe(false);
      await expect(crypto.subtle.exportKey("raw", k)).rejects.toBeTruthy();
    }
    expect(rest.snapshot.enc).not.toBe(rest.store);
    const rec = await sealSnapshot(rest.snapshot, "ws", plain());
    expect(rec).toMatchObject({ sealed: 1, sv: SEAL_VERSION, vaultId: "vault-A", vault: "ws" });
    expect(new TextDecoder().decode(await openSnapshot(rest.snapshot, "ws", rec))).toBe(new TextDecoder().decode(plain()));
    // The same data key derives the same snapshot keys (a restart opens the old record)…
    const again = await deriveRestKeys(dataKey.slice(), "vault-A");
    await expect(openSnapshot(again.snapshot, "ws", rec)).resolves.toBeTruthy();
    // …and the store key (a different subkey) does not decrypt it.
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.nonce as BufferSource, additionalData: snapshotAad(SEAL_VERSION, "vault-A", "ws") as BufferSource }, rest.store, rec.ct as BufferSource)).rejects.toBeTruthy();
  });

  it("a fresh nonce every time; the record says nothing of the notes", async () => {
    const k = await keysFor();
    const a = await sealSnapshot(k, "ws", plain());
    const b = await sealSnapshot(k, "ws", plain());
    expect(a.nonce).not.toEqual(b.nonce);
    expect(a.ct).not.toEqual(b.ct);
    for (const r of [a, b]) expect(asText(r)).not.toMatch(/secret|סודיות|יומן|Daily|Projects|Home/);
  });

  it("refuses anything changed: ciphertext, nonce, signature, version, vault ids, a record sealed for another vault", async () => {
    const k = await keysFor("vault-A");
    const rec = await sealSnapshot(k, "ws", plain());
    const refused = (r: unknown, vault = "ws", keys = k) => openSnapshot(keys, vault, r).then(() => "opened", (e: { reason?: string }) => e.reason);
    expect(await refused({ ...rec, ct: flip(rec.ct, 5) })).toBe("signature");
    expect(await refused({ ...rec, ct: flip(rec.ct, rec.ct.length - 1) })).toBe("signature");
    expect(await refused({ ...rec, nonce: flip(rec.nonce) })).toBe("signature");
    expect(await refused({ ...rec, mac: flip(rec.mac) })).toBe("signature");
    expect(await refused({ ...rec, ct: rec.ct.subarray(0, 10) })).toBe("signature");
    expect(await refused({ ...rec, sv: SEAL_VERSION + 1 })).toBe("version");
    expect(await refused({ ...rec, vaultId: "vault-B" })).toBe("vault");
    expect(await refused(rec, "other-ws")).toBe("vault");
    // A record relabelled for the other workspace: the AAD and MAC no longer match.
    expect(await refused({ ...rec, vault: "other-ws" }, "other-ws")).toBe("signature");
    // Another vault's keys (same vault id claimed): the signature fails.
    const other = await keysFor("vault-A");
    expect(await refused(rec, "ws", other)).toBe("signature");
    expect(await refused({ ...rec, nonce: rec.nonce.subarray(0, 8) })).toBe("shape");
    expect(await refused(encodeSnapshot("ws", FILES))).toBe("shape");
    expect(await refused(null)).toBe("shape");
    expect(await refused(rec)).toBe("opened");
  });

  it("a plain record is refused when keys are given, a sealed one when they are not", async () => {
    const k = await keysFor();
    const sealed = await snapshotRecord("ws", FILES, k);
    expect(isSealedSnapshot(sealed)).toBe(true);
    expect((await readSnapshotRecord(sealed, "ws", k)).snap?.get("Daily/יומן.md")?.content).toBe(FILES[0].content);
    expect(await readSnapshotRecord(sealed, "ws")).toEqual({ snap: null, refused: true });
    expect(await readSnapshotRecord(encodeSnapshot("ws", FILES), "ws", k)).toEqual({ snap: null, refused: true });
    expect(await readSnapshotRecord(undefined, "ws", k)).toEqual({ snap: null, refused: false });
    // Valid crypto around a payload that is not a snapshot: refused too.
    const junk = await sealSnapshot(k, "ws", new TextEncoder().encode("[1,2"));
    expect((await readSnapshotRecord(junk, "ws", k)).refused).toBe(true);
  });
});

describe("an encrypted vault opens from its sealed snapshot (workspace index)", () => {
  const PASS = "a long enough passphrase";
  const N = 40;
  let inner: VaultBackend;
  let previous: VaultBackend | null;
  const engine = () => localEngine(new VaultIndex());
  const restart = async () => {
    __resetWorkspaceIndex(engine, { keepSnapshot: true });
    await ensureIndex();
    return { ...snapshotCounters };
  };

  beforeEach(async () => {
    session.setKdfPolicyForTests({ minPbkdf2Iterations: 1000, minArgon2CostKiB: 8, argon2: { memoryKiB: 8, iterations: 1, parallelism: 1 } });
    inner = createMemoryBackend();
    for (let i = 0; i < N; i++) await inner.write(`notes/n${i}.md`, `# פתק ${i}\nsecret ${i} [[n${(i + 1) % N}]]`);
    previous = setVaultBackend(inner);
    await session.enableEncryption(PASS, { pbkdf2Iterations: 1000, confirmRecoveryKey: async () => true });
    __resetWorkspaceIndex(engine);
  });
  afterEach(() => {
    session.lock();
    setVaultBackend(previous);
  });

  it("first open reads every note; the snapshot is sealed (0 plain text in IndexedDB); the next open reads none", async () => {
    expect(restSnapshotKeys()).not.toBeNull();
    await ensureIndex();
    expect(snapshotCounters).toEqual({ fromSnapshot: 0, read: N });
    await __saveSnapshotNow();
    const rec = await __snapshotRecord();
    expect(isSealedSnapshot(rec)).toBe(true);
    expect(asText(rec)).not.toMatch(/secret|פתק|notes\/n|n1\.md/);
    expect(await restart()).toEqual({ fromSnapshot: N, read: 0 });
    expect(await indexedNoteText("notes/n7.md")).toBe(`# פתק 7\nsecret 7 [[n8]]`);
  });

  it("a note changed or deleted while closed is read again or dropped; the others come from the snapshot", async () => {
    await ensureIndex();
    await __saveSnapshotNow();
    await new Promise((r) => setTimeout(r, 5));
    const { deleteWorkspaceFile, writeWorkspaceFile } = await import("../storage/workspace");
    await writeWorkspaceFile("notes/n3.md", "changed secret");
    await deleteWorkspaceFile("notes/n4.md");
    expect(await restart()).toEqual({ fromSnapshot: N - 2, read: 1 });
    expect(await indexedNoteText("notes/n3.md")).toBe("changed secret");
    expect(await indexedNoteText("notes/n4.md")).toBeNull();
    expect((await searchWorkspace("secret", { limit: 100 })).map((h) => h.path)).not.toContain("notes/n4.md");
  });

  it("a tampered snapshot is refused and dropped: the open reads every note", async () => {
    await ensureIndex();
    await __saveSnapshotNow();
    const rec = (await __snapshotRecord()) as SealedSnapshot;
    await __putSnapshotRecord({ ...rec, ct: flip(rec.ct, 100) });
    expect(await restart()).toEqual({ fromSnapshot: 0, read: N });
    expect(await __snapshotRecord()).toBeUndefined();
  });

  it("a plain snapshot left in an encrypted vault is refused", async () => {
    await __putSnapshotRecord(encodeSnapshot(inner.id, [{ path: "notes/n1.md", name: "n1.md", modified: 1, content: "planted" }]));
    expect(await restart()).toEqual({ fromSnapshot: 0, read: N });
    expect(await indexedNoteText("notes/n1.md")).not.toBe("planted");
  });

  it("locked: no keys, nothing written; the sealed snapshot stays for the next unlock", async () => {
    await ensureIndex();
    await __saveSnapshotNow();
    const before = await __snapshotRecord();
    session.lock();
    expect(restSnapshotKeys()).toBeNull();
    await __saveSnapshotNow();
    expect(await __snapshotRecord()).toEqual(before);
    await session.unlock(PASS);
    expect(await restart()).toEqual({ fromSnapshot: N, read: 0 });
  });
});
