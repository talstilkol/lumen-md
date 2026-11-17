/**
 * What the role-vault screens do (plan W12.S4, the UI half): every step is a
 * call into ../vault.ts and the engine, nothing of its own. The screens
 * (RoleVaultPanel.tsx) only render and call these.
 *
 *   admin   create the space and the vault (passphrase), reopen it on this
 *           device, make invites, accept join requests, revoke a member
 *           (ACL first, then re-key: ../vault.ts `revokeMember`).
 *   member  join from a `#rolevault=` link (own keys, a join request), then,
 *           once the admin accepted, open the vault with this device's key,
 *           and confirm once that what it sees is current (engine N6).
 *
 * A role vault syncs into one folder of the open vault (`Role vaults/<id>/`),
 * never the whole vault: a writer must not upload their own notes into the
 * family's vault by joining it.
 */

import { E2eeSync, createVault, unlockVault, unlockWithDevice } from "../../engine";
import { idbStateStore, type SyncStateStore } from "../../state";
import type { VaultKeys } from "../../keys";
import type { LocalFile, LocalFiles } from "../../localFiles";
import type { FetchLike } from "../../providers/http";
import type { Acl, Role } from "../acl";
import {
  acceptJoin,
  inviteHash,
  memberProvider,
  newInvite,
  newMemberKeys,
  openRoleSpace,
  pendingJoins,
  requestJoin,
  revokeMember,
  type Invite,
  type JoinRequest,
  type MemberKeys,
  type RoleVaultRef,
} from "../vault";
import type { RoleProvider } from "../provider";
import { roleSpaceId } from "../provider";
import { type RoleRecord, type RoleRecordStore } from "./records";
import { compareNames } from "../../../../i18n/collate";

export interface RoleDeps {
  fetch?: FetchLike;
  /** The open vault's files (default: the active vault backend). */
  local?: () => LocalFiles | Promise<LocalFiles>;
  /** The engine's per-vault state (default: IndexedDB): it keeps the one-time freshness confirmation. */
  stateStore?: (vaultId: string) => Promise<SyncStateStore>;
  records: RoleRecordStore;
  pbkdf2Iterations?: number;
}

/** The folder of the open vault a role vault syncs into. */
export const folderOf = (id: string) => `Role vaults/${id}/`;

/** `inner` seen through one folder: the engine sees paths inside it only, without the prefix. */
export function folderFiles(inner: LocalFiles, prefix: string): LocalFiles {
  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return {
    async list(): Promise<LocalFile[]> {
      return (await inner.list()).filter((f) => f.path.startsWith(p) && f.path.length > p.length).map((f) => ({ ...f, path: f.path.slice(p.length) }));
    },
    read: (path) => inner.read(p + path),
    write: (path, data, expect) => inner.write(p + path, data, expect),
    remove: (path, expect) => inner.remove(p + path, expect),
  };
}

async function defaultLocal(): Promise<LocalFiles> {
  const [{ getVaultBackend }, { vaultLocalFiles }] = await Promise.all([import("../../../../storage/vault"), import("../../localFiles")]);
  return vaultLocalFiles(getVaultBackend());
}

/** A short, stable id of the space for this device's lists (never a person's name). */
export async function shortId(token: string): Promise<string> {
  return (await roleSpaceId(token)).slice(0, 8);
}

/** The link a member opens (or scans): the app's address and the `#rolevault=` fragment. Nothing else. */
export function inviteLink(invite: Invite, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/${inviteHash(invite)}`;
}

export interface MemberRow {
  id: string;
  role: Role;
  personal: boolean;
  revoked: boolean;
}

/** The ACL as rows: current members first (admin, writers, readers), then revoked devices. */
export function memberRows(acl: Acl): MemberRow[] {
  const order: Record<Role, number> = { admin: 0, writer: 1, reader: 2 };
  const live = Object.entries(acl.members)
    .map(([id, m]) => ({ id, role: m.role, personal: !!m.scope, revoked: false }))
    .sort((a, b) => order[a.role] - order[b.role] || compareNames(a.id, b.id));
  const gone = acl.revoked.map((r) => ({ id: r.id, role: r.role ?? "reader", personal: !!r.scope, revoked: true }));
  return [...live, ...gone];
}

export interface AdminSession {
  kind: "admin";
  record: Extract<RoleRecord, { kind: "admin" }>;
  provider: RoleProvider;
  sync: E2eeSync;
}

export interface MemberSession {
  kind: "member";
  record: Extract<RoleRecord, { kind: "member" }>;
  provider: RoleProvider;
  /** Null while the admin hasn't accepted the join request. */
  sync: E2eeSync | null;
  /** This device's personal-folder prefix, when it has one. */
  scope: string | null;
}

export type Pending = { name: string; request: JoinRequest; invite: Invite };

async function engine(deps: RoleDeps, id: string, provider: RoleProvider, keys: VaultKeys, access?: { device: string; identity: string }): Promise<E2eeSync> {
  const local = folderFiles(await (deps.local ?? defaultLocal)(), folderOf(id));
  const store = await (deps.stateStore ?? idbStateStore)(keys.vaultId);
  return new E2eeSync({ provider, keys, local, store, ...(access ? { access } : {}) });
}

/** Admin: a new role space and its vault, this device as the admin. */
export async function createRoleVault(deps: RoleDeps, relay: string, passphrase: string): Promise<AdminSession> {
  const { ref, admin, provider } = await openRoleSpace(relay, { fetch: deps.fetch });
  const created = await createVault(provider, passphrase, deps.pbkdf2Iterations ? { pbkdf2Iterations: deps.pbkdf2Iterations } : {});
  const id = await shortId(ref.token);
  const record: AdminSession["record"] = { kind: "admin", id, ref, keys: admin, invites: [], created: Date.now() };
  await deps.records.save(record);
  const sync = await engine(deps, id, provider, created.keys);
  await sync.markCreated(created.anchor);
  return { kind: "admin", record, provider, sync };
}

/** Admin: reopen the vault on this device (the passphrase unlocks it; the signing key is this device's). */
export async function openAdmin(deps: RoleDeps, record: AdminSession["record"], passphrase: string): Promise<AdminSession> {
  const provider = memberProvider(record.ref, record.keys, { fetch: deps.fetch });
  const { keys } = await unlockVault(provider, passphrase);
  return { kind: "admin", record, provider, sync: await engine(deps, record.id, provider, keys) };
}

const adminCtx = (s: AdminSession) => ({ provider: s.provider, signer: s.record.keys.signer!, sync: s.sync, keys: s.record.keys });

/** Admin: an invite for one role and one device; this device keeps it until the join request comes back. */
export async function makeInvite(deps: RoleDeps, s: AdminSession, role: Exclude<Role, "admin">, personal: boolean): Promise<Invite> {
  const invite = newInvite(s.record.ref, role, { personal });
  s.record = { ...s.record, invites: [...s.record.invites, invite] };
  await deps.records.save(s.record);
  return invite;
}

/** Admin: an invite not used yet is withdrawn (a request for it is then refused and deleted). */
export async function withdrawInvite(deps: RoleDeps, s: AdminSession, id: string): Promise<void> {
  s.record = { ...s.record, invites: s.record.invites.filter((i) => i.id !== id) };
  await deps.records.save(s.record);
}

export const listMembers = async (s: AdminSession | MemberSession): Promise<MemberRow[]> => memberRows(await s.provider.acl(true));

export const listPending = (s: AdminSession): Promise<Pending[]> => pendingJoins({ provider: s.provider, keys: s.record.keys }, s.record.invites);

/** Admin: accept a checked join request; its invite is used up. */
export async function accept(deps: RoleDeps, s: AdminSession, join: Pending): Promise<void> {
  await acceptJoin(adminCtx(s), join);
  await withdrawInvite(deps, s, join.invite.id);
}

/** Admin: revoke a member (the ACL first, so its writes stop at once, then a re-key). */
export async function revoke(s: AdminSession, id: string): Promise<void> {
  await revokeMember(adminCtx(s), id);
}

/** Member: this device's keys and a join request for the invite. Nothing about the person is sent. */
export async function joinWithInvite(deps: RoleDeps, invite: Invite): Promise<MemberSession["record"]> {
  const role = invite.role;
  if (role === "admin") throw new RangeError("role vault: an invite never makes an admin");
  const keys = await newMemberKeys(role, { personal: invite.personal });
  await requestJoin(invite, keys, { fetch: deps.fetch });
  const ref: RoleVaultRef = { relay: invite.relay, token: invite.token, admin: invite.admin, adminRecipient: invite.adminRecipient };
  const record: MemberSession["record"] = { kind: "member", id: await shortId(ref.token), ref, keys: keys as MemberKeys, role, joined: Date.now() };
  await deps.records.save(record);
  return record;
}

/**
 * Member: open the vault with this device's key once the admin has accepted.
 * Until then `sync` is null (the request is still waiting). The first round
 * pulls; the engine holds uploads until the user confirms (`confirmCurrent`).
 */
export async function openMember(deps: RoleDeps, record: MemberSession["record"]): Promise<MemberSession> {
  const provider = memberProvider(record.ref, record.keys, { fetch: deps.fetch });
  const me = (await provider.acl(true)).members[record.keys.id];
  if (!me) return { kind: "member", record, provider, sync: null, scope: null };
  const { keys } = await unlockWithDevice(provider, record.keys.id, record.keys.age.identity);
  const sync = await engine(deps, record.id, provider, keys, { device: record.keys.id, identity: record.keys.age.identity });
  await sync.sync();
  return { kind: "member", record, provider, sync, scope: me.scope ?? null };
}

/** True while this device hasn't confirmed, once, that the vault it sees is current. */
export async function needsConfirm(s: MemberSession): Promise<boolean> {
  return !!s.sync && !(await s.sync.freshness()).verified;
}

export async function confirmCurrent(s: MemberSession): Promise<void> {
  if (!s.sync) return;
  await s.sync.confirmFreshness();
  await s.sync.sync();
}
