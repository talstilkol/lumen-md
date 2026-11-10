/**
 * The keyring (plan W1.7): key rotation and device revocation.
 *
 * Without a keyring (every vault before plan W1.7) all keys come from the
 * passphrase: anyone who ever knew it, or kept the derived keys, can read the
 * vault for good. The keyring adds an *epoch secret*, 32 random bytes,
 * from which the manifest, blob and pairing keys of that epoch derive
 * (keys.ts `epochKeys`). It is stored at the provider under the fixed name
 * `lumen-e2ee-keyring`:
 *
 *   {
 *     format: "lumen-e2ee-keyring", protocol: 1, vaultId, epoch,
 *     passphrase: {n, c},          // AES-GCM(wrap key from the passphrase, secret)
 *     devices: { <id>: { recipient: "age1…", wrap: "<base64 age file of the secret>" } },
 *     sealed: {n, c}               // AES-GCM(epoch's keyring key, JSON {older, revoked, devices})
 *   }
 *
 * Every AES-GCM has the vault id, the epoch and its role as additional data,
 * so a wrap can't be moved to another epoch, vault or device. `older` holds the
 * secrets of all earlier epochs, so blobs written before a re-key stay
 * readable: a re-key re-seals the manifest and nothing else, with no blob
 * downloaded or uploaded again.
 *
 * Re-key (`rekey`): a new epoch, wrapped for the passphrase (the same, or a
 * new one) and for every enrolled device except those revoked. A device
 * that was revoked can't unwrap the new secret, so it can't read a manifest
 * written after its revocation. If the revoked device's user also knows the
 * passphrase, change the passphrase in the same re-key.
 *
 * Rollback: a device remembers the highest epoch it has seen and refuses a
 * keyring with a lower one (the provider can't hand back an old keyring that
 * still wraps the secret for a revoked device).
 */

import { bs, fromB64u, fromUtf8, randomBytes, toB64u, utf8 } from "./bytes";
import { ageDecrypt, ageEncrypt } from "./age";
import { blobKey, DecryptError, epochKeys, namesKey, passphraseKeys, type VaultKeys } from "./keys";
import { PreconditionFailedError, type StoredObject, type SyncProvider } from "./provider";

export const KEYRING_NAME = "lumen-e2ee-keyring";
const FORMAT = "lumen-e2ee-keyring";
const PROTOCOL = 1;

interface Sealed {
  n: string;
  c: string;
}

export interface DeviceWrap {
  /** The device's age X25519 recipient (its public key). */
  recipient: string;
  /** The epoch secret, as an age file to that recipient (base64url). */
  wrap: string;
}

export interface KeyringFile {
  format: typeof FORMAT;
  protocol: number;
  vaultId: string;
  epoch: number;
  passphrase: Sealed;
  devices: Record<string, DeviceWrap>;
  sealed: Sealed;
}

export interface KeyringContents {
  /** Secrets of the earlier epochs, base64url, by epoch. */
  older: Record<string, string>;
  /** Devices revoked so far, with the epoch that shut them out. */
  revoked: Array<{ device: string; epoch: number; at: number }>;
}

export class RevokedError extends Error {
  constructor() {
    super("This device was removed from the vault: it can't open the current keys");
    this.name = "RevokedError";
  }
}

export class KeyringRollbackError extends Error {
  constructor(
    public readonly seen: number,
    public readonly got: number,
  ) {
    super(`The provider returned keyring epoch ${got}, older than ${seen} seen before — refused (rollback)`);
    this.name = "KeyringRollbackError";
  }
}

/* ─── AES-GCM with role-bound additional data ──────────────────────────── */

const aad = (vaultId: string, epoch: number, role: string) => utf8(`lumen-e2ee-keyring/${PROTOCOL}/${vaultId}/${epoch}/${role}`);

async function sealWith(key: CryptoKey, data: Uint8Array, ad: Uint8Array): Promise<Sealed> {
  const n = randomBytes(12);
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(n), additionalData: bs(ad) }, key, bs(data)));
  return { n: toB64u(n), c: toB64u(c) };
}

async function openWith(key: CryptoKey, s: Sealed, ad: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(fromB64u(s.n)), additionalData: bs(ad) }, key, bs(fromB64u(s.c))));
  } catch {
    throw new DecryptError("The keyring could not be opened: wrong key, or it was changed");
  }
}

/* ─── Reading ──────────────────────────────────────────────────────────── */

export function decodeKeyring(bytes: Uint8Array): KeyringFile {
  let o: KeyringFile;
  try {
    o = JSON.parse(fromUtf8(bytes)) as KeyringFile;
  } catch {
    throw new DecryptError("The keyring is not JSON");
  }
  const sealedOk = (s: unknown) => !!s && typeof (s as Sealed).n === "string" && typeof (s as Sealed).c === "string";
  if (o?.format !== FORMAT || o.protocol !== PROTOCOL || typeof o.vaultId !== "string" || !Number.isSafeInteger(o.epoch) || o.epoch < 1 || !sealedOk(o.passphrase) || !sealedOk(o.sealed) || !o.devices || typeof o.devices !== "object") {
    throw new DecryptError("Not a Lumen keyring");
  }
  return o;
}

export async function readKeyring(provider: SyncProvider): Promise<{ file: KeyringFile; etag: string } | null> {
  const obj: StoredObject | null = await provider.get(KEYRING_NAME);
  return obj ? { file: decodeKeyring(obj.data), etag: obj.etag } : null;
}

/** How this device opens the keyring: the passphrase's wrap key, or its own age identity. */
export type KeyAccess = { wrap: CryptoKey } | { device: string; identity: string };

/** The epoch secret of `file`, through `access`. RevokedError when the device has no wrap. */
export async function unwrapSecret(file: KeyringFile, access: KeyAccess): Promise<Uint8Array> {
  if ("wrap" in access) return openWith(access.wrap, file.passphrase, aad(file.vaultId, file.epoch, "passphrase"));
  const d = file.devices[access.device];
  if (!d) throw new RevokedError();
  try {
    return await ageDecrypt(fromB64u(d.wrap), [{ identity: access.identity }]);
  } catch {
    throw new RevokedError();
  }
}

/**
 * The vault's keys at the keyring's epoch. `base` supplies what the epoch
 * doesn't: the header and wrap keys of the passphrase (when opened with it).
 */
export async function keysFromKeyring(file: KeyringFile, secret: Uint8Array, base: Pick<VaultKeys, "header" | "wrap">): Promise<VaultKeys> {
  const e = await epochKeys(secret, file.vaultId);
  const contents = JSON.parse(fromUtf8(await openWith(e.keyring, file.sealed, aad(file.vaultId, file.epoch, "sealed")))) as KeyringContents;
  const olderSecrets = new Map<number, Uint8Array>();
  for (const [k, v] of Object.entries(contents.older ?? {})) olderSecrets.set(Number(k), fromB64u(v));
  const secret0 = olderSecrets.get(0);
  if (!secret0) throw new DecryptError("The keyring has no epoch 0");
  const olderBlobs = new Map<number, CryptoKey>();
  for (const [ep, s] of olderSecrets) olderBlobs.set(ep, (await epochKeys(s, file.vaultId)).blobs);
  return { vaultId: file.vaultId, header: base.header, wrap: base.wrap, names: await namesKey(secret0, file.vaultId), ...e, epoch: file.epoch, secret, olderBlobs, olderSecrets };
}

/** The revocation list of the keyring the keys came from. */
export async function keyringContents(file: KeyringFile, keys: VaultKeys): Promise<KeyringContents> {
  return JSON.parse(fromUtf8(await openWith(keys.keyring, file.sealed, aad(file.vaultId, file.epoch, "sealed")))) as KeyringContents;
}

/**
 * Bring `keys` up to the provider's keyring. Returns the same keys when the
 * epoch is unchanged (or there is no keyring and the keys are epoch 0), new
 * keys for a newer epoch. Throws KeyringRollbackError for an older one,
 * RevokedError when this device can't open the new epoch.
 */
export async function refreshKeys(provider: SyncProvider, keys: VaultKeys, access: KeyAccess, seenEpoch = keys.epoch): Promise<VaultKeys> {
  const k = await readKeyring(provider);
  if (!k) {
    if (seenEpoch > 0) throw new KeyringRollbackError(seenEpoch, 0);
    return keys;
  }
  if (k.file.vaultId !== keys.vaultId) throw new DecryptError("The keyring belongs to another vault");
  if (k.file.epoch < seenEpoch) throw new KeyringRollbackError(seenEpoch, k.file.epoch);
  if (k.file.epoch === keys.epoch) return keys;
  return keysFromKeyring(k.file, await unwrapSecret(k.file, access), keys);
}

/* ─── Writing ──────────────────────────────────────────────────────────── */

export interface RekeyOptions {
  /** Devices to shut out: their wrap is not carried over to the new epoch. */
  revoke?: string[];
  /** Devices to add (or keep with a new key): id → age recipient. */
  enroll?: Record<string, string>;
  /** A new passphrase's master key material (header.ts derives it with fresh KDF parameters). */
  newPassphraseMaster?: Uint8Array;
  now?: () => number;
}

/**
 * Write the keyring for a new epoch, with compare-and-swap on the one read.
 * Returns the new keys. The caller re-seals the manifest under them
 * (`E2eeSync.rekey`), and writes the new header if the passphrase changed.
 */
export async function writeNewEpoch(provider: SyncProvider, keys: VaultKeys, opts: RekeyOptions = {}): Promise<VaultKeys> {
  const current = await readKeyring(provider);
  if (current && current.file.epoch !== keys.epoch) throw new PreconditionFailedError(KEYRING_NAME);
  if (!current && keys.epoch !== 0) throw new KeyringRollbackError(keys.epoch, 0);
  const prior: KeyringContents = current ? await keyringContents(current.file, keys) : { older: {}, revoked: [] };
  const epoch = keys.epoch + 1;
  const secret = randomBytes(32);
  const older: Record<string, string> = { ...prior.older, [String(keys.epoch)]: toB64u(keys.secret) };
  const now = (opts.now ?? Date.now)();
  const revoke = new Set(opts.revoke ?? []);
  const revoked = [...prior.revoked, ...[...revoke].map((device) => ({ device, epoch, at: now }))];
  // Who gets the new secret: the devices that had the last one, minus the revoked, plus the enrolled.
  const recipients = new Map<string, string>();
  for (const [id, d] of Object.entries(current?.file.devices ?? {})) if (!revoke.has(id)) recipients.set(id, d.recipient);
  for (const [id, r] of Object.entries(opts.enroll ?? {})) if (!revoke.has(id)) recipients.set(id, r);

  let wrap = keys.wrap;
  let header = keys.header;
  if (opts.newPassphraseMaster) ({ wrap, header } = await passphraseKeys(opts.newPassphraseMaster, keys.vaultId));
  if (!wrap) throw new Error("A re-key needs the passphrase (or a new one) on this device");

  const e = await epochKeys(secret, keys.vaultId);
  const devices: Record<string, DeviceWrap> = {};
  for (const [id, recipient] of recipients) devices[id] = { recipient, wrap: toB64u(await ageEncrypt(secret, [{ x25519: recipient }])) };
  const file: KeyringFile = {
    format: FORMAT,
    protocol: PROTOCOL,
    vaultId: keys.vaultId,
    epoch,
    passphrase: await sealWith(wrap, secret, aad(keys.vaultId, epoch, "passphrase")),
    devices,
    sealed: await sealWith(e.keyring, utf8(JSON.stringify({ older, revoked } satisfies KeyringContents)), aad(keys.vaultId, epoch, "sealed")),
  };
  await provider.put(KEYRING_NAME, utf8(JSON.stringify(file)), current ? { ifMatch: current.etag } : { ifNoneMatch: "*" });
  const olderSecrets = new Map(keys.olderSecrets);
  olderSecrets.set(keys.epoch, keys.secret);
  const olderBlobs = new Map(keys.olderBlobs);
  olderBlobs.set(keys.epoch, blobKey(keys, keys.epoch));
  return { ...keys, ...e, header, wrap, epoch, secret, olderSecrets, olderBlobs };
}

/** Keep the same epoch, add a device's wrap (an enrollment needs no re-key). */
export async function enrollDevice(provider: SyncProvider, keys: VaultKeys, device: string, recipient: string): Promise<void> {
  const current = await readKeyring(provider);
  if (!current) throw new Error("Enroll devices after the first re-key (the vault has no keyring yet)");
  if (current.file.epoch !== keys.epoch) throw new PreconditionFailedError(KEYRING_NAME);
  const next: KeyringFile = { ...current.file, devices: { ...current.file.devices, [device]: { recipient, wrap: toB64u(await ageEncrypt(keys.secret, [{ x25519: recipient }])) } } };
  await provider.put(KEYRING_NAME, utf8(JSON.stringify(next)), { ifMatch: current.etag });
}


/** The additional data of a keyring field (the spec's test vectors use it). */
export const keyringAad = aad;
