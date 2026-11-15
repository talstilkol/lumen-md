/**
 * The signed write envelope of a role vault (plan W12.S4). The relay
 * (sync-server/vault-relay-roles.js) refuses any write to a role space that
 * doesn't carry one from a current member's key, and every reader checks the
 * same signature again on read, so neither the relay nor a reader holding the
 * read key can slip in an object no writer made.
 *
 *   envelope = "LRS1" ‖ op (0 put, 1 delete) ‖ signer (32) ‖ ctr (8, BE)
 *              ‖ aclSeq (4, BE) ‖ condLen (1) ‖ cond ‖ sig (64) ‖ payload
 *   signed   = "lumen-role v1\n<space>\n<put|del>\n<name>\n<cond>\n<ctr>\n<aclSeq>\n" ‖ SHA-256(payload)
 *   cond     = "" | "none:*" | "match:<etag>"   (the write's own condition)
 *
 * - The signature binds the space, the object name, the operation and the
 *   condition, so a captured write can't be sent to another space or name,
 *   or as an unconditional overwrite.
 * - ctr only grows per key (the relay keeps the last one), so a captured
 *   write can't be sent again.
 * - aclSeq is the ACL the writer saw: after a revocation nothing signed under
 *   the earlier ACL lands.
 *
 * Signing keys are Ed25519 through WebCrypto (the browser's own, audited
 * implementation, plan R3.5: Ed25519 stays on WebCrypto), generated
 * non-extractable: the private key never leaves the device.
 */

import { bs, concat, equalBytes, fromB64u, toB64u, utf8 } from "../bytes";
import type { PutCondition } from "../provider";

const MAGIC = utf8("LRS1");
const HEAD = 4 + 1 + 32 + 8 + 4 + 1;
const SIG = 64;
const MAX_COND = 100;

export type EnvelopeOp = "put" | "del";

/** An Ed25519 signing key of this device: the private half is a non-extractable CryptoKey. */
export interface Signer {
  /** The raw 32-byte public key, base64url (43 characters): how the ACL names it. */
  pub: string;
  key: CryptoKey;
}

export interface Envelope {
  op: EnvelopeOp;
  signer: string;
  ctr: number;
  aclSeq: number;
  cond: string;
  sig: Uint8Array;
  payload: Uint8Array;
}

/** A new signing key (non-extractable by default). */
export async function newSigner(extractable = false): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, extractable, ["sign", "verify"])) as CryptoKeyPair;
  return { pub: toB64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), key: pair.privateKey };
}

export async function signBytes(signer: Signer, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, signer.key, bs(data)));
}

export async function verifyBytes(pub: string, sig: Uint8Array, data: Uint8Array): Promise<boolean> {
  const raw = fromB64u(pub);
  if (raw.length !== 32 || sig.length !== SIG) return false;
  try {
    const key = await crypto.subtle.importKey("raw", bs(raw), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, bs(sig), bs(data));
  } catch {
    return false;
  }
}

/** The condition string of a write, as the relay reads it from the request's headers. */
export function condString(cond?: PutCondition): string {
  if (cond && "ifNoneMatch" in cond) return "none:*";
  if (cond && "ifMatch" in cond) return `match:${cond.ifMatch}`;
  return "";
}

async function signedBytes(space: string, op: EnvelopeOp, name: string, cond: string, ctr: number, aclSeq: number, payload: Uint8Array): Promise<Uint8Array> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bs(payload)));
  return concat(utf8(`lumen-role v1\n${space}\n${op}\n${name}\n${cond}\n${ctr}\n${aclSeq}\n`), digest);
}

export interface EnvelopeInput {
  space: string;
  op: EnvelopeOp;
  name: string;
  cond: string;
  ctr: number;
  aclSeq: number;
  payload: Uint8Array;
}

/** Sign and pack a write. */
export async function sealEnvelope(signer: Signer, e: EnvelopeInput): Promise<Uint8Array> {
  if (!Number.isSafeInteger(e.ctr) || e.ctr < 1) throw new RangeError("envelope: ctr");
  if (!Number.isInteger(e.aclSeq) || e.aclSeq < 0 || e.aclSeq > 0xffffffff) throw new RangeError("envelope: aclSeq");
  const cond = utf8(e.cond);
  if (cond.length > MAX_COND || !/^[\x20-\x7e]*$/.test(e.cond)) throw new RangeError("envelope: condition");
  const pub = fromB64u(signer.pub);
  const sig = await signBytes(signer, await signedBytes(e.space, e.op, e.name, e.cond, e.ctr, e.aclSeq, e.payload));
  const head = new Uint8Array(HEAD);
  head.set(MAGIC, 0);
  head[4] = e.op === "del" ? 1 : 0;
  head.set(pub, 5);
  const view = new DataView(head.buffer);
  view.setUint32(37, Math.floor(e.ctr / 2 ** 32));
  view.setUint32(41, e.ctr >>> 0);
  view.setUint32(45, e.aclSeq);
  head[49] = cond.length;
  return concat(head, cond, sig, e.payload);
}

/** An envelope's fields, or null for bytes that aren't one. */
export function parseEnvelope(bytes: Uint8Array): Envelope | null {
  if (bytes.length < HEAD + SIG || !equalBytes(bytes.subarray(0, 4), MAGIC)) return null;
  const op = bytes[4];
  if (op !== 0 && op !== 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hi = view.getUint32(37);
  if (hi > 0x1fffff) return null;
  const condLen = bytes[49] as number;
  if (condLen > MAX_COND || bytes.length < HEAD + condLen + SIG) return null;
  const cond = String.fromCharCode(...bytes.subarray(HEAD, HEAD + condLen));
  if (!/^[\x20-\x7e]*$/.test(cond)) return null;
  return {
    op: op === 1 ? "del" : "put",
    signer: toB64u(bytes.subarray(5, 37)),
    ctr: hi * 2 ** 32 + view.getUint32(41),
    aclSeq: view.getUint32(45),
    cond,
    sig: bytes.slice(HEAD + condLen, HEAD + condLen + SIG),
    payload: bytes.slice(HEAD + condLen + SIG),
  };
}

/** Does the envelope's signature hold for this space and object name? */
export async function verifyEnvelope(e: Envelope, space: string, name: string): Promise<boolean> {
  return verifyBytes(e.signer, e.sig, await signedBytes(space, e.op, name, e.cond, e.ctr, e.aclSeq, e.payload));
}
