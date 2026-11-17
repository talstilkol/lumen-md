/**
 * The MCP servers the user added, as agent tools (plan W7.18, W10.C2): the
 * one place the app turns `lumen.mcp.servers` into transports and tools.
 *
 *   • Only enabled servers, and only tools not set to "block"
 *     (serverAgentTools applies permissions, pins and scopes).
 *   • HTTP: Streamable HTTP. A remote server's listing goes through the
 *     privacy ledger; its calls get the fetch the runtime's network gate
 *     hands the tool (consent, ledger, AI policy).
 *   • stdio (desktop only): one process per server, started on first use
 *     through the Tauri bridge, which runs only a command the user approved.
 *     stderr goes to the server log (log.ts); a start is in the privacy
 *     ledger as `stdio://<server>` when the program may reach the network.
 *   • Airplane mode: no remote server is listed or called (servers.ts
 *     `blockedReason`), and when the switch goes on, every running program
 *     not marked offline is closed at once (it could still be on the network).
 *   • Calls that need the user go to `askMcpCall` and elicitations to
 *     `askElicitation` (ui/McpDialogs.tsx), unless a caller passes its own.
 */
import type { AgentTool, ToolContext } from "../types";
import { getAiPolicy, onAiPolicyChange } from "../../ai/policy";
import { airplaneModeOn, onAirplaneOn } from "../../privacy/airplane";
import { httpTransport, type McpTransport } from "./client";
import { appendServerLog } from "./log";
import { blockedReason, readServers, type McpServerConfig, type ReachContext } from "./servers";
import { serverAgentTools, type BridgeOptions } from "./tools";
import { stdioTransport, tauriStdioBridge, type StdioBridge, type StdioTransport } from "./transports/stdio";
import { authHeaders } from "./signIn";

export interface RegistryOptions extends Partial<Pick<BridgeOptions, "confirmCall" | "elicit" | "approvals" | "onPin">> {
  servers?: McpServerConfig[];
  reach?: () => ReachContext;
  /** The stdio bridge (default: the desktop app's). */
  bridge?: StdioBridge;
  /** fetch for listing a server (default: the privacy ledger's). */
  listFetch?: (server: McpServerConfig) => typeof fetch;
}

const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Where the app is right now, for `blockedReason` (read again on every call). */
export function currentReach(): ReachContext {
  return { airplane: airplaneModeOn(), localOnly: getAiPolicy() === "local-only", desktop: isDesktop() };
}

const pool = new Map<string, StdioTransport>();
let airplaneHooked = false;

const specKey = (s: McpServerConfig) => JSON.stringify([s.id, s.command, s.args ?? [], s.cwd ?? null, !!s.offline]);

/** Close running server programs (all, or those that may reach the network). `why`: the log's reason for a remote close. */
export async function closeStdioServers(which: "all" | "remote" = "all", why = "airplane mode came on"): Promise<number> {
  let n = 0;
  for (const [key, t] of [...pool]) {
    if (which === "remote" && t.reach !== "remote") continue;
    pool.delete(key);
    n++;
    const id = (JSON.parse(key) as [string])[0];
    appendServerLog(id, "lumen", which === "remote" ? `closed: ${why}` : "closed");
    await t.close().catch(() => {
      /* why: a program that already exited has nothing left to close */
    });
  }
  return n;
}

function hookAirplane(): void {
  if (airplaneHooked) return;
  airplaneHooked = true;
  onAirplaneOn(() => void closeStdioServers("remote"));
  // R8-L11: local-only too. Calls were re-checked, but a running program kept its own network access.
  onAiPolicyChange(() => {
    if (getAiPolicy() === "local-only") void closeStdioServers("remote", "local-only came on");
  });
}

function stdioFor(server: McpServerConfig, bridge: StdioBridge): StdioTransport {
  const key = specKey(server);
  const live = pool.get(key);
  if (live && live.state !== "closed") return live;
  const reach = server.offline ? "local" : "remote";
  const t = stdioTransport({ id: server.id, label: server.label }, { command: server.command ?? "", args: server.args ?? [], ...(server.cwd ? { cwd: server.cwd } : {}) }, bridge, {
    reach,
    onStderr: (line) => appendServerLog(server.id, "stderr", line),
    onExit: (code) => {
      appendServerLog(server.id, "lumen", `stopped${code === null ? "" : ` (exit ${code})`}`);
      if (pool.get(key) === t) pool.delete(key);
    },
    // R8b-L6: a server that stopped reading its input is closed and leaves the pool; the next call starts a new one.
    onStuck: (why) => {
      appendServerLog(server.id, "lumen", `closed: it stopped reading its input (${why.slice(0, 120)})`);
      if (pool.get(key) === t) pool.delete(key);
    },
  });
  pool.set(key, t);
  appendServerLog(server.id, "lumen", `starting ${server.command ?? ""} ${(server.args ?? []).join(" ")}`.trim());
  if (reach === "remote") {
    void import("../../ai/privacyLedger").then(({ recordProcessCall }) => recordProcessCall(`stdio://${encodeURIComponent(server.id)}`, `MCP server program started: ${server.command ?? ""}`, 0, false));
  }
  return t;
}

/** The transport for one server, for a listing (no ctx) or a call (the runtime's ctx). */
export function transportFor(server: McpServerConfig, o: Pick<RegistryOptions, "bridge" | "listFetch"> = {}): (ctx?: ToolContext) => McpTransport {
  if (server.transport === "stdio") {
    const bridge = o.bridge ?? tauriStdioBridge();
    return () => stdioFor(server, bridge);
  }
  const url = server.url ?? "";
  const listFetch = o.listFetch ?? (() => ((input: RequestInfo | URL, init?: RequestInit) => import("../../ai/privacyLedger").then(({ ledgerFetch }) => ledgerFetch({ force: { category: "network", reason: `MCP server ${server.label}` } })(input, init))) as typeof fetch);
  // A call to a remote server uses the fetch the network gate handed the tool (ledger, consent); a local one the page's.
  // W13.A1: a token from the server's sign-in (signIn.ts) goes to this server only, from its recorded issuer.
  return (ctx?: ToolContext) => httpTransport(url, () => ctx?.fetch ?? listFetch(server), () => authHeaders(server));
}

/**
 * Every tool of every enabled server the user may use now, and the servers
 * that failed (their tools are left out; the rest still work).
 */
export async function mcpAgentTools(o: RegistryOptions = {}): Promise<{ tools: AgentTool[]; problems: Array<{ server: string; error: string }> }> {
  const servers = (o.servers ?? readServers()).filter((s) => s.enabled);
  if (!servers.length) return { tools: [], problems: [] };
  hookAirplane();
  const reach = o.reach ?? currentReach;
  const dialogs = !o.confirmCall || !o.elicit ? await import("../../ui/McpDialogs") : null;
  const bridge: BridgeOptions = {
    reach,
    confirmCall: o.confirmCall ?? dialogs!.askMcpCall,
    ...(o.elicit || dialogs ? { elicit: o.elicit ?? dialogs!.askElicitation } : {}),
    ...(o.approvals ? { approvals: o.approvals } : {}),
    ...(o.onPin ? { onPin: o.onPin } : {}),
  };
  const tools: AgentTool[] = [];
  const problems: Array<{ server: string; error: string }> = [];
  for (const s of servers) {
    const why = blockedReason(s, s.transport === "http" ? httpTransport(s.url ?? "", () => fetch).reach : s.offline ? "local" : "remote", reach());
    if (why) {
      problems.push({ server: s.label, error: why });
      continue;
    }
    try {
      tools.push(...(await serverAgentTools(s, transportFor(s, o), bridge)));
    } catch (e) {
      const error = String((e as Error)?.message ?? e).slice(0, 300);
      appendServerLog(s.id, "lumen", `tools/list failed: ${error}`);
      problems.push({ server: s.label, error });
    }
  }
  return { tools, problems };
}

export interface ListedTool {
  tool: import("./client").McpTool;
  hash: string;
  /** "pinned": as approved; "changed": differs from the approved definition; "new": never approved. */
  pin: "pinned" | "changed" | "new";
  permission: import("./servers").ToolPermission;
}

/** The settings screen's "Show tools": one listing, only when the user asks. Respects airplane mode and the AI policy. */
export async function listServerTools(server: McpServerConfig, o: Pick<RegistryOptions, "bridge" | "listFetch" | "reach"> = {}): Promise<ListedTool[]> {
  const make = transportFor({ ...server, enabled: true }, o);
  const probe = make();
  const why = blockedReason({ ...server, enabled: true }, probe.reach, (o.reach ?? currentReach)());
  if (why) throw new Error(why);
  const [{ McpClient }, { toolHash }, { effectivePermission }] = await Promise.all([import("./client"), import("./approvals"), import("./servers")]);
  const listed = await new McpClient(probe, { serverLabel: server.label }).listTools();
  const out: ListedTool[] = [];
  for (const t of listed) {
    const hash = await toolHash(t);
    const p = server.pins?.[t.name];
    out.push({ tool: t, hash, pin: p === undefined ? "new" : p === hash ? "pinned" : "changed", permission: effectivePermission(server, t) });
  }
  return out;
}
