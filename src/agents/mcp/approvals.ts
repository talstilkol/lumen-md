/**
 * Tool pinning and approval scopes for the MCP client (plan W7.18, W10.C2;
 * research R4 §1.3, after VS Code's MCP security model).
 *
 *   • Every tool definition has a hash: SHA-256 of its canonical JSON (name,
 *     title, description, input and output schema, annotations). A server
 *     that changes a tool after the user saw it, even one word of its
 *     description, changes the hash.
 *   • The first hash the user approved is the tool's **pin** (kept with the
 *     server's settings). A tool whose hash differs from its pin is
 *     "changed": it asks again whatever its permission, and no earlier
 *     approval counts (approvals are for one hash). Accepting the change for
 *     the vault moves the pin; accepting it once or for the session does not,
 *     so it asks again next time.
 *   • An approval has a scope: **once** (this call), **session** (until the
 *     app reloads) or **vault** (kept for this vault on this device).
 *   • A tool never pinned is "new": its first call asks, even a "read" one.
 */
import type { McpTool } from "./client";

export type ApprovalScope = "once" | "session" | "vault";
export type ToolStatus = "approved" | "new" | "changed" | "ask";

/** JSON with sorted keys at every level: the same definition always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export async function toolHash(tool: McpTool): Promise<string> {
  const def = { name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations };
  const bytes = new TextEncoder().encode(canonicalJson(def));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Store = Pick<Storage, "getItem" | "setItem">;
export const APPROVALS_KEY = "lumen.mcp.approvals";

const ls = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** The vault these approvals belong to: the vault location the app stored (folder name or the browser's), else "browser". */
export function currentVaultKey(store: Store | null = ls()): string {
  try {
    const raw = store?.getItem("lumen-vault-location");
    if (!raw) return "browser";
    const v = JSON.parse(raw) as { location?: string; name?: string };
    return `${v.location ?? "browser"}:${v.name ?? ""}`;
  } catch {
    return "browser";
  }
}

const k = (server: string, tool: string) => JSON.stringify([server, tool]);

export interface ApprovalsOptions {
  store?: Store | null;
  vaultKey?: () => string;
}

/** Approvals for this run of the app (session) and this vault (vault). */
export class ToolApprovals {
  private session = new Map<string, string>();
  private store: Store | null;
  private vaultKey: () => string;

  constructor(o: ApprovalsOptions = {}) {
    this.store = o.store === undefined ? ls() : o.store;
    this.vaultKey = o.vaultKey ?? (() => currentVaultKey(this.store));
  }

  private readVault(): Record<string, Record<string, string>> {
    try {
      const v = JSON.parse(this.store?.getItem(APPROVALS_KEY) ?? "{}") as Record<string, Record<string, string>>;
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }

  private writeVault(all: Record<string, Record<string, string>>): void {
    try {
      this.store?.setItem(APPROVALS_KEY, JSON.stringify(all));
    } catch {
      /* why: storage blocked or full: the approval lasts for this session (it is also kept there) */
    }
  }

  /** Is a call of this exact definition approved beyond "once"? */
  approved(server: string, tool: string, hash: string): ApprovalScope | null {
    if (this.readVault()[this.vaultKey()]?.[k(server, tool)] === hash) return "vault";
    if (this.session.get(k(server, tool)) === hash) return "session";
    return null;
  }

  grant(server: string, tool: string, hash: string, scope: ApprovalScope): void {
    if (scope === "once") return;
    this.session.set(k(server, tool), hash);
    if (scope === "vault") {
      const all = this.readVault();
      const key = this.vaultKey();
      all[key] = { ...(all[key] ?? {}), [k(server, tool)]: hash };
      this.writeVault(all);
    }
  }

  /** Forget a server's approvals (every tool, or one). */
  revoke(server: string, tool?: string): void {
    for (const key of [...this.session.keys()]) {
      const [s, t] = JSON.parse(key) as [string, string];
      if (s === server && (tool === undefined || t === tool)) this.session.delete(key);
    }
    const all = this.readVault();
    for (const vk of Object.keys(all)) {
      for (const key of Object.keys(all[vk] ?? {})) {
        const [s, t] = JSON.parse(key) as [string, string];
        if (s === server && (tool === undefined || t === tool)) delete all[vk]![key];
      }
    }
    this.writeVault(all);
  }

  /** Tests: a new app session. */
  resetSession(): void {
    this.session.clear();
  }
}

/** The app's approvals (one per page). */
export const toolApprovals = new ToolApprovals();

/**
 * What a call needs, from the tool's permission ("read" or "ask"), its pin
 * and its hash: run ("approved") or ask the user, and why.
 */
export function callStatus(perm: "read" | "ask", pin: string | undefined, hash: string, approvals: Pick<ToolApprovals, "approved">, server: string, tool: string): ToolStatus {
  const granted = approvals.approved(server, tool, hash);
  if (pin !== undefined && pin !== hash && !granted) return "changed";
  if (pin === undefined && !granted) return "new";
  if (perm === "read") return "approved";
  return granted ? "approved" : "ask";
}
