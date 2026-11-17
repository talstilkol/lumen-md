/**
 * The role vaults this device belongs to (plan W12.S4): one record each, in
 * IndexedDB, as the classroom keeps its assignments (../../classroom/store.ts).
 * The signing keys are non-extractable CryptoKeys, stored as they are: code
 * in the app can sign with them, no code can read their bytes out.
 *
 * A record holds keys and the space's address, and no name or e-mail of
 * anyone: a member is a device id the joining device made up.
 */

import type { Role } from "../acl";
import type { Invite, MemberKeys, RoleVaultRef } from "../vault";

export type RoleRecord =
  | { kind: "admin"; id: string; ref: RoleVaultRef; keys: MemberKeys; invites: Invite[]; created: number }
  | { kind: "member"; id: string; ref: RoleVaultRef; keys: MemberKeys; role: Exclude<Role, "admin">; joined: number };

export interface RoleRecordStore {
  list(): Promise<RoleRecord[]>;
  save(r: RoleRecord): Promise<void>;
  remove(r: RoleRecord): Promise<void>;
}

const keyOf = (r: Pick<RoleRecord, "kind" | "id">) => `${r.kind}:${r.id}`;
const newestFirst = (a: RoleRecord, b: RoleRecord) => (b.kind === "admin" ? b.created : b.joined) - (a.kind === "admin" ? a.created : a.joined);

/** In memory (tests, and a device where IndexedDB is unavailable). */
export function memoryRecords(): RoleRecordStore & { all: Map<string, RoleRecord> } {
  const all = new Map<string, RoleRecord>();
  return {
    all,
    list: async () => [...all.values()].sort(newestFirst),
    save: async (r) => void all.set(keyOf(r), r),
    remove: async (r) => void all.delete(keyOf(r)),
  };
}

/** IndexedDB (`lumen-role-vaults`). */
export function idbRecords(): RoleRecordStore {
  const db = import("idb-keyval").then((m) => ({ m, store: m.createStore("lumen-role-vaults", "vaults") }));
  return {
    async list() {
      const { m, store } = await db;
      return ((await m.values(store)) as RoleRecord[]).sort(newestFirst);
    },
    async save(r) {
      const { m, store } = await db;
      await m.set(keyOf(r), r, store);
    },
    async remove(r) {
      const { m, store } = await db;
      await m.del(keyOf(r), store);
    },
  };
}
