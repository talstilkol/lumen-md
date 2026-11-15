/**
 * Blind tests (plan W6.15, W10.D18): the keyring — epochs, rotation,
 * revocation, descent (rollback and fork), anchors and the CAS rules.
 *
 * Written from the spec only: docs/sync-protocol.md §3, §5, §8, §9,
 * docs/src/content/docs/sync/e2ee-keys.md and the declarations tsc emits for
 * src/sync/e2ee/keyring.ts, keyringErrors.ts, engine*.ts, vaultOpen.ts,
 * keys.ts, provider.ts and age.ts (signatures and doc comments, no function
 * bodies, no existing keyring tests). The keyring digest, the epoch-0 secret
 * and the vectors' expected files are checked against the spec's own
 * formulas and docs/sync-protocol-vectors.json. Lane X-BL, against
 * verify/train-5 (c3f055218e).
 *
 * The adversary is the storage (spec §9): it can replay, withhold, swap and
 * ignore conditional writes, and it knows every device's public key. Some
 * cases also play a device that still holds the epoch's secret.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CasUnsupportedError,
  DropDevicesRequiredError,
  DroppedFromVaultError,
  KeyringForkError,
  KeyringRollbackError,
  memoryProvider,
  memoryStateStore,
  RevokedError,
  UnverifiedDeviceError,
  unlockVault,
  WrongPassphraseError,
  DecryptError,
} from "../../sync/e2ee";
import { unlockWithDevice } from "../../sync/e2ee/engine";
import {
  ABORTED_LENGTH,
  CHAIN_LENGTH,
  decodeKeyring,
  KEYRING_NAME,
  KEYRING_PROTOCOL,
  keyringContents,
  keyringDigest,
  prepareEpoch,
  readKeyring,
  RevokedDeviceEnrollError,
  TamperedWrapError,
  type KeyringFile,
} from "../../sync/e2ee/keyring";
import { deriveVaultKeys } from "../../sync/e2ee/keys";
import { deriveMasterKey } from "../../sync/e2ee/kdf";
import { ageEncrypt, generateIdentity } from "../../sync/e2ee/age";
import { decodeHeader, HEADER_NAME } from "../../sync/e2ee/header";
import {
  b64u,
  caught,
  dec,
  deviceOn,
  enc,
  forcePut,
  fromB64u,
  getObj,
  ignoresConditions,
  ITER,
  newVault,
  opaqueNames,
  PASS,
  passphraseDevice,
  POLICY,
  providerFrom,
  sha256hex,
  snapshot,
  switchable,
} from "./_e2eeHarness";

const vectors = JSON.parse(readFileSync("docs/sync-protocol-vectors.json", "utf8")) as {
  vaults: Array<{
    name: string;
    passphrase: string;
    objects: Record<string, string>;
    expect: { epoch: number; files: Record<string, string> };
    device?: { id: string; identity: string; recipient: string };
    pending?: { oldPassphrase: string; oldEpoch: number; oldFiles: string[] };
  }>;
};
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function vectorProvider(i: number) {
  const p = memoryProvider();
  for (const [k, v] of Object.entries(vectors.vaults[i].objects)) await p.put(k, b64(v));
  return p;
}

/** §5: digest = sha256hex(JSON.stringify([format, protocol, vaultId, epoch, passphrase.n, passphrase.c, sealed.n, sealed.c, header ?? null, prev ?? null])). */
function specDigest(f: KeyringFile): Promise<string> {
  return sha256hex(JSON.stringify([f.format, f.protocol, f.vaultId, f.epoch, f.passphrase.n, f.passphrase.c, f.sealed.n, f.sealed.c, f.header ?? null, f.prev ?? null]));
}

async function keyringFile(p: { get(n: string): Promise<{ data: Uint8Array } | null> }): Promise<KeyringFile> {
  const o = await p.get(KEYRING_NAME);
  if (!o) throw new Error("no keyring");
  return decodeKeyring(o.data);
}

/**
 * A vault at epoch 1 with its creator and one more device enrolled by key. An enrollment is
 * a same-epoch keyring rewrite (rev + 1, spec §5) and there is no keyring at epoch 0, so the
 * vault is re-keyed once first (the engine says so: "enroll devices after the first re-key").
 */
async function vaultWithDevice() {
  const v = await newVault();
  await v.creator.engine.rekey();
  const id = await generateIdentity();
  await v.creator.engine.enroll("phone", id.recipient);
  const { keys: phoneKeys } = await unlockWithDevice(v.provider, "phone", id.identity);
  const phone = deviceOn(v.provider, phoneKeys, { access: { device: "phone", identity: id.identity } });
  return { ...v, id, phone };
}

describe("blind: keyring format and digest (W10.D18)", () => {
  it("K1 epoch 0 has no keyring; the first re-key writes `lumen-e2ee-keyring` at epoch 1, protocol 2", async () => {
    const { provider, creator } = await newVault();
    expect(await provider.get(KEYRING_NAME)).toBeNull();
    expect(KEYRING_NAME).toBe("lumen-e2ee-keyring");
    const r = await creator.engine.rekey();
    expect(r.epoch).toBe(1);
    expect(r.confirmed).toBe(true);
    const f = await keyringFile(provider);
    expect(f.format).toBe("lumen-e2ee-keyring");
    expect(f.protocol).toBe(KEYRING_PROTOCOL);
    expect(KEYRING_PROTOCOL).toBe(2);
    expect(f.epoch).toBe(1);
    expect(f.vaultId).toBe(creator.engine.keys().vaultId);
    expect(creator.engine.keys().epoch).toBe(1);
  });

  it("K2 the keyring digest is the spec's formula (own vault and the spec's vault 2 vector)", async () => {
    const { provider, creator } = await newVault();
    await creator.engine.rekey();
    const f = await keyringFile(provider);
    expect(await keyringDigest(f)).toBe(await specDigest(f));
    const read = await readKeyring(provider);
    expect(read!.digest).toBe(await specDigest(f));
    const v2 = decodeKeyring(b64(vectors.vaults[1].objects[KEYRING_NAME]));
    expect(await keyringDigest(v2)).toBe(await specDigest(v2));
  });

  it("K3 the plaintext device map is not in the digest (an edit there is not another keyring)", async () => {
    const { provider, creator } = await vaultWithDevice();
    await creator.engine.rekey();
    const f = await keyringFile(provider);
    const g: KeyringFile = { ...f, devices: { ...f.devices, other: { recipient: "age1zzz", wrap: "AAAA" } } };
    expect(await keyringDigest(g)).toBe(await keyringDigest(f));
    const h: KeyringFile = { ...f, sealed: { ...f.sealed, c: f.sealed.c.slice(0, -2) + "AA" } };
    expect(await keyringDigest(h)).not.toBe(await keyringDigest(f));
  });

  it("K4 the chain: a new epoch has rev 0 and names its parent last; a same-epoch rewrite is rev + 1 with [N, rev − 1, parent]", async () => {
    const { provider, creator } = await newVault();
    await creator.engine.rekey();
    const d1 = (await readKeyring(provider))!.digest;
    await creator.engine.rekey();
    const k2 = creator.engine.keys();
    const c2 = await keyringContents(await keyringFile(provider), k2);
    expect(c2.rev).toBe(0);
    expect(c2.parent).toBe(d1);
    expect(c2.chain[c2.chain.length - 1]).toEqual([1, 0, d1]);
    expect(c2.manifest).toMatch(/^manifest\/2\/[A-Za-z0-9_-]{22}$/);
    const d2 = (await readKeyring(provider))!.digest;
    const id = await generateIdentity();
    await creator.engine.enroll("tablet", id.recipient);
    const c3 = await keyringContents(await keyringFile(provider), creator.engine.keys());
    expect(c3.rev).toBe(1);
    expect(c3.parent).toBe(d2);
    expect(c3.chain[c3.chain.length - 1]).toEqual([2, 0, d2]);
    expect(c3.devices.tablet).toBe(id.recipient);
    expect(CHAIN_LENGTH).toBe(64);
    expect(ABORTED_LENGTH).toBe(16);
  });

  it("K5 `older` holds every earlier epoch's secret, \"0\" included, and S0 is the passphrase master", async () => {
    const { provider, header, creator } = await newVault();
    await creator.engine.rekey();
    await creator.engine.rekey();
    const c = await keyringContents(await keyringFile(provider), creator.engine.keys());
    expect(Object.keys(c.older).sort()).toEqual(["0", "1"]);
    const master = await deriveMasterKey(PASS.normalize("NFC"), decodeHeader((await getObj(provider, HEADER_NAME)).data, POLICY).kdf);
    expect(c.older["0"]).toBe(b64u(master));
    expect(header.vaultId).toBe(creator.engine.keys().vaultId);
  });

  it("K6 every non-fixed object name is 43 characters, before and after re-keys", async () => {
    const { provider, creator } = await newVault();
    creator.files.set("a.md", "one");
    await creator.engine.sync();
    await creator.engine.rekey();
    creator.files.set("b.md", "two");
    await creator.engine.sync();
    for (const n of await opaqueNames(provider)) expect(n).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("blind: rotation keeps every note, uploads none (W10.D18)", () => {
  it("K7 a re-key writes only the frozen manifest, the new manifest and the keyring; no blob changes", async () => {
    const { provider, creator } = await newVault();
    for (let i = 0; i < 5; i++) creator.files.set(`n${i}.md`, `note ${i}`);
    await creator.engine.sync();
    const before = snapshot(provider);
    const r = await creator.engine.rekey();
    expect(r.written).toHaveLength(3);
    expect(r.written).toContain(KEYRING_NAME);
    const after = snapshot(provider);
    let changed = 0;
    for (const [k, v] of before) {
      const w = after.get(k);
      if (!w || b64u(w) !== b64u(v)) {
        changed++;
        expect(r.written).toContain(k);
      }
    }
    expect(changed).toBeLessThanOrEqual(2); // header untouched; only the manifest (frozen) of the old epoch
    const fresh = await passphraseDevice(provider);
    await fresh.engine.sync();
    for (let i = 0; i < 5; i++) expect(fresh.files.text(`n${i}.md`)).toBe(`note ${i}`);
  });

  it("K8 the spec's vectors open: vault 2 (epochs 0–2) by passphrase and by device key, vault 3 (frozen), vault 4 (pending passphrase change, both passphrases)", async () => {
    const check = async (i: number, pass: string, want: Record<string, string>, epoch: number) => {
      const p = await vectorProvider(i);
      const { keys } = await unlockVault(p, pass, { minPbkdf2Iterations: 1000 });
      expect(keys.epoch).toBe(epoch);
      const d = deviceOn(p, keys);
      await d.engine.sync();
      for (const [path, text] of Object.entries(want)) expect(d.files.text(path)).toBe(text);
      return d;
    };
    const v2 = vectors.vaults[1];
    await check(1, v2.passphrase, v2.expect.files, 2);
    const p2 = await vectorProvider(1);
    const { keys: dk } = await unlockWithDevice(p2, v2.device!.id, v2.device!.identity);
    expect(dk.epoch).toBe(2);
    const dev = deviceOn(p2, dk, { access: { device: v2.device!.id, identity: v2.device!.identity } });
    await dev.engine.sync();
    for (const [path, text] of Object.entries(v2.expect.files)) expect(dev.files.text(path)).toBe(text);
    await check(2, vectors.vaults[2].passphrase, vectors.vaults[2].expect.files, 1);
    const v4 = vectors.vaults[3];
    await check(3, v4.passphrase, v4.expect.files, 2);
    const pOld = await vectorProvider(3);
    const { keys: oldKeys } = await unlockVault(pOld, v4.pending!.oldPassphrase, { minPbkdf2Iterations: 1000 });
    expect(oldKeys.epoch).toBe(v4.pending!.oldEpoch);
  }, 600_000);

  it("K9 a finished passphrase change: the new passphrase opens the vault, the old one is refused, the vault id stays", async () => {
    const { provider, creator } = await newVault();
    creator.files.set("a.md", "kept");
    await creator.engine.sync();
    const vid = creator.engine.keys().vaultId;
    const r = await creator.engine.rekey({ newPassphrase: "the new passphrase 2026", pbkdf2Iterations: ITER });
    expect(r.written).toContain(HEADER_NAME);
    await creator.engine.sync();
    await expect(unlockVault(provider, PASS, POLICY)).rejects.toBeInstanceOf(WrongPassphraseError);
    const d = await passphraseDevice(provider, { passphrase: "the new passphrase 2026" });
    expect(d.engine.keys().vaultId).toBe(vid);
    await d.engine.sync();
    expect(d.files.text("a.md")).toBe("kept");
    const h = decodeHeader((await getObj(provider, HEADER_NAME)).data, POLICY);
    expect(h.kdf.alg).toBe("pbkdf2-sha256"); // the KDF family is kept
    expect(JSON.parse(dec.decode((await getObj(provider, KEYRING_NAME)).data)).header).toBeUndefined();
  });
});

describe("blind: revocation (W10.D18)", () => {
  it("K10 a revoked device can't open the keyring (RevokedError), nor a manifest written after", async () => {
    const { provider, creator, id, phone } = await vaultWithDevice();
    await phone.engine.sync();
    const oldKeys = phone.engine.keys();
    const r = await creator.engine.rekey({ revoke: ["phone"] });
    expect(r.devices).not.toContain("phone");
    await expect(unlockWithDevice(provider, "phone", id.identity)).rejects.toBeInstanceOf(RevokedError);
    expect(await caught(() => phone.engine.sync())).toBeInstanceOf(RevokedError);
    // The new epoch's manifest doesn't open with what the phone held.
    creator.files.set("after.md", "written after the revocation");
    await creator.engine.sync();
    const { openManifest, manifestNameFor } = await import("../../sync/e2ee/manifest");
    const ck = creator.engine.keys();
    const name = await manifestNameFor(ck, ck.ring!.manifest);
    const o = await getObj(provider, name);
    await expect(openManifest(ck, o.data, name)).resolves.toBeTruthy();
    await expect(openManifest(oldKeys, o.data, name)).rejects.toThrow();
  });

  it("K11 a revoked id, or a revoked key under a new id, is never enrolled again", async () => {
    const { creator, id } = await vaultWithDevice();
    await creator.engine.rekey({ revoke: ["phone"] });
    expect(await caught(() => creator.engine.enroll("phone", id.recipient))).toBeInstanceOf(RevokedDeviceEnrollError);
    expect(await caught(() => creator.engine.enroll("phone-2", id.recipient))).toBeInstanceOf(Error);
    const other = await generateIdentity();
    expect(await caught(() => creator.engine.enroll("phone", other.recipient))).toBeInstanceOf(Error);
  });

  it("K12 a re-key from the passphrase lists the revoked device in the sealed `revoked` list, and it stays there at later epochs", async () => {
    const { provider, creator } = await vaultWithDevice();
    await creator.engine.rekey({ revoke: ["phone"] });
    await creator.engine.rekey();
    await creator.engine.rekey();
    const c = await keyringContents(await keyringFile(provider), creator.engine.keys());
    expect(c.revoked.map((r) => r.device)).toContain("phone");
    expect(Object.keys(c.devices)).not.toContain("phone");
    expect(Object.keys((await keyringFile(provider)).devices)).not.toContain("phone");
  });

  it("K13 the storage can't re-admit a revoked device: a keyring rewritten by a holder of the epoch's secret that lets it back in is revoked again, or the round names it at risk", async () => {
    const { provider, creator, id } = await vaultWithDevice();
    const laptop = await passphraseDevice(provider, { confirm: true });
    await creator.engine.rekey({ revoke: ["phone"] });
    await creator.engine.sync();
    await laptop.engine.sync();
    // The laptop (it holds S_N and the storage login) rewrites the keyring at the same epoch,
    // putting the phone back on the sealed list and off the revoked list.
    const { rewriteKeyring } = await import("../../sync/e2ee/keyring");
    const { ageEncrypt: enc2 } = await import("../../sync/e2ee/age");
    const lk = laptop.engine.keys();
    await rewriteKeyring(provider, lk, lk.wrap ? { wrap: lk.wrap } : null, async (c, f) => ({
      contents: { ...c, devices: { ...c.devices, phone: id.recipient }, revoked: c.revoked.filter((r) => r.device !== "phone") },
      file: { ...f, devices: { ...f.devices, phone: { recipient: id.recipient, wrap: b64u(await enc2(lk.secret, [{ x25519: id.recipient }])) } } },
    }));
    const err = await caught(() => creator.engine.sync());
    const named = err instanceof KeyringForkError ? [...err.revocationReapplied, ...err.revocationAtRisk] : [];
    const phoneStillOut = (await caught(() => unlockWithDevice(provider, "phone", id.identity))) instanceof RevokedError;
    // Either the creator revoked it again on top (the phone can't open the live keyring) or it says so.
    expect(phoneStillOut || named.includes("phone")).toBe(true);
  });

  it("K14 a wrap the storage replaced (it opens, but its secret doesn't open the keyring) is TamperedWrapError, not RevokedError", async () => {
    const { provider, creator, id } = await vaultWithDevice();
    await creator.engine.rekey();
    const f = await keyringFile(provider);
    const forged = await ageEncrypt(crypto.getRandomValues(new Uint8Array(32)), [{ x25519: id.recipient }]);
    const g = { ...f, devices: { ...f.devices, phone: { recipient: id.recipient, wrap: b64u(forged) } } };
    await forcePut(provider, KEYRING_NAME, enc.encode(JSON.stringify(g)));
    const e = await caught(() => unlockWithDevice(provider, "phone", id.identity));
    expect(e).toBeInstanceOf(TamperedWrapError);
    expect(e).not.toBeInstanceOf(RevokedError);
  });

  it("K15 a forged dropped marker (bad MAC) doesn't turn a revocation into 'pair again'", async () => {
    const { provider, creator, id, phone } = await vaultWithDevice();
    await phone.engine.sync();
    await creator.engine.rekey({ revoke: ["phone"] });
    const f = await keyringFile(provider);
    const g: KeyringFile = { ...f, dropped: [{ epoch: f.epoch, at: Date.now(), devices: ["phone"], mac: b64u(new Uint8Array(32).fill(1)) }] };
    await forcePut(provider, KEYRING_NAME, enc.encode(JSON.stringify(g)));
    const e = await caught(() => phone.engine.sync());
    expect(e).toBeInstanceOf(RevokedError);
    expect(e).not.toBeInstanceOf(DroppedFromVaultError);
    void id;
  });
});

describe("blind: descent — rollback and fork (W10.D18)", () => {
  it("K16 the storage replays an older epoch's keyring: KeyringRollbackError", async () => {
    const sp = switchable();
    const { creator } = await newVault(sp);
    await creator.engine.rekey();
    const epoch1 = snapshot(sp.view);
    await creator.engine.rekey();
    await creator.engine.sync();
    sp.view = await providerFrom(epoch1);
    expect(await caught(() => creator.engine.sync())).toBeInstanceOf(KeyringRollbackError);
  });

  it("K17 the storage replays a lower revision at the same epoch: KeyringRollbackError", async () => {
    const sp = switchable();
    const { creator } = await newVault(sp);
    await creator.engine.rekey();
    const rev0 = (await getObj(sp, KEYRING_NAME)).data;
    const id = await generateIdentity();
    await creator.engine.enroll("tablet", id.recipient);
    await creator.engine.sync();
    await forcePut(sp, KEYRING_NAME, rev0);
    expect(await caught(() => creator.engine.sync())).toBeInstanceOf(KeyringRollbackError);
  });

  it("K18 two sibling re-keys from the same keyring: a device anchored on one refuses the other (KeyringForkError)", async () => {
    const sp = switchable();
    const { creator } = await newVault(sp);
    await creator.engine.rekey();
    await creator.engine.sync();
    const fork = await providerFrom(snapshot(sp.view));
    // The creator re-keys on the live storage...
    await creator.engine.rekey();
    await creator.engine.sync();
    // ...and another holder of epoch 1 re-keys on the copy the storage kept.
    const other = await passphraseDevice(fork, { confirm: true });
    await other.engine.rekey();
    sp.view = fork;
    expect(await caught(() => creator.engine.sync())).toBeInstanceOf(KeyringForkError);
  });

  it("K19 the storage builds a whole keyring for a device's public key (N1): the device's anchor refuses it", async () => {
    const sp = switchable();
    const { creator } = await newVault(sp);
    const id = await generateIdentity();
    await creator.engine.rekey();
    await creator.engine.enroll("phone", id.recipient);
    await creator.engine.rekey();
    const { keys: pk } = await unlockWithDevice(sp, "phone", id.identity);
    const store = memoryStateStore();
    const phone = deviceOn(sp, pk, { store, access: { device: "phone", identity: id.identity } });
    await phone.engine.sync();
    // The storage knows the vault id and the phone's recipient, not any secret: it makes its own
    // epochs 1..4 from a master it chose, each wrapped for the phone.
    const vaultId = pk.vaultId;
    let keys = await deriveVaultKeys(crypto.getRandomValues(new Uint8Array(32)), vaultId);
    let current: Awaited<ReturnType<typeof readKeyring>> = null;
    const scratch = memoryProvider();
    for (let i = 0; i < 4; i++) {
      const prep = await prepareEpoch(current, keys, { enroll: { phone: id.recipient } });
      await scratch.put(KEYRING_NAME, prep.bytes);
      current = await readKeyring(scratch);
      keys = prep.keys;
    }
    await forcePut(sp, KEYRING_NAME, (await getObj(scratch, KEYRING_NAME)).data);
    const viaOpen = await caught(() => unlockWithDevice(sp, "phone", id.identity, store.state));
    expect(viaOpen).toBeInstanceOf(KeyringForkError);
    expect(await caught(() => phone.engine.sync())).toBeInstanceOf(KeyringForkError);
  });

  it("K20 a keyring from another vault, or with a pre-release protocol, is refused", async () => {
    const a = await newVault();
    await a.creator.engine.rekey();
    const b = await newVault();
    await b.creator.engine.rekey();
    await forcePut(a.provider, KEYRING_NAME, (await getObj(b.provider, KEYRING_NAME)).data);
    expect(await caught(() => a.creator.engine.sync())).toBeInstanceOf(Error);
    const c = await newVault();
    await c.creator.engine.rekey();
    const f = await keyringFile(c.provider);
    await forcePut(c.provider, KEYRING_NAME, enc.encode(JSON.stringify({ ...f, protocol: 1 })));
    const e = await caught(() => unlockVault(c.provider, PASS, POLICY));
    expect(e).toBeInstanceOf(DecryptError);
  });
});

describe("blind: who may change keys (W10.D18)", () => {
  it("K21 an unverified device can't enroll (UnverifiedDeviceError)", async () => {
    const { provider } = await newVault();
    const d = await passphraseDevice(provider);
    await d.engine.sync();
    expect((await d.engine.freshness()).verified).toBe(false);
    const id = await generateIdentity();
    expect(await caught(() => d.engine.enroll("tablet", id.recipient))).toBeInstanceOf(UnverifiedDeviceError);
  });

  it("K22 an unverified device's re-key that would leave devices out needs consent (DropDevicesRequiredError naming them); with it, they get 'pair again'", async () => {
    const { provider, phone } = await vaultWithDevice();
    await phone.engine.sync();
    const d = await passphraseDevice(provider);
    await d.engine.sync();
    const e = await caught(() => d.engine.rekey());
    expect(e).toBeInstanceOf(DropDevicesRequiredError);
    expect((e as DropDevicesRequiredError).devices).toContain("phone");
    const r = await d.engine.rekey({ dropDevices: true });
    expect(r.dropped).toBe(true);
    expect(r.devices).not.toContain("phone");
    expect(await caught(() => phone.engine.sync())).toBeInstanceOf(DroppedFromVaultError);
  });

  it("K23 a storage that ignores conditional writes syncs, but key and device changes are refused (CasUnsupportedError)", async () => {
    const inner = memoryProvider();
    const v = await newVault(inner);
    const loose = ignoresConditions(inner);
    const d = deviceOn(loose, v.keys, { store: v.creator.store, files: v.creator.files });
    d.files.set("a.md", "still syncs");
    await d.engine.sync();
    expect(await caught(() => d.engine.rekey())).toBeInstanceOf(CasUnsupportedError);
    const id = await generateIdentity();
    expect(await caught(() => d.engine.enroll("tablet", id.recipient))).toBeInstanceOf(CasUnsupportedError);
    expect(await inner.get(KEYRING_NAME)).toBeNull();
  });

  it("K24 a storage whose create-only isn't atomic (atomicCreate: false, Google Drive) is sync-only", async () => {
    const inner = memoryProvider();
    const v = await newVault(inner);
    const drive = { id: "gdrive", atomicCreate: false, get: inner.get, put: inner.put, delete: inner.delete, list: inner.list };
    const d = deviceOn(drive, v.keys, { store: v.creator.store, files: v.creator.files });
    d.files.set("a.md", "syncs");
    await d.engine.sync();
    expect(await caught(() => d.engine.rekey())).toBeInstanceOf(CasUnsupportedError);
  });

  it("K25 read-back (N2): a storage that lets another keyring replace the commit reports the re-key not confirmed, and the next round sees a fork", async () => {
    const inner = memoryProvider();
    const v = await newVault(inner);
    await v.creator.engine.rekey();
    await v.creator.engine.sync();
    const sibling = await providerFrom(snapshot(inner));
    const other = await passphraseDevice(sibling, { confirm: true });
    await other.engine.rekey();
    const siblingBytes = (await getObj(sibling, KEYRING_NAME)).data;
    const siblingObjects = snapshot(sibling);
    // Right after this device's keyring commit lands, the storage swaps the sibling's in.
    let swapped = false;
    const sneaky = {
      id: "memory",
      get: inner.get,
      list: inner.list,
      delete: inner.delete,
      put: async (n: string, d: Uint8Array, c?: Parameters<typeof inner.put>[2]) => {
        const r = await inner.put(n, d, c);
        if (n === KEYRING_NAME && !swapped) {
          swapped = true;
          for (const [k, val] of siblingObjects) if (!(await inner.get(k))) await inner.put(k, val);
          await inner.put(KEYRING_NAME, siblingBytes);
        }
        return r;
      },
    };
    const d = deviceOn(sneaky, v.creator.engine.keys(), { store: v.creator.store, files: v.creator.files });
    const r = await d.engine.rekey({ revoke: [] });
    expect(r.confirmed).toBe(false);
    expect(r.warning).toBeTruthy();
    expect(await caught(() => d.engine.sync())).toBeInstanceOf(KeyringForkError);
  });
});

void fromB64u;
