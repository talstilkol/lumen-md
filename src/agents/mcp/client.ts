/**
 * Lumen as an MCP client (plan W7.18, W10.C1): the local agents use tools of
 * outside MCP servers. Dual-era, like our server (W7.17):
 *
 *   • 2026-07-28 first: every request carries the protocol version, the
 *     client's capabilities and identity in `_meta` (stateless: no session);
 *     `server/discover` probes the server; results carry `resultType`
 *     (absent = "complete").
 *   • A server that answers the probe with anything but a modern result or
 *     error is legacy (2025-11-25 and earlier): `initialize`, then
 *     `notifications/initialized`, then requests in its session
 *     (Streamable HTTP: the `Mcp-Session-Id` header).
 *
 * Elicitation (MRTR, SEP-2322): with an `elicit` handler the client declares
 * `elicitation: { form, url }` on every request. A tool call answered with
 * `resultType: "input_required"` is shown to the user (the handler: the
 * dialog that meets the spec's MUSTs, elicitation.ts) and retried with a new
 * id, the user's `inputResponses` and the server's `requestState` echoed
 * exactly. Without a handler no capability is declared and `input_required`
 * is reported to the agent as "needs the user", never fulfilled. Sampling
 * and roots are deprecated (SEP-2577) and never offered.
 *
 * Streamable HTTP mirrors `Mcp-Method` and `Mcp-Name` (base64 sentinel for
 * values that are not plain header text) and each `x-mcp-header` parameter
 * as `Mcp-Param-{Name}`; a tool whose `x-mcp-header` breaks the spec's rules
 * is left out of the list on HTTP.
 */
import type { ElicitationHandler, ElicitationResult } from "./elicitation";
import type { ListCache } from "./listCache";
import { expired, parseTask, pollDelay, serverTasks, TERMINAL, type TaskState } from "./serverTasks";

/** The Tasks extension's id (SEP-2663). */
export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";

export const CLIENT_INFO = { name: "lumen", version: "1" } as const;
export const MODERN = "2026-07-28";
export const LEGACY = "2025-11-25";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

/** One request in, its response out (null for a notification). */
export interface SendMeta {
  protocolVersion: string;
  sessionId?: string;
  /** Streamable HTTP: `Mcp-Param-{Name}` headers for the tool's `x-mcp-header` parameters (already encoded). */
  paramHeaders?: Record<string, string>;
}

export interface McpTransport {
  /** "local": stdio or a loopback address; "remote": anything else (blocked in airplane mode). */
  readonly reach: "local" | "remote";
  /** "http" mirrors body fields into headers (and so checks `x-mcp-header`); others may ignore them. */
  readonly binding?: "http" | "stdio" | "memory";
  send(msg: JsonRpcMessage, meta: SendMeta): Promise<{ message: JsonRpcMessage | null; sessionId?: string }>;
  /**
   * W13.A2: a transport that can stream (`subscriptions/listen`) delivers the
   * server's notifications for this request to `onMessage` until `signal`
   * aborts. Optional: without it, tasks are polled.
   */
  listen?(msg: JsonRpcMessage, meta: SendMeta, onMessage: (m: JsonRpcMessage) => void, signal: AbortSignal): Promise<void>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  title?: string;
  outputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean; idempotentHint?: boolean; title?: string };
}

export type McpCallResult =
  | { kind: "complete"; text: string; isError: boolean; structured?: unknown }
  | { kind: "input_required"; text: string; declined?: boolean };

export interface ClientOptions {
  /** Shows an elicitation to the user. With it, the client declares the elicitation capability. */
  elicit?: ElicitationHandler;
  /** The server's name as the user gave it (shown as who asks). */
  serverLabel?: string;
  /** Most rounds of input_required for one call (each one is a user prompt or a retry). */
  maxRounds?: number;
  /** Logs a tool left out of the list (an invalid `x-mcp-header`). */
  warn?: (message: string) => void;
  /** W13.A2: declare the Tasks extension, so a long tool call may come back as a task. */
  tasks?: boolean;
  /** W13.A2: keep lists for their `ttlMs` (per vault unless the server says they are shared). */
  listCache?: { cache: ListCache; server: string; vault: string };
  /** Waits between polls (tests pass a fake clock). Resolves early when `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

/** How a tool call that became a task is followed. */
export interface CallOptions {
  /** Cancel: sends `tasks/cancel` and stops waiting. */
  signal?: AbortSignal;
  /** Each status the task reports. */
  onTask?: (t: TaskState) => void;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(id), resolve()), { once: true });
  });

/** How many times one call may come back input_required before Lumen stops retrying. */
export const MAX_INPUT_ROUNDS = 6;

export class McpClientError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "McpClientError";
  }
}

const MODERN_ERRORS = new Set([-32020, -32021, -32022]);

type ServerInfo = { name?: string; version?: string };

export class McpClient {
  era: "modern" | "legacy" | null = null;
  private version = MODERN;
  private sessionId?: string;
  private seq = 0;
  serverInfo: ServerInfo = {};
  instructions?: string;

  private schemas = new Map<string, Record<string, unknown> | undefined>();

  constructor(
    readonly transport: McpTransport,
    readonly opts: ClientOptions = {},
  ) {}

  /** The client capabilities sent with every modern request. */
  capabilities(): Record<string, unknown> {
    // Both modes: form (in-band, reviewed by the user) and url (opened outside Lumen). Never sampling or roots (deprecated).
    return { ...(this.opts.elicit ? { elicitation: { form: {}, url: {} } } : {}), ...(this.opts.tasks ? { extensions: { [TASKS_EXTENSION]: {} } } : {}) };
  }

  private meta(): Record<string, unknown> {
    return { "io.modelcontextprotocol/protocolVersion": this.version, "io.modelcontextprotocol/clientInfo": CLIENT_INFO, "io.modelcontextprotocol/clientCapabilities": this.capabilities() };
  }

  private async raw(method: string, params: Record<string, unknown> = {}, notify = false, extra: Pick<SendMeta, "paramHeaders"> = {}): Promise<JsonRpcMessage | null> {
    const msg: JsonRpcMessage = { jsonrpc: "2.0", method, params, ...(notify ? {} : { id: ++this.seq }) };
    const r = await this.transport.send(msg, { protocolVersion: this.version, sessionId: this.sessionId, ...extra });
    if (r.sessionId) this.sessionId = r.sessionId;
    return r.message;
  }

  /** Decide the server's era once (spec: Versioning, backward compatibility). */
  async connect(): Promise<void> {
    if (this.era) return;
    // A transport failure (the program was not approved or did not start, the network is off) is not an
    // answer: it is thrown, never taken for a legacy server. Only an answer that is not modern falls back.
    const probe: JsonRpcMessage | null = await this.raw("server/discover", { _meta: this.meta() });
    if (probe?.result && Array.isArray(probe.result.supportedVersions)) {
      const v = probe.result.supportedVersions as string[];
      if (!v.includes(MODERN)) throw new McpClientError(`the server speaks ${v.join(", ")}, not ${MODERN}`);
      this.era = "modern";
      this.serverInfo = (probe.result.serverInfo as ServerInfo | undefined) ?? {};
      this.instructions = typeof probe.result.instructions === "string" ? probe.result.instructions : undefined;
      return;
    }
    if (probe?.error && MODERN_ERRORS.has(probe.error.code)) {
      const supported = (probe.error.data as { supported?: string[] } | undefined)?.supported ?? [];
      throw new McpClientError(`the server does not speak ${MODERN} (it speaks ${supported.join(", ") || "something else"})`, probe.error.code);
    }
    // Legacy server: the handshake.
    this.version = LEGACY;
    const init = await this.raw("initialize", { protocolVersion: LEGACY, capabilities: {}, clientInfo: CLIENT_INFO });
    if (!init?.result) throw new McpClientError(`initialize failed: ${init?.error?.message ?? "no answer"}`, init?.error?.code);
    this.version = typeof init.result.protocolVersion === "string" ? init.result.protocolVersion : LEGACY;
    this.serverInfo = (init.result.serverInfo as ServerInfo | undefined) ?? {};
    this.instructions = typeof init.result.instructions === "string" ? init.result.instructions : undefined;
    await this.raw("notifications/initialized", {}, true);
    this.era = "legacy";
  }

  private async request(method: string, params: Record<string, unknown>, extra: Pick<SendMeta, "paramHeaders"> = {}, allowTask = false): Promise<Record<string, unknown>> {
    await this.connect();
    const res = await this.raw(method, this.era === "modern" ? { ...params, _meta: this.meta() } : params, false, extra);
    if (!res) throw new McpClientError(`${method}: no answer`);
    if (res.error) throw new McpClientError(`${method}: ${res.error.message}`, res.error.code);
    const result = res.result ?? {};
    const type = result.resultType ?? "complete";
    // A task only where we declared the extension, and only for tools/call (SEP-2663: anything else is an invalid response).
    if (type === "task" && !(allowTask && this.opts.tasks)) throw new McpClientError(`${method}: the server answered with a task Lumen did not ask for`);
    if (type !== "complete" && type !== "input_required" && type !== "task") throw new McpClientError(`${method}: unknown resultType "${String(type)}"`);
    return result;
  }

  async listTools(): Promise<McpTool[]> {
    const lc = this.opts.listCache;
    const cached = lc?.cache.get<McpTool[]>(lc.server, "tools/list", lc.vault);
    if (cached) {
      for (const t of cached) this.schemas.set(t.name, t.inputSchema);
      return cached;
    }
    const out: McpTool[] = [];
    let cursor: string | undefined;
    let first: Record<string, unknown> | null = null;
    for (let page = 0; page < 20; page++) {
      const r = await this.request("tools/list", cursor ? { cursor } : {});
      first ??= r;
      for (const t of (r.tools as McpTool[] | undefined) ?? []) {
        if (!t || typeof t.name !== "string") continue;
        // Streamable HTTP clients MUST leave out a tool whose x-mcp-header breaks the rules (spec: Schema Extension).
        if (this.transport.binding === "http") {
          const bad = headerAnnotationError(t.inputSchema);
          if (bad) {
            this.opts.warn?.(`MCP tool "${t.name.slice(0, 80)}" left out: ${bad}`);
            continue;
          }
        }
        this.schemas.set(t.name, t.inputSchema);
        out.push(t);
      }
      cursor = typeof r.nextCursor === "string" ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    if (lc && first) lc.cache.put(lc.server, "tools/list", lc.vault, first, out);
    return out;
  }

  /** `resources/list`, cached like the tools. */
  async listResources(): Promise<Array<{ uri: string; name?: string; mimeType?: string }>> {
    const lc = this.opts.listCache;
    const cached = lc?.cache.get<Array<{ uri: string; name?: string; mimeType?: string }>>(lc.server, "resources/list", lc.vault);
    if (cached) return cached;
    const out: Array<{ uri: string; name?: string; mimeType?: string }> = [];
    let cursor: string | undefined;
    let first: Record<string, unknown> | null = null;
    for (let page = 0; page < 20; page++) {
      const r = await this.request("resources/list", cursor ? { cursor } : {});
      first ??= r;
      for (const x of (r.resources as Array<{ uri?: unknown; name?: unknown; mimeType?: unknown }> | undefined) ?? []) {
        if (x && typeof x.uri === "string") out.push({ uri: x.uri, ...(typeof x.name === "string" ? { name: x.name } : {}), ...(typeof x.mimeType === "string" ? { mimeType: x.mimeType } : {}) });
      }
      cursor = typeof r.nextCursor === "string" ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    if (lc && first) lc.cache.put(lc.server, "resources/list", lc.vault, first, out);
    return out;
  }

  /** A server notification (from a stream): list changes drop the cached lists. */
  onNotification(msg: JsonRpcMessage): void {
    const lc = this.opts.listCache;
    if (lc && msg.method) lc.cache.onNotification(lc.server, msg.method);
  }

  /** Answers to a set of elicitation requests (MRTR or a task's inputRequests), through the user's dialog. */
  private async answer(asks: Record<string, unknown>, method: string): Promise<{ answers: Record<string, ElicitationResult>; refused: ElicitationResult["action"] | null }> {
    const { parseElicitation, ElicitationError } = await import("./elicitation");
    const answers: Record<string, ElicitationResult> = {};
    let refused: ElicitationResult["action"] | null = null;
    for (const [key, req] of Object.entries(asks).slice(0, 10)) {
      const m = req && typeof req === "object" ? (req as { method?: unknown }).method : undefined;
      if (m !== "elicitation/create") throw new McpClientError(`${method}: the server asked for ${String(m).slice(0, 60)}, which Lumen does not offer`);
      let ans: ElicitationResult;
      try {
        ans = await this.opts.elicit!({ server: this.opts.serverLabel ?? this.serverInfo.name ?? "MCP server", key, request: parseElicitation((req as { params?: unknown }).params) });
      } catch (e) {
        if (e instanceof ElicitationError) ans = { action: "decline" };
        else throw e;
      }
      answers[key] = ans.action === "accept" ? ans : { action: ans.action };
      if (ans.action !== "accept") refused = refused === "cancel" ? "cancel" : ans.action;
    }
    return { answers, refused };
  }

  /**
   * Follow a task to its end (SEP-2663): poll `tasks/get` at the server's
   * interval (or take `notifications/tasks` from a stream), answer its input
   * requests once each with `tasks/update`, `tasks/cancel` on abort, and give
   * up after its TTL. Listed in `serverTasks` while it runs.
   */
  private async followTask(tool: string, seed: TaskState, call: CallOptions): Promise<McpCallResult> {
    const sleep = this.opts.sleep ?? defaultSleep;
    const now = this.opts.now ?? (() => Date.now());
    const startedAt = now();
    const answered = new Set<string>();
    const local = new AbortController();
    const stop = () => local.abort();
    call.signal?.addEventListener("abort", stop, { once: true });
    let task = seed;
    let pushed: TaskState | null = null;
    let wake: (() => void) | null = null;
    const rowId = `${this.opts.serverLabel ?? this.serverInfo.name ?? "mcp"}:${task.taskId}`;
    const show = () => serverTasks.upsert({ id: rowId, server: this.opts.serverLabel ?? this.serverInfo.name ?? "MCP server", tool, status: task.status, ...(task.statusMessage ? { statusMessage: task.statusMessage } : {}), startedAt, cancel: stop });
    // A streaming transport: listen for this task's notifications (polling stays as the fallback).
    if (this.transport.listen && this.era === "modern") {
      const msg: JsonRpcMessage = { jsonrpc: "2.0", id: ++this.seq, method: "subscriptions/listen", params: { notifications: { taskIds: [task.taskId] }, _meta: this.meta() } };
      void this.transport
        .listen(msg, { protocolVersion: this.version }, (m) => {
          if (m.method === "notifications/tasks" && m.params?.taskId === task.taskId) {
            try {
              pushed = parseTask(m.params);
              wake?.();
            } catch {
              /* a malformed notification: the next poll decides */
            }
          } else this.onNotification(m);
        }, local.signal)
        .catch(() => undefined);
    }
    try {
      for (;;) {
        call.onTask?.(task);
        show();
        if (local.signal.aborted) {
          await this.request("tasks/cancel", { taskId: task.taskId }).catch(() => undefined);
          throw new DOMException("The task was cancelled.", "AbortError");
        }
        if (TERMINAL.has(task.status)) break;
        if (expired(task, now(), startedAt)) throw new McpClientError(`the task ${task.taskId.slice(0, 40)} passed its time to live without finishing`);
        if (task.status === "input_required" && task.inputRequests) {
          const fresh = Object.fromEntries(Object.entries(task.inputRequests).filter(([k]) => !answered.has(k)));
          if (Object.keys(fresh).length) {
            if (!this.opts.elicit) return { kind: "input_required", text: "The server's task needs the user's input to finish (it was not given)." };
            const { answers } = await this.answer(fresh, "tasks/get");
            for (const k of Object.keys(fresh)) answered.add(k);
            await this.request("tasks/update", { taskId: task.taskId, inputResponses: answers });
          }
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          void sleep(pollDelay(task), local.signal).then(resolve);
        });
        wake = null;
        if (local.signal.aborted) continue;
        if (pushed) {
          task = pushed;
          pushed = null;
          continue;
        }
        task = parseTask(await this.request("tasks/get", { taskId: task.taskId }));
      }
    } finally {
      local.abort();
      call.signal?.removeEventListener("abort", stop);
      serverTasks.remove(rowId);
    }
    if (task.status === "completed") return completeOf(task.result ?? {});
    if (task.status === "cancelled") return { kind: "complete", text: "The server cancelled the task.", isError: true };
    return { kind: "complete", text: `The server's task failed: ${String(task.error?.message ?? task.statusMessage ?? "no reason given").slice(0, 500)}`, isError: true };
  }

  /**
   * Call a tool. An `input_required` answer is shown to the user through
   * `opts.elicit` and retried (MRTR client rules 1–4): a new JSON-RPC id, the
   * answers keyed as asked, `requestState` echoed exactly and only when the
   * server sent one. Without a handler, or after a decline or cancel the
   * server still waits on, the result is `input_required`.
   */
  async callTool(name: string, args: Record<string, unknown>, call: CallOptions = {}): Promise<McpCallResult> {
    const paramHeaders = this.transport.binding === "http" ? paramHeadersFor(this.schemas.get(name), args) : undefined;
    const extra = paramHeaders && Object.keys(paramHeaders).length ? { paramHeaders } : {};
    let params: Record<string, unknown> = { name, arguments: args };
    let refused: ElicitationResult["action"] | null = null;
    const rounds = this.opts.maxRounds ?? MAX_INPUT_ROUNDS;
    for (let round = 0; ; round++) {
      const r = await this.request("tools/call", params, extra, true);
      if (r.resultType === "task") return this.followTask(name, parseTask(r), call);
      if (r.resultType !== "input_required") return completeOf(r);
      const asks = r.inputRequests && typeof r.inputRequests === "object" && !Array.isArray(r.inputRequests) ? (r.inputRequests as Record<string, unknown>) : null;
      const state = r.requestState;
      if (!asks && typeof state !== "string") throw new McpClientError("tools/call: input_required without inputRequests or requestState");
      if (!this.opts.elicit || refused || round >= rounds) {
        return { kind: "input_required", text: refused ? `The user ${refused === "decline" ? "declined" : "cancelled"} the server's request, and the server still needs it.` : "The server needs the user's input to finish this (it was not given).", ...(refused ? { declined: true } : {}) };
      }
      let answers: Record<string, ElicitationResult> = {};
      if (asks) {
        const got = await this.answer(asks, "tools/call");
        answers = got.answers;
        if (got.refused) refused = got.refused;
      }
      params = { name, arguments: args, ...(asks ? { inputResponses: answers } : {}), ...(typeof state === "string" ? { requestState: state } : {}) };
    }
  }
}

function completeOf(r: Record<string, unknown>): McpCallResult {
  const content = Array.isArray(r.content) ? (r.content as Array<{ type?: string; text?: string }>) : [];
  const text = content
    .map((c) => (c.type === "text" ? String(c.text ?? "") : `[${c.type ?? "content"} not shown]`))
    .join("\n")
    .slice(0, 50_000);
  return { kind: "complete", text, isError: r.isError === true, ...(r.structuredContent !== undefined ? { structured: r.structuredContent } : {}) };
}

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SENTINEL = /^=\?base64\?.*\?=$/;

/** A header value per the spec's Value Encoding: plain visible ASCII as is, anything else as `=?base64?…?=`. */
export function encodeHeaderValue(v: string): string {
  const plain = /^[\x20-\x7E\t]*$/.test(v) && v === v.trim() && !SENTINEL.test(v);
  if (plain) return v;
  const bytes = new TextEncoder().encode(v);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?base64?${btoa(bin)}?=`;
}

/** Why a tool's `x-mcp-header` annotations are invalid (the tool is left out), or null. */
export function headerAnnotationError(schema: unknown): string | null {
  const seen = new Set<string>();
  const walk = (node: unknown, reachable: boolean, depth: number): string | null => {
    if (!node || typeof node !== "object" || depth > 12) return null;
    const n = node as Record<string, unknown>;
    if ("x-mcp-header" in n) {
      const h = n["x-mcp-header"];
      if (!reachable) return "x-mcp-header outside a chain of properties";
      if (typeof h !== "string" || !h || !TOKEN.test(h)) return "x-mcp-header is not a header token";
      const k = h.toLowerCase();
      if (seen.has(k)) return `x-mcp-header "${h}" is used twice`;
      seen.add(k);
      if (n.type !== "string" && n.type !== "integer" && n.type !== "boolean") return `x-mcp-header "${h}" is on a ${String(n.type)} (only string, integer, boolean)`;
    }
    for (const [key, child] of Object.entries(n)) {
      if (key === "properties" && child && typeof child === "object") {
        for (const p of Object.values(child as Record<string, unknown>)) {
          const e = walk(p, reachable, depth + 1);
          if (e) return e;
        }
      } else if (child && typeof child === "object") {
        const list = Array.isArray(child) ? child : [child];
        for (const c of list) {
          const e = walk(c, false, depth + 1);
          if (e) return e;
        }
      }
    }
    return null;
  };
  return walk(schema, true, 0);
}

/** `Mcp-Param-{Name}` headers for one call (values at each annotated property's path; omitted when absent or null). */
export function paramHeadersFor(schema: unknown, args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown, value: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 12) return;
    const n = node as Record<string, unknown>;
    const h = n["x-mcp-header"];
    if (typeof h === "string" && value !== undefined && value !== null) {
      let s: string | null = null;
      if (n.type === "string" && typeof value === "string") s = value;
      else if (n.type === "integer" && typeof value === "number" && Number.isSafeInteger(value)) s = String(value);
      else if (n.type === "boolean" && typeof value === "boolean") s = value ? "true" : "false";
      if (s !== null) out[`Mcp-Param-${h}`] = encodeHeaderValue(s);
    }
    if (n.properties && typeof n.properties === "object" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, p] of Object.entries(n.properties as Record<string, unknown>)) walk(p, (value as Record<string, unknown>)[k], depth + 1);
    }
  };
  if (!headerAnnotationError(schema)) walk(schema, args, 0);
  return out;
}

/** The `Mcp-Name` source: `params.name` (tools/call, prompts/get) or `params.uri` (resources/read). */
export function mcpNameOf(msg: JsonRpcMessage): string | undefined {
  const p = msg.params ?? {};
  if (msg.method === "tools/call" || msg.method === "prompts/get") return typeof p.name === "string" ? p.name : undefined;
  if (msg.method === "resources/read") return typeof p.uri === "string" ? p.uri : undefined;
  return undefined;
}

/** Is this URL on this machine (localhost, 127.0.0.0/8, ::1)? */
export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return false;
  }
}

/**
 * Streamable HTTP (spec 2026-07-28): POST one JSON-RPC message; the answer
 * is JSON or an SSE stream whose `data:` lines carry it. Standard headers:
 * MCP-Protocol-Version, Mcp-Method, Mcp-Name (tools/call, prompts/get,
 * resources/read; base64 sentinel when not plain), Mcp-Param-{Name} for
 * `x-mcp-header` parameters; Mcp-Session-Id for legacy.
 */
export function httpTransport(url: string, fetchImpl: () => typeof fetch, headers: () => Record<string, string> = () => ({})): McpTransport {
  return {
    reach: isLoopbackUrl(url) ? "local" : "remote",
    binding: "http",
    async send(msg, meta) {
      const name = mcpNameOf(msg);
      const res = await fetchImpl()(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": meta.protocolVersion,
          ...(msg.method ? { "Mcp-Method": msg.method } : {}),
          ...(name !== undefined ? { "Mcp-Name": encodeHeaderValue(name) } : {}),
          ...(meta.sessionId ? { "Mcp-Session-Id": meta.sessionId } : {}),
          ...(meta.paramHeaders ?? {}),
          ...headers(),
        },
        body: JSON.stringify(msg),
        // Never follow a redirect: it would carry the tool's arguments to another address (review 21, C3).
        redirect: "error",
      });
      const sessionId = res.headers.get("Mcp-Session-Id") ?? undefined;
      if (msg.id === undefined) return { message: null, sessionId };
      const type = res.headers.get("Content-Type") ?? "";
      const body = await res.text();
      let message: JsonRpcMessage | null = null;
      if (type.includes("text/event-stream")) {
        for (const line of body.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const m = JSON.parse(line.slice(5).trim()) as JsonRpcMessage;
            if (m.id === msg.id) message = m;
          } catch {
            // why: a server-sent event line that is not JSON-RPC is ignored; the next line may hold the answer
            /* a keep-alive or a partial line */
          }
        }
      } else if (body) {
        try {
          message = JSON.parse(body) as JsonRpcMessage;
        } catch {
          message = null;
        }
      }
      if (!message && !res.ok) message = { jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32000, message: `HTTP ${res.status}` } };
      return { message, sessionId };
    },
  };
}
