/**
 * Two parts of keyring.ts, moved verbatim so the file stays under the 800-line
 * limit (W10.E31: no baseline): the recovery and passkey wraps of an epoch
 * (W11.S8, W11.S10) and the parsing of the keyring's sealed part.
 */
import { bs, fromB64u, fromUtf8, toB64u, utf8 } from "./bytes";
import { ageDecrypt, ageEncrypt } from "./age";
import { DecryptError, hmac, type RingInfo } from "./keys";
import { isManifestLabel } from "./manifest";
import { recoveryKeys, RecoveryKeyError } from "./recovery";
import { PreReleaseKeyringError, TamperedWrapError } from "./keyringErrors";
import { CHAIN_LENGTH, keyringDigest, MAX_PASSKEYS, RECOVERY_PROTOCOL, type KeyringContents, type KeyringFile, type RecoveryWrap } from "./keyring";

/** What a recovery (`passkey` null) or passkey wrap's check covers. */
const recoveryData = (vaultId: string, epoch: number, digest: string, w: Pick<RecoveryWrap, "recipient" | "wrap">, passkey: string | null = null) =>
  utf8(JSON.stringify(passkey === null ? ["lumen-e2ee-recovery/1", vaultId, epoch, digest, w.recipient, w.wrap] : ["lumen-e2ee-passkey/1", vaultId, epoch, digest, passkey, w.recipient, w.wrap]));

/** The recovery (or passkey) wrap of an epoch: `secret` as an age file to the sealed recipient, and its check under the sealed MAC key. */
export async function recoveryWrap(vaultId: string, epoch: number, digest: string, secret: Uint8Array, sealed: { recipient: string; mac: string }, passkey: string | null = null): Promise<RecoveryWrap> {
  const wrap = toB64u(await ageEncrypt(secret, [{ x25519: sealed.recipient }]));
  const mac = await crypto.subtle.importKey("raw", bs(fromB64u(sealed.mac)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { recipient: sealed.recipient, wrap, check: toB64u(await hmac(mac, recoveryData(vaultId, epoch, digest, { recipient: sealed.recipient, wrap }, passkey))) };
}

/** Every passkey wrap of an epoch, from the sealed list. */
export async function passkeyWraps(vaultId: string, epoch: number, digest: string, secret: Uint8Array, sealed: Record<string, { recipient: string; mac: string }> | undefined): Promise<Record<string, RecoveryWrap> | undefined> {
  if (!sealed || !Object.keys(sealed).length) return undefined;
  const out: Record<string, RecoveryWrap> = {};
  for (const [id, s] of Object.entries(sealed)) out[id] = await recoveryWrap(vaultId, epoch, digest, secret, s, id);
  return out;
}

/**
 * The epoch secret through the recovery key: the wrap's check must verify
 * under the MAC key the recovery key gives (the storage can't make one),
 * then the age file opens with its identity. RecoveryKeyError when the
 * keyring has no recovery wrap, or it is for another key.
 */
export async function unwrapRecovery(file: KeyringFile, key: Uint8Array, passkey: string | null = null): Promise<Uint8Array> {
  const w = passkey === null ? file.recovery : file.passkeys?.[passkey];
  if (!w) throw new RecoveryKeyError(passkey === null ? "This vault has no recovery key set up" : "This passkey doesn't open this vault");
  const rk = await recoveryKeys(key, file.vaultId, passkey === null ? "recovery" : "passkey");
  if (rk.age.recipient !== w.recipient) throw new RecoveryKeyError(passkey === null ? undefined : "This passkey doesn't open this vault");
  let tag: Uint8Array;
  try {
    tag = fromB64u(w.check);
  } catch {
    throw new TamperedWrapError();
  }
  const mac = await crypto.subtle.importKey("raw", bs(fromB64u(rk.mac)), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("HMAC", mac, bs(tag), bs(recoveryData(file.vaultId, file.epoch, await keyringDigest(file), w, passkey))))) throw new TamperedWrapError();
  try {
    return await ageDecrypt(fromB64u(w.wrap), [{ identity: rk.age.identity }]);
  } catch {
    throw new TamperedWrapError();
  }
}

const isHex64 = (s: unknown) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

export function parseContents(bytes: Uint8Array, epoch: number, protocol: number): KeyringContents {
  let c: KeyringContents;
  try {
    c = JSON.parse(fromUtf8(bytes)) as KeyringContents;
  } catch {
    throw new DecryptError("The keyring's sealed part is not JSON");
  }
  if (!c || typeof c !== "object" || !c.older || typeof c.older !== "object" || !Array.isArray(c.revoked)) throw new DecryptError("Bad keyring contents");
  if (!c.devices || typeof c.devices !== "object" || Array.isArray(c.devices)) throw new PreReleaseKeyringError();
  if (!isManifestLabel(c.manifest) || c.manifest === "manifest" || !c.manifest.startsWith(`manifest/${epoch}/`)) throw new DecryptError("Bad keyring manifest label");
  if (!Number.isSafeInteger(c.rev) || c.rev < 0) throw new DecryptError("Bad keyring revision");
  if (c.parent !== null && !isHex64(c.parent)) throw new DecryptError("Bad keyring parent");
  const chain = c.chain;
  if (
    !Array.isArray(chain) ||
    chain.length > CHAIN_LENGTH ||
    !chain.every((h, i) => Array.isArray(h) && h.length === 3 && Number.isSafeInteger(h[0]) && Number.isSafeInteger(h[1]) && isHex64(h[2]) && (i === 0 || h[0] > chain[i - 1][0] || (h[0] === chain[i - 1][0] && h[1] > chain[i - 1][1])))
  ) {
    throw new DecryptError("Bad keyring chain");
  }
  const last = chain[chain.length - 1];
  if ((c.parent === null) !== (chain.length === 0) || (last && (last[2] !== c.parent || last[0] > epoch || (last[0] === epoch && last[1] >= c.rev)))) throw new DecryptError("Bad keyring chain");
  if (c.rev > 0 && (!last || last[0] !== epoch || last[1] !== c.rev - 1)) throw new DecryptError("Bad keyring chain");
  if (c.carry !== undefined && (!c.carry || !isManifestLabel(c.carry.label) || !Number.isSafeInteger(c.carry.epoch) || typeof c.carry.digest !== "string")) throw new DecryptError("Bad keyring carry");
  if (c.header !== undefined && !isHex64(c.header)) throw new DecryptError("Bad keyring header");
  if (c.aborted !== undefined && (!Array.isArray(c.aborted) || !c.aborted.every((d) => typeof d === "string"))) throw new DecryptError("Bad keyring aborted list");
  const unlockerOk = (u: unknown) => !!u && typeof (u as { recipient: unknown }).recipient === "string" && typeof (u as { mac: unknown }).mac === "string";
  if (c.recovery !== undefined && (protocol < RECOVERY_PROTOCOL || !unlockerOk(c.recovery))) throw new DecryptError("Bad keyring recovery");
  if (c.passkeys !== undefined && (protocol < RECOVERY_PROTOCOL || !c.passkeys || typeof c.passkeys !== "object" || Array.isArray(c.passkeys) || Object.keys(c.passkeys).length > MAX_PASSKEYS || !Object.values(c.passkeys).every(unlockerOk))) throw new DecryptError("Bad keyring passkeys");
  return c;
}

/** A pre-release keyring's sealed part, read only to reset it: its device list is never used. */
export function parsePreRelease(bytes: Uint8Array): KeyringContents {
  let c: { older?: unknown; revoked?: unknown };
  try {
    c = JSON.parse(fromUtf8(bytes)) as typeof c;
  } catch {
    throw new DecryptError("The keyring's sealed part is not JSON");
  }
  if (!c || !c.older || typeof c.older !== "object" || !Array.isArray(c.revoked)) throw new DecryptError("Bad keyring contents");
  const raw = c as unknown as { manifest?: unknown };
  const manifest = isManifestLabel(raw.manifest) ? raw.manifest : "manifest";
  return { older: c.older as Record<string, string>, revoked: c.revoked as KeyringContents["revoked"], devices: {}, manifest, rev: 0, parent: null, chain: [] };
}

export function ringInfo(c: KeyringContents, digest: string, preRelease = false): RingInfo {
  return {
    manifest: c.manifest,
    rev: c.rev,
    digest,
    ...(c.carry ? { carry: c.carry } : {}),
    ...(c.header ? { header: c.header } : {}),
    aborted: c.aborted ?? [],
    ...(preRelease ? { preRelease: true as const } : {}),
    enrolled: { ...c.devices },
    revoked: c.revoked.map((r) => ({ device: r.device, ...(r.recipient ? { recipient: r.recipient } : {}) })),
    ...(c.recovery ? { recovery: c.recovery.recipient } : {}),
    ...(c.passkeys && Object.keys(c.passkeys).length ? { passkeys: Object.keys(c.passkeys).sort() } : {}),
  };
}
