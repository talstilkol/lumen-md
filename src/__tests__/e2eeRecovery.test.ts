/**
 * Plan W11.S8 (research R3.9): a 256-bit recovery key that wraps the epoch
 * secret, in a new keyring protocol (3), so a forgotten passphrase no longer
 * loses the vault. Rotating keys and revoking a device wrap it again; the
 * recovery key never reaches sync storage unwrapped.
 * Real engine, real WebCrypto, the simulated provider.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { memoryProvider, type SyncProvider } from "../sync/e2ee/provider";
import { E2eeSync, setUpRecovery, unlockVault, unlockWithDevice, unlockWithRecoveryKey } from "../sync/e2ee/engine";
import { ageEncrypt, generateIdentity } from "../sync/e2ee/age";
import { randomBytes, toB64u, utf8 } from "../sync/e2ee/bytes";
import { decodeKeyring, KEYRING_NAME, KEYRING_PROTOCOL, keyringContents, readKeyring, RevokedError, rewriteKeyring, TamperedWrapError, type KeyringFile } from "../sync/e2ee/keyring";
import { newRecoveryKey, RECOVERY_KEY_BYTES, RecoveryKeyError, recoveryKeys } from "../sync/e2ee/recovery";
import { memoryFiles } from "../sync/e2ee/localFiles";
import { memoryStateStore } from "../sync/e2ee/state";
import { device, joinTrusted, newVault, PASSPHRASE, snapshot, TEST_POLICY } from "./helpers/e2ee";

const ringOf = async (p: SyncProvider) => (await readKeyring(p))!.file;
const put = (p: ReturnType<typeof memoryProvider>, f: KeyringFile) => p.objects.set(KEYRING_NAME, { data: utf8(JSON.stringify(f)), etag: `forged-${Math.random()}` });

/** A vault with notes, synced, and recovery set up. */
async function withRecovery() {
  const p = memoryProvider();
  const a = await newVault(p);
  a.files.set("שלום.md", "# שלום\nתוכן מוצפן");
  a.files.set("notes/a.md", "plain ASCII");
  await a.sync.sync();
  const { key, result } = await setUpRecovery(a.sync);
  await a.sync.sync();
  return { p, a, key, result };
}

/** A clean profile: nothing but the provider and the recovery key. */
async function restore(p: SyncProvider, key: Uint8Array) {
  const { keys } = await unlockWithRecoveryKey(p, key);
  const files = memoryFiles();
  const sync = new E2eeSync({ provider: p, keys, local: files, store: memoryStateStore() });
  await sync.sync();
  return { keys, files, sync };
}

describe("setting up the recovery key", () => {
  it("is 256 random bits; setup is a re-key to a protocol-3 keyring whose sealed part names the key's recipient", async () => {
    expect(RECOVERY_KEY_BYTES).toBe(32);
    const k1 = newRecoveryKey();
    expect(k1).toHaveLength(32);
    expect(toB64u(k1)).not.toBe(toB64u(newRecoveryKey()));
    const { p, a, key, result } = await withRecovery();
    expect(result.epoch).toBe(1);
    const f = await ringOf(p);
    expect(f.protocol).toBe(KEYRING_PROTOCOL);
    expect(KEYRING_PROTOCOL).toBe(3);
    const rk = await recoveryKeys(key, f.vaultId);
    expect(f.recovery?.recipient).toBe(rk.age.recipient);
    expect(a.sync.keys().ring?.recovery).toBe(rk.age.recipient);
    expect((await keyringContents(f, a.sync.keys())).recovery).toEqual({ recipient: rk.age.recipient, mac: rk.mac });
  });
});

describe("restoring with only the recovery key", () => {
  it("a clean profile opens the vault and gets every note back (10 of 10 runs)", async () => {
    for (let run = 0; run < 10; run++) {
      const { p, a, key } = await withRecovery();
      const r = await restore(p, key);
      expect(r.keys.epoch).toBe(a.sync.keys().epoch);
      expect(r.keys.wrap).toBeNull();
      expect(snapshot({ files: r.files } as never)).toEqual(snapshot(a));
    }
  });

  it("then a new passphrase: the restored device re-keys with it, and the new passphrase opens the vault", async () => {
    const { p, a, key } = await withRecovery();
    const r = await restore(p, key);
    // A clean profile can't vouch for the device list: the user confirms the other devices pair again.
    // The header's KDF can't be verified without the old passphrase, so the new one gets Argon2id (production parameters).
    const out = await r.sync.rekey({ newPassphrase: "a brand new passphrase 2026", dropDevices: true });
    expect(out.epoch).toBe(2);
    const { keys } = await unlockVault(p, "a brand new passphrase 2026", TEST_POLICY);
    expect(keys.epoch).toBe(2);
    const d = device("D", p, keys);
    await d.sync.sync();
    expect(snapshot(d)).toEqual(snapshot(a));
    // The recovery key still works after the passphrase change (carried by the re-key).
    expect((await unlockWithRecoveryKey(p, key)).keys.epoch).toBe(2);
    await expect(unlockVault(p, PASSPHRASE, TEST_POLICY)).rejects.toThrow();
  });

  it("another key, or a vault without recovery, is refused", async () => {
    const { p } = await withRecovery();
    await expect(unlockWithRecoveryKey(p, newRecoveryKey())).rejects.toBeInstanceOf(RecoveryKeyError);
    await expect(unlockWithRecoveryKey(p, new Uint8Array(16))).rejects.toBeInstanceOf(RecoveryKeyError);
    const q = memoryProvider();
    const b = await newVault(q);
    await expect(unlockWithRecoveryKey(q, newRecoveryKey())).rejects.toBeInstanceOf(RecoveryKeyError); // epoch 0: no keyring
    await b.sync.rekey();
    await expect(unlockWithRecoveryKey(q, newRecoveryKey())).rejects.toBeInstanceOf(RecoveryKeyError); // a keyring without recovery
  });
});

describe("rotation and revocation wrap the recovery key again", () => {
  it("a rotation: the new epoch's secret is wrapped for the same key, by a device that never held it", async () => {
    const { p, a, key } = await withRecovery();
    const before = (await ringOf(p)).recovery!;
    await a.sync.rekey();
    const after = (await ringOf(p)).recovery!;
    expect(after.recipient).toBe(before.recipient);
    expect(after.wrap).not.toBe(before.wrap);
    const r = await restore(p, key);
    expect(r.keys.epoch).toBe(2);
    expect(snapshot({ files: r.files } as never)).toEqual(snapshot(a));
  });

  it("a revocation: the revoked device is out, the recovery key opens the new epoch", async () => {
    const { p, a, key } = await withRecovery();
    const id = await generateIdentity();
    await a.sync.enroll("phone", id.recipient);
    // A same-epoch rewrite (the enrollment) made the wrap and its check again.
    expect((await unlockWithRecoveryKey(p, key)).keys.ring?.rev).toBe(1);
    await a.sync.rekey({ revoke: ["phone"] });
    await expect(unlockWithDevice(p, "phone", id.identity)).rejects.toBeInstanceOf(RevokedError);
    const r = await restore(p, key);
    expect(r.keys.epoch).toBe(2);
    expect(snapshot({ files: r.files } as never)).toEqual(snapshot(a));
  });

  it("removing it (recovery: null): the next keyring has no recovery wrap and the old key stops working", async () => {
    const { p, a, key } = await withRecovery();
    await a.sync.rekey({ recovery: null });
    expect((await ringOf(p)).recovery).toBeUndefined();
    await expect(unlockWithRecoveryKey(p, key)).rejects.toBeInstanceOf(RecoveryKeyError);
  });
});

describe("the storage can't make a keyring the recovery key accepts", () => {
  it("a wrap of the storage's own secret to the (public) recipient fails the check", async () => {
    const { p, key } = await withRecovery();
    const f = await ringOf(p);
    put(p, { ...f, recovery: { ...f.recovery!, wrap: toB64u(await ageEncrypt(randomBytes(32), [{ x25519: f.recovery!.recipient }])) } });
    await expect(unlockWithRecoveryKey(p, key)).rejects.toBeInstanceOf(TamperedWrapError);
  });

  it("a check moved to another epoch, or garbled, fails", async () => {
    const { p, a, key } = await withRecovery();
    const old = (await ringOf(p)).recovery!;
    await a.sync.rekey();
    const f = await ringOf(p);
    put(p, { ...f, recovery: { ...f.recovery!, check: old.check } });
    await expect(unlockWithRecoveryKey(p, key)).rejects.toBeInstanceOf(TamperedWrapError);
    put(p, { ...f, recovery: { ...f.recovery!, check: "!!" } });
    await expect(unlockWithRecoveryKey(p, key)).rejects.toBeInstanceOf(TamperedWrapError);
  });

  it("a recovery field on a protocol-2 keyring is not a keyring", () => {
    const f = { format: "lumen-e2ee-keyring", protocol: 2, vaultId: "v", epoch: 1, passphrase: { n: "a", c: "b" }, sealed: { n: "c", c: "d" }, devices: {}, recovery: { recipient: "age1x", wrap: "w", check: "c" } };
    expect(() => decodeKeyring(utf8(JSON.stringify(f)))).toThrow(/Not a Lumen keyring/);
    expect(decodeKeyring(utf8(JSON.stringify({ ...f, recovery: undefined }))).protocol).toBe(2);
  });
});

describe("protocol 2 keyrings", () => {
  it("are rewritten as protocol 2 (their passphrase wrap is bound to it) and can't take recovery without a re-key", async () => {
    const p = memoryProvider();
    const a = await newVault(p);
    await a.sync.sync();
    await a.sync.rekey();
    // Make the stored keyring a protocol-2 one, as an earlier build wrote it.
    const keys = a.sync.keys();
    const f = await ringOf(p);
    expect(f.protocol).toBe(3);
    const { keyringAad } = await import("../sync/e2ee/keyring");
    const { bs, fromB64u } = await import("../sync/e2ee/bytes");
    const reseal = async (key: CryptoKey, data: Uint8Array, role: string) => {
      const n = randomBytes(12);
      return { n: toB64u(n), c: toB64u(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(n), additionalData: bs(keyringAad(f.vaultId, f.epoch, role, 2)) }, key, bs(data)))) };
    };
    const contents = await keyringContents(f, keys);
    const v2: KeyringFile = { ...f, protocol: 2, passphrase: await reseal(keys.wrap!, keys.secret, "passphrase"), sealed: await reseal(keys.keyring, utf8(JSON.stringify(contents)), "sealed") };
    put(p, v2);
    const opened = await unlockVault(p, PASSPHRASE, TEST_POLICY);
    expect(opened.keys.epoch).toBe(1);
    const rewritten = await rewriteKeyring(p, { ...opened.keys, ring: { ...opened.keys.ring!, digest: (await readKeyring(p))!.digest } }, { wrap: opened.keys.wrap! }, (c, file) => ({ contents: c, file }));
    expect((await ringOf(p)).protocol).toBe(2);
    expect(rewritten.ring?.rev).toBe(1);
    await expect(rewriteKeyring(p, rewritten, { wrap: opened.keys.wrap! }, (c, file) => ({ contents: { ...c, recovery: { recipient: "age1", mac: toB64u(randomBytes(32)) } }, file }))).rejects.toThrow(/re-key/);
    void fromB64u;
  });
});

describe("the recovery key is never in sync storage unwrapped (plaintext scan)", () => {
  it("after setup, a rotation, an enrollment, a revocation and a restore: no encoding of the key or its derived secrets anywhere", async () => {
    const { p, a, key } = await withRecovery();
    const id = await generateIdentity();
    await a.sync.enroll("phone", id.recipient);
    await a.sync.rekey();
    await a.sync.rekey({ revoke: ["phone"] });
    const b = await joinTrusted("B", p);
    await b.sync.sync();
    const r = await restore(p, key);
    await r.sync.sync();
    const f = await ringOf(p);
    const rk = await recoveryKeys(key, f.vaultId);
    const { bech32Decode } = await import("../sync/e2ee/age");
    const scalar = bech32Decode(rk.age.identity.toLowerCase()).data;
    const { fromB64u } = await import("../sync/e2ee/bytes");
    const mac = fromB64u(rk.mac);
    const enc = (b: Uint8Array) => [Buffer.from(b).toString("hex"), Buffer.from(b).toString("hex").toUpperCase(), Buffer.from(b).toString("base64"), Buffer.from(b).toString("base64").replace(/=+$/, ""), toB64u(b)];
    const needles = [...enc(key), ...enc(scalar), ...enc(mac), rk.age.identity, rk.age.identity.toLowerCase()];
    const raw = [key, scalar, mac];
    let scanned = 0;
    const hay: Array<[string, Buffer]> = [...p.objects].map(([n, o]) => [n, Buffer.from(o.data)]);
    for (const d of [a, b]) hay.push([`state:${d.name}`, Buffer.from(JSON.stringify(d.store.state ?? {}))]);
    for (const [name, buf] of hay) {
      scanned++;
      const text = buf.toString("latin1");
      for (const n of needles) expect(text.includes(n), `${name} holds ${n.slice(0, 12)}…`).toBe(false);
      for (const x of raw) expect(buf.indexOf(Buffer.from(x)), `${name} holds raw key bytes`).toBe(-1);
    }
    expect(scanned).toBeGreaterThan(5);
    // The keyring does hold the recipient (public) — the point of the asymmetric wrap.
    expect(JSON.stringify(f)).toContain(rk.age.recipient);
  });
});
