/**
 * Cached MCP lists (plan W13.A2; spec 2026-07-28, SEP-2549): `tools/list`,
 * `prompts/list`, `resources/list` and `resources/read` results carry
 * `ttlMs` and `cacheScope`, and a client may keep them that long instead of
 * asking again.
 *
 * - No `ttlMs` (or 0, or not a finite number): nothing is cached.
 * - `ttlMs` is capped at one day, so a server cannot pin a stale list.
 * - `cacheScope`: only an explicit shared scope (`"global"`, `"shared"`,
 *   `"public"`) lets one vault reuse another's copy. `"user"`, any other
 *   value and none are per vault: a list a server computed for the user
 *   while working in one vault is never handed to another vault (each
 *   vault has its own trust and scope rules, plan W11.I7).
 * - A `notifications/*\/list_changed` from the server drops that list for
 *   that server at once.
 */

export const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const SHARED_SCOPES = new Set(["global", "shared", "public"]);

export type ListKind = "tools/list" | "prompts/list" | "resources/list" | "resources/read";

interface Entry {
  value: unknown;
  expires: number;
}

export function cacheTtl(result: Record<string, unknown>): number {
  const ttl = result.ttlMs;
  return typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl, MAX_TTL_MS) : 0;
}

export function isShared(result: Record<string, unknown>): boolean {
  return typeof result.cacheScope === "string" && SHARED_SCOPES.has(result.cacheScope);
}

export class ListCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private key(server: string, kind: ListKind, vault: string | null, arg = ""): string {
    return JSON.stringify([server, kind, vault, arg]);
  }

  /** A fresh copy for this vault (its own, or a shared one), or undefined. */
  get<T>(server: string, kind: ListKind, vault: string, arg = ""): T | undefined {
    const t = this.now();
    for (const k of [this.key(server, kind, vault, arg), this.key(server, kind, null, arg)]) {
      const e = this.entries.get(k);
      if (!e) continue;
      if (e.expires > t) return e.value as T;
      this.entries.delete(k);
    }
    return undefined;
  }

  /** Keep `value` as long as the server's result says (its first page decides). */
  put(server: string, kind: ListKind, vault: string, firstPage: Record<string, unknown>, value: unknown, arg = ""): boolean {
    const ttl = cacheTtl(firstPage);
    if (!ttl) return false;
    this.entries.set(this.key(server, kind, isShared(firstPage) ? null : vault, arg), { value, expires: this.now() + ttl });
    return true;
  }

  /** The server said its list changed: drop every copy of it. */
  invalidate(server: string, kind?: ListKind): void {
    for (const k of [...this.entries.keys()]) {
      const [s, kd] = JSON.parse(k) as [string, string];
      if (s === server && (!kind || kd === kind || (kind === "resources/list" && kd === "resources/read"))) this.entries.delete(k);
    }
  }

  /** `notifications/tools/list_changed` and the like → the list to drop. */
  onNotification(server: string, method: string): void {
    const m = /^notifications\/(tools|prompts|resources)\/list_changed$/.exec(method);
    if (m) this.invalidate(server, `${m[1]}/list` as ListKind);
    else if (method === "notifications/resources/updated") this.invalidate(server, "resources/read");
  }

  get size(): number {
    return this.entries.size;
  }
}
