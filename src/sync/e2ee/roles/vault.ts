/**
 * Family and classroom vaults with roles, without accounts (plan W12.S4).
 *
 * A role vault is an ordinary encrypted vault (keyring, epochs, manifests:
 * engine.ts and keyring.ts, unchanged) kept in a role space on the relay,
 * plus the admin-signed ACL (acl.ts) that the relay enforces on every write.
 *
 *   read key     the keyring's epoch secret, sealed to each member device's
 *                own age key (the keyring's per-device wraps). Revoking a
 *                device re-keys: a new epoch secret, sealed to every device
 *                but that one (`rekey({ revoke })`), so it can't decrypt
 *                anything written after.
 *   write key    an Ed25519 key per writer device, listed in the ACL. The
 *                relay takes a write only with a valid signature from one.
 *                Revoking moves the key to the ACL's revoked list: refused
 *                from the next request on, and never let back in.
 *   admin        signs the ACL, alone writes the keyring and the vault
 *                header, holds the passphrase.
 *
 * Joining is by link or QR (`#rolevault=`), one per role and use, with no
 * user name and no e-mail: the joining device makes its own keys and leaves
 * a join request (`j-…`, sealed to the admin and authenticated with the
 * invite's secret); the admin's device checks it, adds the member to the ACL
 * with the role *the invite* names, and enrolls the device in the keyring.
 *
 * Personal folders (`p-<slot>-…`): each child or student has one that only
 * they and the admin can read (age, to the member's and the admin's keys
 * only: the vault's read key does not open it) and only they and the admin
 * can write (the ACL's scope, enforced by the relay).
 *
 * Behind the E2EE flag that is off and marked "not audited" (W11.S1): no
 * screen reaches this module except through `../ui/unaudited` whenE2eeOn.
 */

import { ageDecrypt, ageEncrypt, generateIdentity, type AgeIdentity } from "../age";
import { fromB64u, fromUtf8, randomBytes, toB64u, utf8 } from "../bytes";
import type { E2eeSync } from "../engine";
import { firstAcl, personalScope, withMember, withoutMember, type Acl, type Role } from "./acl";
import { newSigner, type Signer } from "./envelope";
import { roleProvider, roleSpaceId, type RoleProvider } from "./provider";
import type { FetchLike } from "../providers/http";

/** What one device holds for a role vault (kept in IndexedDB; the signing key is non-extractable). */
export interface MemberKeys {
  id: string;
  role: Role;
  /** The device's age identity: the keyring seals the read key to it. */
  age: AgeIdentity;
  /** The device's signing key (writers; readers only for a personal folder). */
  signer?: Signer;
  /** The personal-folder prefix, when the member has one. */
  scope?: string;
}

export interface RoleVaultRef {
  relay: string;
  token: string;
  /** The admin's signing key: pinned by every member. */
  admin: string;
  /** The admin device's age recipient: join requests and personal folders are sealed to it too. */
  adminRecipient: string;
}

const enc = new TextEncoder();
const randomId = (n = 12) => toB64u(randomBytes(n));

/** A new device's keys for a role (a reader gets a signing key only with a personal folder). */
export async function newMemberKeys(role: Role, opts: { id?: string; personal?: boolean } = {}): Promise<Omit<MemberKeys, "scope">> {
  const age = await generateIdentity();
  const signer = role === "reader" && !opts.personal ? undefined : await newSigner();
  return { id: opts.id ?? randomId(), role, age, ...(signer ? { signer } : {}) };
}

/** The provider of this device for a vault. */
export function memberProvider(ref: RoleVaultRef, keys: Pick<MemberKeys, "signer">, deps: { fetch?: FetchLike; now?: () => number; invite?: string } = {}): RoleProvider {
  return roleProvider({ url: ref.relay, token: ref.token, admin: ref.admin, signer: keys.signer, now: deps.now, invite: deps.invite }, { fetch: deps.fetch });
}

/**
 * Open a new role space: the first ACL (this device as its admin). The
 * vault itself is then created on the returned provider with the engine's
 * own `createVault` (passphrase, header, keyring), which only the admin's
 * key may write.
 */
export async function openRoleSpace(relay: string, deps: { fetch?: FetchLike; now?: () => number; invite?: string } = {}): Promise<{ ref: RoleVaultRef; admin: MemberKeys; provider: RoleProvider }> {
  const admin: MemberKeys = { ...(await newMemberKeys("admin", { id: "admin" })), signer: await newSigner() };
  const ref: RoleVaultRef = { relay, token: randomId(32), admin: admin.signer!.pub, adminRecipient: admin.age.recipient };
  const provider = memberProvider(ref, admin, deps);
  await provider.putAcl(firstAcl(await roleSpaceId(ref.token), admin.id, admin.signer!, admin.age.recipient), admin.signer!);
  return { ref, admin, provider };
}

/**
 * Add a member (admin): first the ACL (from now on the relay takes its
 * signed writes), then the keyring (its device gets the read key, sealed to
 * its age key).
 */
export async function addMember(admin: { provider: RoleProvider; signer: Signer; sync: E2eeSync }, m: { id: string; role: Role; sign?: string; recipient: string; personal?: boolean }): Promise<Acl> {
  if (m.role === "admin") throw new RangeError("role vault: one admin");
  if (m.role === "reader" && m.sign && !m.personal) throw new RangeError("role vault: a reader's key is for a personal folder only");
  const acl = await admin.provider.acl(true);
  const scope = m.personal ? await personalScope(acl.space, m.id) : undefined;
  const next = withMember(acl, m.id, { role: m.role, recipient: m.recipient, ...(m.sign ? { sign: m.sign } : {}), ...(scope ? { scope } : {}) });
  await admin.provider.putAcl(next, admin.signer);
  await admin.sync.rekey({ enroll: { [m.id]: m.recipient } });
  return next;
}

/**
 * Revoke a member's device (admin): the ACL first, so the relay refuses its
 * writes at once, then a re-key that seals a new read key to every device
 * but this one (the keyring's revocation, W1.7 / W11.S8).
 */
export async function revokeMember(admin: { provider: RoleProvider; signer: Signer; sync: E2eeSync }, id: string): Promise<Acl> {
  const next = withoutMember(await admin.provider.acl(true), id);
  await admin.provider.putAcl(next, admin.signer);
  await admin.sync.rekey({ revoke: [id] });
  return next;
}

/* ─── invites: a link or QR per role, no account ─── */

export interface Invite extends RoleVaultRef {
  role: Role;
  /** The invite's id and secret: the admin's device keeps them, to check the join request. */
  id: string;
  secret: string;
  personal: boolean;
}

/** A new invite (the admin's device keeps it until the join request comes back). */
export function newInvite(ref: RoleVaultRef, role: Exclude<Role, "admin">, opts: { personal?: boolean } = {}): Invite {
  return { ...ref, role, id: randomId(9), secret: randomId(32), personal: !!opts.personal };
}

/** The `#rolevault=` fragment (never sent to a server). */
export function inviteHash(i: Invite): string {
  const json = JSON.stringify({ v: 1, r: i.relay, t: i.token, a: i.admin, ar: i.adminRecipient, role: i.role, id: i.id, s: i.secret, p: i.personal ? 1 : 0 });
  return `#rolevault=${toB64u(utf8(json))}`;
}

export function parseInviteHash(hash: string): Invite {
  const m = /^#rolevault=([A-Za-z0-9_-]{1,4096})$/.exec(hash);
  if (!m) throw new RangeError("role vault: not an invite");
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(fromUtf8(fromB64u(m[1] as string))) as Record<string, unknown>;
  } catch {
    throw new RangeError("role vault: malformed invite");
  }
  const { r, t, a, ar, role, id, s, p } = o;
  if (o.v !== 1 || typeof r !== "string" || !/^https?:\/\/[^/?#\s]+$/.test(r) || typeof t !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(t)) throw new RangeError("role vault: malformed invite");
  if (typeof a !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(a) || typeof ar !== "string" || !/^age1[0-9a-z]{58}$/.test(ar)) throw new RangeError("role vault: malformed invite");
  if ((role !== "reader" && role !== "writer") || typeof id !== "string" || !/^[A-Za-z0-9_-]{12}$/.test(id) || typeof s !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(s)) throw new RangeError("role vault: malformed invite");
  return { relay: r, token: t, admin: a, adminRecipient: ar, role, id, secret: s, personal: p === 1 };
}

const macKey = (secret: string, use: KeyUsage) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [use]);
const macData = (body: string) => enc.encode(`lumen-role join v1|${body}`);

async function inviteMac(secret: string, body: string): Promise<string> {
  return toB64u(new Uint8Array(await crypto.subtle.sign("HMAC", await macKey(secret, "sign"), macData(body))));
}

/** Constant-time check of a join request's MAC (WebCrypto's verify). */
async function inviteMacOk(secret: string, body: string, mac: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(mac)) return false;
  return crypto.subtle.verify("HMAC", await macKey(secret, "verify"), fromB64u(mac), macData(body));
}

export interface JoinRequest {
  invite: string;
  member: string;
  sign?: string;
  recipient: string;
}

/** On the joining device: leave the join request for the admin (sealed to the admin, MAC'd with the invite's secret). */
export async function requestJoin(invite: Invite, keys: Omit<MemberKeys, "scope">, deps: { fetch?: FetchLike } = {}): Promise<string> {
  const req: JoinRequest = { invite: invite.id, member: keys.id, recipient: keys.age.recipient, ...(keys.signer ? { sign: keys.signer.pub } : {}) };
  const body = JSON.stringify(req);
  const sealed = await ageEncrypt(utf8(JSON.stringify({ v: 1, body, mac: await inviteMac(invite.secret, body) })), [{ x25519: invite.adminRecipient }]);
  const name = `j-${randomId(18)}`;
  await memberProvider(invite, {}, deps).putJoin(name, sealed);
  return name;
}

/**
 * On the admin's device: every join request that answers one of `invites`
 * (checked by its MAC: someone with the space token but no invite can't
 * join), each with the role its invite names. Other requests are deleted.
 */
export async function pendingJoins(admin: { provider: RoleProvider; keys: MemberKeys }, invites: Invite[]): Promise<Array<{ name: string; request: JoinRequest; invite: Invite }>> {
  const out: Array<{ name: string; request: JoinRequest; invite: Invite }> = [];
  for (const name of (await admin.provider.listAll()).filter((n) => n.startsWith("j-"))) {
    const o = await admin.provider.getRaw(name);
    if (!o) continue;
    const got = await ageDecrypt(o.data, [{ identity: admin.keys.age.identity }])
      .then((b) => JSON.parse(fromUtf8(b)) as { v?: unknown; body?: unknown; mac?: unknown })
      .catch(() => null);
    let req: JoinRequest | null = null;
    let invite: Invite | undefined;
    if (got?.v === 1 && typeof got.body === "string" && typeof got.mac === "string") {
      let r: JoinRequest | null = null;
      try {
        r = JSON.parse(got.body) as JoinRequest;
      } catch {
        r = null;
      }
      invite = r ? invites.find((i) => i.id === r.invite) : undefined;
      const ok = !!r && !!invite && (await inviteMacOk(invite.secret, got.body, got.mac));
      if (ok && r && /^[A-Za-z0-9_-]{1,64}$/.test(r.member) && /^age1[0-9a-z]{58}$/.test(r.recipient) && (r.sign === undefined || /^[A-Za-z0-9_-]{43}$/.test(r.sign))) req = r;
    }
    if (req && invite) out.push({ name, request: req, invite });
    else await admin.provider.delete(name);
  }
  return out;
}

/** Accept a checked join request (admin): the member, with the invite's role; the request is deleted. */
export async function acceptJoin(admin: { provider: RoleProvider; signer: Signer; sync: E2eeSync }, join: { name: string; request: JoinRequest; invite: Invite }): Promise<Acl> {
  const { request: r, invite } = join;
  // The role is the invite's, never the request's: a reader's link can't make a writer.
  const sign = invite.role === "reader" && !invite.personal ? undefined : r.sign;
  const acl = await addMember(admin, { id: r.member, role: invite.role, recipient: r.recipient, personal: invite.personal, ...(sign ? { sign } : {}) });
  await admin.provider.delete(join.name);
  return acl;
}

/* ─── personal folders ─── */

export interface PersonalNote {
  object: string;
  path: string;
  text: string;
  at: number;
}

/** Write a note into a member's personal folder (the member, or the admin): sealed to the member and the admin only. */
export async function putPersonal(provider: RoleProvider, to: { scope: string; recipient: string; adminRecipient: string }, path: string, text: string, now = Date.now()): Promise<string> {
  const sealed = await ageEncrypt(utf8(JSON.stringify({ v: 1, path, text, at: now })), [{ x25519: to.recipient }, { x25519: to.adminRecipient }]);
  const object = `${to.scope}${randomId(18)}`;
  await provider.put(object, sealed, { ifNoneMatch: "*" });
  return object;
}

/** A personal folder's notes, opened with `identity` (the member's or the admin's), newest version of each path. */
export async function readPersonal(provider: RoleProvider, scope: string, identity: string): Promise<PersonalNote[]> {
  const latest = new Map<string, PersonalNote>();
  for (const object of (await provider.listAll()).filter((n) => n.startsWith(scope))) {
    const got = await provider.get(object);
    if (!got) continue;
    const o = await ageDecrypt(got.data, [{ identity }])
      .then((b) => JSON.parse(fromUtf8(b)) as { v?: unknown; path?: unknown; text?: unknown; at?: unknown })
      .catch(() => null);
    if (!o || o.v !== 1 || typeof o.path !== "string" || typeof o.text !== "string" || typeof o.at !== "number") continue;
    const prev = latest.get(o.path);
    if (!prev || o.at >= prev.at) latest.set(o.path, { object, path: o.path, text: o.text, at: o.at });
  }
  return [...latest.values()].sort((a, b) => a.path.localeCompare(b.path));
}
