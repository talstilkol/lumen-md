/**
 * A role vault's space on the relay as a `SyncProvider` (plan W12.S4), so
 * the encrypted sync engine (keyring, epochs, manifests, rollback and fork
 * checks: all unchanged) runs on it as on any other storage.
 *
 *   Bearer r.<t>   the space (sync-server/vault-relay-roles.js)
 *
 * - Every write is sealed in a signed envelope (envelope.ts) with this
 *   device's key, the current ACL's seq and a growing counter. A device
 *   without a signing key (a reader) sends its writes unsigned, and the relay
 *   refuses them: the relay, not this client, is what keeps a reader out.
 * - Every read is checked here too: the object's envelope must verify for
 *   this space and name, and its signer must have been allowed to write it
 *   (a current member's key, or one revoked by a later ACL than the one it
 *   signed under). So a relay, or a reader working with one, can't inject
 *   an object no writer made (`RoleSignatureError`).
 * - The ACL is checked against the admin key pinned from the invite, and
 *   never accepted below the highest seq this provider has seen.
 * - The engine sees neither the ACL, the join requests (`j-`) nor the
 *   personal folders (`p-`): `list` leaves them out.
 */

import { PreconditionFailedError, type PutCondition, type StoredObject, type SyncProvider } from "../provider";
import { checkObjectName, defaultFetch, failed, request, type FetchLike } from "../providers/http";
import { solveRelayPow } from "../providers/relay";
import { toB64u } from "../bytes";
import { ACL_NAME, keyRole, mayWrite, openAcl, signAcl, type Acl } from "./acl";
import { condString, parseEnvelope, sealEnvelope, verifyEnvelope, type Signer } from "./envelope";

export interface RoleProviderConfig {
  /** The relay origin. */
  url: string;
  /** The space token t (from the invite); sent as `Bearer r.<t>`. */
  token: string;
  /** The admin's signing key (base64url), pinned from the invite. */
  admin: string;
  /** This device's signing key; none for a reader without a personal folder. */
  signer?: Signer;
  invite?: string;
  now?: () => number;
}

/** The relay refused a write (a reader's, a revoked device's, a replay, a bad signature…). */
export class RoleRefusedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly objectName: string,
  ) {
    super(`role vault: the relay refused ${objectName} (${status} ${code})`);
    this.name = "RoleRefusedError";
  }
}

/** An object on the relay that no allowed writer signed. */
export class RoleSignatureError extends Error {
  constructor(readonly objectName: string) {
    super(`role vault: ${objectName} is not signed by an allowed writer`);
    this.name = "RoleSignatureError";
  }
}

export interface RoleProvider extends SyncProvider {
  /** The relay's id of this space (hex). */
  space(): Promise<string>;
  /** The current ACL, checked (read again from the relay with `refresh`). */
  acl(refresh?: boolean): Promise<Acl>;
  /** Write a new ACL (the admin's key must be `admin`). */
  putAcl(acl: Acl, admin: Signer): Promise<void>;
  /** Every name in the space, the ACL, join requests and personal folders included. */
  listAll(): Promise<string[]>;
  /** An object's bytes as stored, unchecked (join requests are not signed). */
  getRaw(name: string): Promise<StoredObject | null>;
  /** Leave an unsigned, create-only join request (`j-…`). */
  putJoin(name: string, data: Uint8Array): Promise<void>;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** The relay's name for a role space (vault-relay.js `spaceOf`, kind r). */
export async function roleSpaceId(token: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lumen-vault-relay v1|role|${token}`)));
}

/** Names the engine doesn't see. */
const hidden = (n: string) => n === ACL_NAME || n.startsWith("j-") || n.startsWith("p-");

export function roleProvider(cfg: RoleProviderConfig, deps: { fetch?: FetchLike } = {}): RoleProvider {
  const fetchImpl = deps.fetch ?? defaultFetch;
  const base = `${cfg.url.replace(/\/+$/, "")}/v1/vault/o/`;
  const now = cfg.now ?? Date.now;
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({ Authorization: `Bearer r.${cfg.token}`, ...(cfg.invite ? { "X-Lumen-Invite": cfg.invite } : {}), ...extra });
  const url = (name: string) => {
    checkObjectName(name);
    return base + encodeURIComponent(name);
  };
  const go = (input: string, init: RequestInit) => request(fetchImpl, input, init, { provider: "role-relay" });
  let spaceP: Promise<string> | null = null;
  const space = () => (spaceP ??= roleSpaceId(cfg.token));
  let seen = -1;
  let current: Acl | null = null;
  let last = 0;
  /** A counter above every one this key used: the clock in microseconds, or one more than the last. */
  const nextCtr = () => (last = Math.max(last + 1, Math.floor(now() * 1000)));

  const refused = async (res: Response, name: string): Promise<Error> => {
    if (res.status === 412) return new PreconditionFailedError(name);
    if (res.status === 403 || res.status === 409) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      return new RoleRefusedError(res.status, typeof body?.error === "string" ? body.error : "refused", name);
    }
    return failed(res, "role-relay", name);
  };

  async function getRaw(name: string): Promise<StoredObject | null> {
    const res = await go(url(name), { method: "GET", headers: headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw await failed(res, "role-relay", name);
    const etag = res.headers.get("ETag");
    if (!etag) throw await failed(res, "role-relay", name);
    return { data: new Uint8Array(await res.arrayBuffer()), etag };
  }

  async function acl(refresh = false): Promise<Acl> {
    if (current && !refresh) return current;
    const o = await getRaw(ACL_NAME);
    if (!o) throw new RoleRefusedError(404, "no acl", ACL_NAME);
    const a = await openAcl(o.data, { space: await space(), admin: cfg.admin, seen: seen < 0 ? undefined : seen });
    seen = Math.max(seen, a.seq);
    current = a;
    return a;
  }

  /** Was `signer` allowed to write `name` under ACL seq `aclSeq`? (current ACL, refreshed once when unsure) */
  async function signerAllowed(signer: string, name: string, aclSeq: number): Promise<boolean> {
    for (const refresh of [false, true]) {
      const a = await acl(refresh);
      if (aclSeq > a.seq) continue;
      const who = keyRole(a, signer);
      if (who) return mayWrite(who, name);
      // Revoked later than the ACL it signed under: a write from before the revocation.
      const r = a.revoked.find((x) => x.sign === signer);
      if (r) return aclSeq < r.seq && mayWrite({ admin: false, writer: r.role === "writer", scope: r.scope ?? null }, name);
    }
    return false;
  }

  /** One request, with the proof of work when the relay asks for it (opening the space). */
  async function rawSend(method: "PUT" | "DELETE", name: string, body: Uint8Array | null, pre: Record<string, string>): Promise<Response> {
    const init = (extra: Record<string, string>) => ({ method, headers: headers({ ...(method === "PUT" ? { "Content-Type": "application/octet-stream" } : {}), ...pre, ...extra }), body: (body ?? undefined) as BodyInit | undefined });
    let res = await go(url(name), init({}));
    if (res.status === 428) {
      const ask = (await res.json().catch(() => null)) as { error?: unknown; bits?: unknown } | null;
      if (ask?.error !== "pow" || typeof ask.bits !== "number") throw await failed(res, "role-relay", name);
      res = await go(url(name), init({ "X-Lumen-Pow": await solveRelayPow(await space(), ask.bits) }));
    }
    return res;
  }

  async function send(method: "PUT" | "DELETE", name: string, data: Uint8Array | null, cond: PutCondition): Promise<Response> {
    const pre: Record<string, string> = {};
    if (cond && "ifMatch" in cond) pre["If-Match"] = cond.ifMatch;
    if (cond && "ifNoneMatch" in cond) pre["If-None-Match"] = "*";
    let body: Uint8Array | null = data;
    if (cfg.signer) {
      const env = await sealEnvelope(cfg.signer, {
        space: await space(),
        op: method === "PUT" ? "put" : "del",
        name,
        cond: condString(cond),
        ctr: nextCtr(),
        aclSeq: (await acl()).seq,
        payload: data ?? new Uint8Array(0),
      });
      if (method === "PUT") body = env;
      else pre["X-Lumen-Role"] = toB64u(env);
    }
    return rawSend(method, name, body, pre);
  }

  /** One write, again once when the relay says the ACL moved on or the counter was behind. */
  async function write(method: "PUT" | "DELETE", name: string, data: Uint8Array | null, cond: PutCondition): Promise<Response> {
    let res = await send(method, name, data, cond);
    if (res.status === 409 && cfg.signer) {
      const body = (await res.clone().json().catch(() => null)) as { error?: unknown; ctr?: unknown } | null;
      if (body?.error === "acl") await acl(true);
      else if (body?.error === "replay" && typeof body.ctr === "number") last = Math.max(last, body.ctr);
      else return res;
      res = await send(method, name, data, cond);
    }
    return res;
  }

  return {
    id: "role-relay",
    space,
    acl,
    getRaw,
    async get(name) {
      const o = await getRaw(name);
      if (!o) return null;
      const env = parseEnvelope(o.data);
      if (!env || env.op !== "put" || !(await verifyEnvelope(env, await space(), name)) || !(await signerAllowed(env.signer, name, env.aclSeq))) throw new RoleSignatureError(name);
      return { data: env.payload, etag: o.etag };
    },
    async put(name, data, cond?: PutCondition) {
      if (name === ACL_NAME) throw new RoleRefusedError(403, "acl", name);
      const res = await write("PUT", name, data, cond);
      if (!res.ok) throw await refused(res, name);
      return { etag: res.headers.get("ETag") ?? "" };
    },
    async delete(name) {
      const res = await write("DELETE", name, null, undefined);
      if (res.ok || res.status === 404) return;
      throw await refused(res, name);
    },
    async listAll() {
      const res = await go(base, { method: "GET", headers: headers() });
      if (res.status === 404) return [];
      if (!res.ok) throw await failed(res, "role-relay", "");
      const body = (await res.json()) as { names?: unknown };
      return Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string") : [];
    },
    async list() {
      return (await this.listAll()).filter((n) => !hidden(n));
    },
    async putAcl(next, admin) {
      // The ACL is its own signed body (no envelope).
      const res = await rawSend("PUT", ACL_NAME, await signAcl(next, admin), {});
      if (!res.ok) throw await refused(res, ACL_NAME);
      current = null;
      await acl(true);
    },
    async putJoin(name, data) {
      if (!name.startsWith("j-")) throw new RangeError("join request name");
      const res = await rawSend("PUT", name, data, { "If-None-Match": "*" });
      if (!res.ok) throw await refused(res, name);
    },
  };
}
