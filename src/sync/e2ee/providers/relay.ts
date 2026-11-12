/**
 * The encrypted relay as a `SyncProvider` (plan W4.19): for phones and
 * browsers with no desktop sync folder, and no WebDAV. The relay is the same
 * host as the live-share server (#469); it stores opaque, already encrypted
 * objects and nothing else (sync-server/vault-relay.js).
 *
 * No account: a vault's space on the relay is named by a bearer token that is
 * derived from the vault's recovery words (setup/recoveryWords.ts), so a
 * second device needs nothing but the words. The relay keeps only the
 * token's SHA-256, never the token, and never a key.
 *
 *   GET    /v1/vault/o/            → {"names": [...]}
 *   GET    /v1/vault/o/<name>      → bytes, ETag            (404: none)
 *   PUT    /v1/vault/o/<name>      If-Match / If-None-Match: *   (412: lost race)
 *   DELETE /v1/vault/o/<name>
 */

import { PreconditionFailedError, type PutCondition, type StoredObject, type SyncProvider } from "../provider";
import { checkObjectName, defaultFetch, failed, request, type FetchLike } from "./http";

export interface RelayConfig {
  /** The relay's https origin, e.g. `https://relay.example.com`. */
  url: string;
  /** The space token (secret store; derived from the recovery words). */
  token: string;
}

export interface RelayProvider extends SyncProvider {
  /** Is the relay there and does it take this token? */
  probe(): Promise<void>;
}

/** The relay origin for a live-share server URL (`wss://host/…` → `https://host`). */
export function relayOrigin(collabUrl: string | undefined | null): string | null {
  if (!collabUrl) return null;
  try {
    const u = new URL(collabUrl);
    if (u.protocol === "wss:" || u.protocol === "https:") return `https://${u.host}`;
    // Plain ws/http only for a server on this machine (development).
    if ((u.protocol === "ws:" || u.protocol === "http:") && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return `http://${u.host}`;
    return null;
  } catch {
    return null;
  }
}

export function relayProvider(cfg: RelayConfig, deps: { fetch?: FetchLike } = {}): RelayProvider {
  const fetchImpl = deps.fetch ?? defaultFetch;
  const base = `${cfg.url.replace(/\/+$/, "")}/v1/vault/o/`;
  const headers = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${cfg.token}`, ...extra });
  const url = (name: string) => {
    checkObjectName(name);
    return base + encodeURIComponent(name);
  };
  const go = (input: string, init: RequestInit) => request(fetchImpl, input, init, { provider: "relay" });

  return {
    id: "relay",

    async probe() {
      const res = await go(base, { method: "GET", headers: headers() });
      if (!res.ok) throw await failed(res, "relay", "");
    },

    async get(name): Promise<StoredObject | null> {
      const res = await go(url(name), { method: "GET", headers: headers() });
      if (res.status === 404) return null;
      if (!res.ok) throw await failed(res, "relay", name);
      const etag = res.headers.get("ETag");
      if (!etag) throw await failed(res, "relay", name);
      return { data: new Uint8Array(await res.arrayBuffer()), etag };
    },

    async put(name, data, cond?: PutCondition) {
      const pre: Record<string, string> = {};
      if (cond && "ifMatch" in cond) pre["If-Match"] = cond.ifMatch;
      if (cond && "ifNoneMatch" in cond) pre["If-None-Match"] = "*";
      const res = await go(url(name), { method: "PUT", headers: headers({ "Content-Type": "application/octet-stream", ...pre }), body: data as BodyInit });
      if (res.status === 412) throw new PreconditionFailedError(name);
      if (!res.ok) throw await failed(res, "relay", name);
      return { etag: res.headers.get("ETag") ?? "" };
    },

    async delete(name) {
      const res = await go(url(name), { method: "DELETE", headers: headers() });
      if (res.ok || res.status === 404) return;
      throw await failed(res, "relay", name);
    },

    async list() {
      const res = await go(base, { method: "GET", headers: headers() });
      if (res.status === 404) return [];
      if (!res.ok) throw await failed(res, "relay", "");
      const body = (await res.json()) as { names?: unknown };
      return Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string") : [];
    },
  };
}
