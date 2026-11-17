/**
 * Plan W11.I23 — Lumen as an ACP client: it hosts an external agent
 * (Claude Code, Codex, OpenCode; agents.ts) and every write the agent makes
 * goes through the same approval queue as Lumen's own agents (staging.ts →
 * AgentReviewPanel, plan 5.11).
 *
 * Agent Client Protocol, version 1: JSON-RPC 2.0, one message per line on
 * the agent's stdin and stdout. Lumen calls `initialize`, `session/new`,
 * `session/prompt` and `session/cancel`; the agent calls back:
 *
 *   fs/read_text_file    a vault file, by path inside the vault only
 *   fs/write_text_file   **staged**, never written: the answer waits until the
 *                        user approves (result null) or rejects (an error)
 *   session/request_permission
 *                        the agent's own tools: read / search / think may be
 *                        asked of the user (once at most, never "always");
 *                        edit, delete, move, execute, fetch and anything else
 *                        are rejected — a change reaches the vault only as a
 *                        staged fs/write_text_file
 *   terminal/*           not offered (clientCapabilities.terminal = false)
 *
 * The agent sends what it reads to its cloud model, so a session needs the
 * user's consent (`consentCloud`), airplane mode refuses it, and the privacy
 * ledger records the session and every prompt (`acp://<agent>`).
 *
 * What this cannot do: the agent is a local program with the user's OS
 * permissions. An agent that ignores ACP and writes files itself is not
 * stopped here; that needs an OS sandbox around the process (the Tauri
 * side, W11.M6).
 */

import { airplaneModeOn, AirplaneBlockedError } from "../../privacy/airplane";
import { recordProcessCall } from "../../ai/privacyLedger";
import { discardRunChanges, listStagedChanges, onStagedChanges, stageChange } from "../staging";
import type { StagedChange } from "../types";
import { lumenMcpServer, type AcpAgentSpec } from "./agents";

export const ACP_PROTOCOL_VERSION = 1;

export interface AcpProcessEvent {
  kind: "out" | "err" | "exit";
  line: string;
}
export interface AcpProcessHandle {
  write(line: string): Promise<void>;
  close(): Promise<void>;
}
/** Starts the agent process (the desktop's Tauri side; a fake in tests). Same shape as the MCP stdio bridge. */
export interface AcpProcessBridge {
  spawn(agent: { id: string; label: string }, spec: { command: string; args: string[]; cwd?: string }, onEvent: (e: AcpProcessEvent) => void): Promise<AcpProcessHandle>;
}

/** ACP's tool-call kinds. */
export type AcpToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";
export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}
export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: { toolCallId?: string; title?: string; kind?: AcpToolKind; [k: string]: unknown };
  options: AcpPermissionOption[];
}
/** Tool kinds whose permission the user may be asked for. Every other kind is rejected without asking. */
export const ASKABLE_KINDS: readonly AcpToolKind[] = ["read", "search", "think"];

export interface AcpHostOptions {
  agent: AcpAgentSpec;
  /** The vault folder: the agent's cwd, and the only place it may read. */
  vaultRoot: string;
  bridge: AcpProcessBridge;
  /** A vault file by vault-relative path, or null when it does not exist. */
  read(path: string): Promise<string | null>;
  /** The user agreed that what the agent reads may go to its cloud model. Required for a remote agent. */
  consentCloud?: boolean;
  /** Offer Lumen's MCP server to the agent (default true). */
  offerMcp?: boolean;
  /** Asked for a read / search / think tool of the agent; answers allow (once) or not. Default: no. */
  askPermission?(req: AcpPermissionRequest): Promise<boolean>;
  onUpdate?(update: Record<string, unknown>): void;
  onLog?(line: string): void;
  /** How long Lumen waits for an answer to its own requests (not for the user's review). */
  timeoutMs?: number;
}

export class AcpError extends Error {
  constructor(
    message: string,
    readonly code = -32000,
  ) {
    super(message);
    this.name = "AcpError";
  }
}

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface AcpSession {
  readonly sessionId: string;
  readonly runId: string;
  prompt(text: string): Promise<string>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

/** A path the agent names → vault-relative, or null when it is outside the vault. */
export function vaultRelative(vaultRoot: string, path: string): string | null {
  const root = vaultRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  let p = path.replace(/\\/g, "/");
  if (p === root) return null;
  if (p.startsWith(`${root}/`)) p = p.slice(root.length + 1);
  else if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) return null;
  const segs = p.split("/").filter((s) => s && s !== ".");
  if (!segs.length || segs.some((s) => s === "..")) return null;
  return segs.join("/");
}

/** The decision on a staged change: resolves once it is not pending any more. */
function settled(id: string): Promise<StagedChange> {
  return new Promise((resolve) => {
    let off: (() => void) | null = null;
    let done = false;
    const check = (list: readonly StagedChange[]) => {
      const c = list.find((x) => x.id === id);
      if (!done && (!c || c.status !== "pending")) {
        done = true;
        off?.();
        resolve(c ?? ({ id, status: "rejected" } as StagedChange));
      }
    };
    off = onStagedChanges(check);
    check(listStagedChanges({ all: true }));
  });
}

/** Starts the agent, initializes ACP and opens a session in the vault. */
export async function startAcpSession(o: AcpHostOptions): Promise<AcpSession> {
  const { agent } = o;
  const target = `acp://${agent.id}`;
  if (airplaneModeOn()) throw new AirplaneBlockedError(target);
  if (agent.reach === "remote" && !o.consentCloud) {
    throw new AcpError(`${agent.label} sends what it reads to a cloud model: it needs your consent before it can open this vault`);
  }
  const timeoutMs = o.timeoutMs ?? 120_000;
  let nextId = 1;
  let closed = false;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> | null }>();
  let handle: AcpProcessHandle | null = null;
  let sessionId = "";
  const runId = () => `acp:${agent.id}:${sessionId}`;
  const log = (l: string) => o.onLog?.(l);

  const send = (m: RpcMessage) => {
    if (!handle || closed) throw new AcpError(`${agent.label} is not running`);
    return handle.write(JSON.stringify(m));
  };
  const request = (method: string, params: Record<string, unknown>, { wait = true } = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = wait ? setTimeout(() => (waiting.delete(id), reject(new AcpError(`${agent.label} did not answer ${method}`))), timeoutMs) : null;
      waiting.set(id, { resolve, reject, timer });
      send({ jsonrpc: "2.0", id, method, params }).catch((e) => (waiting.delete(id), timer && clearTimeout(timer), reject(e)));
    });
  const failAll = (e: Error) => {
    for (const [, w] of waiting) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(e);
    }
    waiting.clear();
  };

  const answer = (id: RpcMessage["id"], result: unknown) => send({ jsonrpc: "2.0", id, result: result ?? null });
  const refuse = (id: RpcMessage["id"], code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

  async function onRequest(m: RpcMessage): Promise<void> {
    const p = m.params ?? {};
    try {
      if (m.method === "fs/read_text_file") {
        const rel = vaultRelative(o.vaultRoot, String(p.path ?? ""));
        if (!rel) return void (await refuse(m.id, -32602, "only files inside the vault can be read"));
        const text = await o.read(rel);
        if (text === null) return void (await refuse(m.id, -32002, `no file ${rel}`));
        const lines = text.split("\n");
        const from = typeof p.line === "number" && p.line > 0 ? p.line - 1 : 0;
        const to = typeof p.limit === "number" && p.limit > 0 ? from + p.limit : lines.length;
        return void (await answer(m.id, { content: from || to < lines.length ? lines.slice(from, to).join("\n") : text }));
      }
      if (m.method === "fs/write_text_file") {
        const rel = vaultRelative(o.vaultRoot, String(p.path ?? ""));
        if (!rel || typeof p.content !== "string") return void (await refuse(m.id, -32602, "only files inside the vault can be written"));
        const before = await o.read(rel);
        let change: StagedChange;
        try {
          change = stageChange({ kind: "file", path: rel, before, after: p.content, summary: `${agent.label} (ACP) ${before === null ? "creates" : "changes"} ${rel}` }, { tool: "acp:fs/write_text_file", runId: runId(), agentId: `acp:${agent.id}` });
        } catch (e) {
          return void (await refuse(m.id, -32001, (e as Error).message));
        }
        log(`staged ${change.id} ${rel}`);
        const done = await settled(change.id);
        if (done.status === "applied") return void (await answer(m.id, null));
        return void (await refuse(m.id, -32001, done.status === "rejected" ? `the user rejected the change to ${rel}` : `the change to ${rel} was not applied (${done.status}${done.error ? `: ${done.error}` : ""})`));
      }
      if (m.method === "session/request_permission") {
        const req = p as unknown as AcpPermissionRequest;
        const kind = (req.toolCall?.kind ?? "other") as AcpToolKind;
        const opts = Array.isArray(req.options) ? req.options : [];
        const reject = opts.find((x) => x.kind === "reject_once") ?? opts.find((x) => x.kind === "reject_always");
        const allow = opts.find((x) => x.kind === "allow_once");
        const asked = ASKABLE_KINDS.includes(kind) && allow && o.askPermission ? await o.askPermission({ ...req, options: opts.filter((x) => x.kind !== "allow_always") }) : false;
        log(`permission ${kind} ${req.toolCall?.title ?? ""}: ${asked ? "allowed once" : "rejected"}`);
        const chosen = asked ? allow : reject;
        return void (await answer(m.id, { outcome: chosen ? { outcome: "selected", optionId: chosen.optionId } : { outcome: "cancelled" } }));
      }
      await refuse(m.id, -32601, `Lumen does not offer ${m.method}`);
    } catch (e) {
      await refuse(m.id, -32603, (e as Error)?.message ?? String(e)).catch(() => {
        // why: the agent process already went away, so there is no one to send the refusal to
      });
    }
  }

  const onEvent = (e: AcpProcessEvent) => {
    if (e.kind === "err") return log(`stderr: ${e.line}`);
    if (e.kind === "exit") {
      closed = true;
      failAll(new AcpError(`${agent.label} stopped${e.line ? ` (exit ${e.line})` : ""}`));
      return;
    }
    let m: RpcMessage;
    try {
      m = JSON.parse(e.line);
    } catch {
      return log(`not JSON: ${e.line.slice(0, 200)}`);
    }
    if (m.method && m.id !== undefined && m.id !== null) void onRequest(m);
    else if (m.method === "session/update") o.onUpdate?.((m.params?.update ?? {}) as Record<string, unknown>);
    else if (m.method) log(`notification ${m.method}`);
    else if (typeof m.id === "number" && waiting.has(m.id)) {
      const w = waiting.get(m.id)!;
      waiting.delete(m.id);
      if (w.timer) clearTimeout(w.timer);
      if (m.error) w.reject(new AcpError(m.error.message, m.error.code));
      else w.resolve(m.result);
    }
  };

  handle = await o.bridge.spawn({ id: agent.id, label: agent.label }, { command: agent.command, args: agent.args, cwd: o.vaultRoot }, onEvent);
  recordProcessCall(target, `${agent.label} (ACP agent) started on this vault`, 0, !!o.consentCloud);
  const init = (await request("initialize", { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false }, clientInfo: { name: "lumen-md", title: "Lumen" } })) as { protocolVersion?: number };
  if (init?.protocolVersion !== ACP_PROTOCOL_VERSION) {
    await handle.close();
    throw new AcpError(`${agent.label} speaks ACP ${init?.protocolVersion ?? "?"}, Lumen speaks ${ACP_PROTOCOL_VERSION}`);
  }
  const mcpServers = o.offerMcp === false ? [] : [lumenMcpServer(o.vaultRoot, agent.id)];
  sessionId = String(((await request("session/new", { cwd: o.vaultRoot, mcpServers })) as { sessionId?: string })?.sessionId ?? "");
  if (!sessionId) throw new AcpError(`${agent.label} opened no session`);

  return {
    sessionId,
    runId: runId(),
    async prompt(text) {
      recordProcessCall(target, `Prompt to ${agent.label} (ACP agent)`, new TextEncoder().encode(text).length, !!o.consentCloud);
      // A turn takes as long as the agent needs (and the user's reviews inside it): no timeout.
      const r = (await request("session/prompt", { sessionId, prompt: [{ type: "text", text }] }, { wait: false })) as { stopReason?: string };
      return r?.stopReason ?? "end_turn";
    },
    async cancel() {
      await send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
      discardRunChanges(runId());
    },
    async close() {
      if (closed) return;
      discardRunChanges(runId());
      closed = true;
      failAll(new AcpError(`${agent.label} session closed`));
      await handle?.close();
    },
  };
}
