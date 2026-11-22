/**
 * The access list of a role vault (plan W12.S4): who may write, signed by
 * the vault's admin. Stored on the relay as `lumen-role-acl`; the relay
 * (sync-server/vault-relay-roles.js) applies the same rules as `checkNext`
 * here before it stores one, and every member checks it again on read
 * against the admin key pinned from its invite.
 *
 *   body = JSON {"v":1, "acl":"<b64u acl bytes>", "sig":"<b64u>"}
 *   sig  = Ed25519(admin, "lumen-role-acl v1\n" ‖ acl bytes)
 *
 * A role is a set of keys, never an account:
 *   reader  the vault's read key (the keyring's epoch secret, sealed to this
 *           device's age key), and at most a signing key scoped to its own
 *           personal folder (`p-<slot>-`);
 *   writer  the same, plus a signing key the relay accepts for vault objects;
 *   admin   the admin signing key (it signs the ACL and alone may write the
 *           keyring and the vault header: re-keys and device revocation), and
 *           the vault passphrase.
 */

import { bs, concat, fromB64u, fromUtf8, toB64u, utf8 } from "../bytes";
import { signBytes, verifyBytes, type Signer } from "./envelope";

export const ACL_NAME = "lumen-role-acl";
export type Role = "admin" | "writer" | "reader";

export interface AclMember {
  role: Role;
  /** The member's Ed25519 signing key (base64url); a reader has one only for its personal folder. */
  sign?: string;
  /** The personal-folder prefix this member may write (`p-<22>-`). */
  scope?: string;
  /** The member device's age recipient: the keyring seals the read key to it. */
  recipient?: string;
}

export interface AclRevoked {
  id: string;
  sign?: string;
  /** The ACL seq that revoked it: writes it signed under an earlier ACL stay valid history. */
  seq: number;
  /** What it could write before (readers check old objects against it). */
  role?: Role;
  scope?: string;
}

export interface Acl {
  v: 1;
  kind: typeof ACL_NAME;
  /** The relay's id of the role space (hex). */
  space: string;
  seq: number;
  admin: string;
  members: Record<string, AclMember>;
  revoked: AclRevoked[];
}

export class AclError extends Error {
  constructor(readonly code: "malformed" | "signature" | "admin" | "space" | "rollback" | "rule") {
    super(`role vault ACL: ${code}`);
    this.name = "AclError";
  }
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const SCOPE = /^p-[A-Za-z0-9_-]{22}-$/;
const ROLES = new Set<Role>(["admin", "writer", "reader"]);
const LABEL = utf8("lumen-role-acl v1\n");
/** The relay's own caps (vault-relay-roles.js). */
export const MAX_MEMBERS = 256;
export const MAX_REVOKED = 1024;

/** The shape rules the relay applies too; throws AclError("malformed"). */
export function checkShape(a: unknown): Acl {
  const bad = () => new AclError("malformed");
  if (!a || typeof a !== "object") throw bad();
  const o = a as Acl;
  if (o.v !== 1 || o.kind !== ACL_NAME || typeof o.space !== "string" || !/^[0-9a-f]{64}$/.test(o.space)) throw bad();
  if (!Number.isInteger(o.seq) || o.seq < 0 || o.seq > 0xffffffff || typeof o.admin !== "string" || !KEY.test(o.admin)) throw bad();
  if (!o.members || typeof o.members !== "object" || Array.isArray(o.members) || !Array.isArray(o.revoked)) throw bad();
  const ids = Object.keys(o.members);
  if (ids.length > MAX_MEMBERS || o.revoked.length > MAX_REVOKED) throw bad();
  const signs = new Set<string>();
  for (const id of ids) {
    const m = o.members[id];
    if (!ID.test(id) || !m || typeof m !== "object" || !ROLES.has(m.role)) throw bad();
    if (m.sign !== undefined && (typeof m.sign !== "string" || !KEY.test(m.sign))) throw bad();
    if (m.scope !== undefined && (typeof m.scope !== "string" || !SCOPE.test(m.scope))) throw bad();
    if (m.recipient !== undefined && (typeof m.recipient !== "string" || !/^age1[0-9a-z]{58}$/.test(m.recipient))) throw bad();
    if ((m.role === "admin") !== (m.sign === o.admin)) throw bad();
    if (m.sign !== undefined) {
      if (signs.has(m.sign)) throw bad();
      signs.add(m.sign);
    }
  }
  for (const r of o.revoked) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !ID.test(r.id) || !Number.isInteger(r.seq)) throw bad();
    if (r.sign !== undefined && (typeof r.sign !== "string" || !KEY.test(r.sign))) throw bad();
    if (r.role !== undefined && !ROLES.has(r.role)) throw bad();
    if (r.scope !== undefined && (typeof r.scope !== "string" || !SCOPE.test(r.scope))) throw bad();
    if (r.sign !== undefined && (signs.has(r.sign) || r.sign === o.admin)) throw bad();
  }
  return o;
}

/** Is `next` an allowed successor of `prev`? The relay's rules (throws AclError("rule")). */
export function checkNext(prev: Acl, next: Acl): void {
  if (next.seq !== prev.seq + 1 || next.admin !== prev.admin || next.space !== prev.space) throw new AclError("rule");
  const kept = new Set(next.revoked.map((r) => r.sign).filter(Boolean));
  for (const r of prev.revoked) if (r.sign && !kept.has(r.sign)) throw new AclError("rule");
  const now = new Set([next.admin, ...Object.values(next.members).map((m) => m.sign)].filter(Boolean));
  for (const m of [{ sign: prev.admin }, ...Object.values(prev.members)]) if (m.sign && !now.has(m.sign) && !kept.has(m.sign)) throw new AclError("rule");
}

/** The stored body of an ACL, signed with the admin key. */
export async function signAcl(acl: Acl, admin: Signer): Promise<Uint8Array> {
  checkShape(acl);
  if (admin.pub !== acl.admin) throw new AclError("admin");
  const bytes = utf8(JSON.stringify(acl));
  const sig = await signBytes(admin, concat(LABEL, bytes));
  return utf8(JSON.stringify({ v: 1, acl: toB64u(bytes), sig: toB64u(sig) }));
}

/**
 * Open a stored ACL: the signature must be the pinned admin key's, the space
 * this one, and the seq not below `seen` (the highest this device verified:
 * a relay serving an older ACL is a rollback).
 */
export async function openAcl(body: Uint8Array, expect: { space: string; admin: string; seen?: number }): Promise<Acl> {
  let o: { v?: unknown; acl?: unknown; sig?: unknown };
  let bytes: Uint8Array;
  let sig: Uint8Array;
  try {
    o = JSON.parse(fromUtf8(body)) as typeof o;
    if (o.v !== 1 || typeof o.acl !== "string" || typeof o.sig !== "string") throw new Error();
    bytes = fromB64u(o.acl);
    sig = fromB64u(o.sig);
  } catch {
    throw new AclError("malformed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(bytes));
  } catch {
    throw new AclError("malformed");
  }
  const acl = checkShape(parsed);
  if (acl.admin !== expect.admin) throw new AclError("admin");
  if (!(await verifyBytes(expect.admin, sig, concat(LABEL, bytes)))) throw new AclError("signature");
  if (acl.space !== expect.space) throw new AclError("space");
  if (expect.seen !== undefined && acl.seq < expect.seen) throw new AclError("rollback");
  return acl;
}

/** The first ACL of a new role vault: the admin alone. */
export function firstAcl(space: string, adminId: string, admin: Signer, recipient: string): Acl {
  return { v: 1, kind: ACL_NAME, space, seq: 0, admin: admin.pub, members: { [adminId]: { role: "admin", sign: admin.pub, recipient } }, revoked: [] };
}

/** The ACL with one more member. */
export function withMember(acl: Acl, id: string, m: AclMember): Acl {
  if (acl.members[id] || acl.revoked.some((r) => r.id === id || (m.sign && r.sign === m.sign))) throw new AclError("rule");
  if (m.role === "admin") throw new AclError("rule");
  const next: Acl = { ...acl, seq: acl.seq + 1, members: { ...acl.members, [id]: m } };
  return checkShape(next);
}

/** The ACL with a member revoked: its key goes to `revoked` for good. */
export function withoutMember(acl: Acl, id: string): Acl {
  const m = acl.members[id];
  if (!m || m.role === "admin") throw new AclError("rule");
  const members = { ...acl.members };
  delete members[id];
  const seq = acl.seq + 1;
  return checkShape({ ...acl, seq, members, revoked: [...acl.revoked, { id, ...(m.sign ? { sign: m.sign } : {}), seq, role: m.role, ...(m.scope ? { scope: m.scope } : {}) }] });
}

/** Who a signing key is in this ACL, or null. */
export function keyRole(acl: Acl, sign: string): { admin: boolean; writer: boolean; scope: string | null } | null {
  if (sign === acl.admin) return { admin: true, writer: true, scope: null };
  for (const m of Object.values(acl.members)) if (m.sign === sign) return { admin: false, writer: m.role === "writer", scope: m.scope ?? null };
  return null;
}

/** Names only the admin may write: the keyring (re-keys, revocation) and the vault header (passphrase). */
export const ADMIN_ONLY = new Set(["lumen-e2ee-keyring", "lumen-e2ee-vault"]);

/** May this key write `name`? The relay's rule (vault-relay-roles.js `allowed`). */
export function mayWrite(who: { admin: boolean; writer: boolean; scope: string | null }, name: string): boolean {
  if (who.admin) return true;
  if (ADMIN_ONLY.has(name) || name === ACL_NAME || name.startsWith("j-")) return false;
  if (/^p-[A-Za-z0-9_-]{22}-/.test(name)) return who.scope === name.slice(0, 25);
  if (name.startsWith("p-")) return false;
  return who.writer;
}

/** The personal-folder prefix of a member: `p-` + 22 characters of SHA-256(space, member id) + `-`. */
export async function personalScope(space: string, memberId: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bs(utf8(`lumen-role v1|scope|${space}|${memberId}`))));
  return `p-${toB64u(d).slice(0, 22)}-`;
}
