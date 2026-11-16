/**
 * The stdio transport for the MCP client (plan W7.18, W10.C1), per the
 * 2026-07-28 stdio binding: Lumen launches the server, writes one JSON-RPC
 * message per line to its stdin and reads one per line from its stdout.
 * stderr is the server's log: every line goes to the server log (log.ts),
 * shown in Settings → MCP servers. Desktop only: the process is started by
 * the Tauri side (src-tauri/src/mcp_stdio.rs), which runs only a command the
 * user approved in a native dialog.
 *
 *   • Responses are matched to requests by id; notifications and lines that
 *     are not JSON are logged, not answered.
 *   • A request that takes longer than `timeoutMs` fails, and the server is
 *     told with `notifications/cancelled` (stdio's cancellation).
 *   • When the process ends, every waiting request fails and the transport
 *     is closed: the next call starts a new one (registry.ts).
 *   • `close()` closes stdin, waits, then kills (the Rust side).
 *   • A write that fails or times out (the server stopped reading its stdin)
 *     closes the transport the same way, fails every waiting request and
 *     tells the pool (`onStuck`), so the next call starts a new process
 *     instead of writing to a stuck one again (R8b-L6).
 */
import { McpClientError, type JsonRpcMessage, type McpTransport } from "../client";

export interface StdioSpec {
  command: string;
  args: string[];
  cwd?: string;
}

export interface StdioEvent {
  kind: "out" | "err" | "exit";
  line: string;
}

export interface StdioHandle {
  write(line: string): Promise<void>;
  close(): Promise<void>;
}

/** Starts a server process. Rejects when the command is not approved (the Rust side decides). */
export interface StdioBridge {
  spawn(server: { id: string; label: string }, spec: StdioSpec, onEvent: (e: StdioEvent) => void): Promise<StdioHandle>;
}

export interface StdioOptions {
  reach: "local" | "remote";
  /** How long one request may wait for its answer. */
  timeoutMs?: number;
  onStderr?: (line: string) => void;
  onExit?: (code: number | null) => void;
  /** A write failed or timed out: the transport closed itself (R8b-L6). */
  onStuck?: (why: string) => void;
}

export interface StdioTransport extends McpTransport {
  close(): Promise<void>;
  readonly state: "idle" | "starting" | "running" | "closed";
}

export const DEFAULT_TIMEOUT_MS = 60_000;

export function stdioTransport(server: { id: string; label: string }, spec: StdioSpec, bridge: StdioBridge, o: StdioOptions): StdioTransport {
  let state: StdioTransport["state"] = "idle";
  let handle: StdioHandle | null = null;
  let starting: Promise<StdioHandle> | null = null;
  const waiting = new Map<string, { resolve: (m: JsonRpcMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const failAll = (e: Error) => {
    for (const [, w] of waiting) {
      clearTimeout(w.timer);
      w.reject(e);
    }
    waiting.clear();
  };

  /** The server stopped reading: close it, fail what waits, and let the pool drop it (R8b-L6). */
  const abandon = (why: string) => {
    if (state === "closed") return;
    const h = handle;
    state = "closed";
    handle = null;
    failAll(new McpClientError(`the MCP server "${server.label}" stopped reading its input and was closed`));
    o.onStuck?.(why);
    void h?.close().catch(() => {
      /* why: closing kills it; a process already gone has nothing to close */
    });
  };
  /** One line to the server; a failed or timed-out write abandons the server. */
  const write = async (h: StdioHandle, line: string) => {
    try {
      await h.write(line);
    } catch (e) {
      const why = (e as Error)?.message ?? String(e);
      abandon(why);
      throw new McpClientError(`the MCP server "${server.label}" stopped reading: ${why}`);
    }
  };

  const onEvent = (e: StdioEvent) => {
    if (e.kind === "err") {
      o.onStderr?.(e.line);
      return;
    }
    if (e.kind === "exit") {
      state = "closed";
      handle = null;
      const code = e.line === "" ? null : Number(e.line);
      o.onExit?.(Number.isFinite(code) ? code : null);
      failAll(new McpClientError(`the MCP server "${server.label}" stopped${code !== null && Number.isFinite(code) ? ` (exit ${code})` : ""}`));
      return;
    }
    let m: JsonRpcMessage;
    try {
      m = JSON.parse(e.line) as JsonRpcMessage;
    } catch {
      o.onStderr?.(`[not JSON on stdout] ${e.line.slice(0, 200)}`);
      return;
    }
    if (m && (m.result !== undefined || m.error !== undefined) && m.id !== undefined && m.id !== null) {
      const w = waiting.get(String(m.id));
      if (w) {
        waiting.delete(String(m.id));
        clearTimeout(w.timer);
        w.resolve(m);
      }
      return;
    }
    // A notification (progress, list changed) or a server request the 2026-07-28 protocol no longer allows: logged only.
    if (m && typeof m.method === "string") o.onStderr?.(`[${m.method.slice(0, 80)}]`);
  };

  const start = async (): Promise<StdioHandle> => {
    if (handle) return handle;
    if (state === "closed") throw new McpClientError(`the MCP server "${server.label}" is closed`);
    if (!starting) {
      state = "starting";
      starting = bridge.spawn(server, spec, onEvent).then(
        (h) => {
          handle = h;
          if (state === "starting") state = "running";
          return h;
        },
        (err) => {
          state = "closed";
          starting = null;
          throw err instanceof Error ? err : new McpClientError(String(err));
        },
      );
    }
    return starting;
  };

  return {
    reach: o.reach,
    binding: "stdio",
    get state() {
      return state;
    },
    async send(msg) {
      const h = await start();
      // JSON.stringify never emits a raw newline: one message, one line (spec).
      const line = JSON.stringify(msg);
      if (msg.id === undefined || msg.id === null) {
        await write(h, line);
        return { message: null };
      }
      const key = String(msg.id);
      const answer = new Promise<JsonRpcMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(key);
          // stdio cancellation: tell the server, then fail the call.
          void write(h, JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: msg.id, reason: "timeout" } })).catch(() => {
            /* why: the call fails below either way; a failed write has abandoned the server */
          });
          reject(new McpClientError(`${msg.method ?? "request"}: the MCP server "${server.label}" did not answer in ${Math.round((o.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s`));
        }, o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        waiting.set(key, { resolve, reject, timer });
      });
      try {
        await h.write(line);
      } catch (e) {
        const w = waiting.get(key);
        if (w) clearTimeout(w.timer);
        waiting.delete(key);
        const why = (e as Error)?.message ?? String(e);
        abandon(why);
        throw new McpClientError(`the MCP server "${server.label}" stopped reading: ${why}`);
      }
      return { message: await answer };
    },
    async close() {
      const h = handle ?? (starting ? await starting.catch(() => null) : null);
      state = "closed";
      handle = null;
      failAll(new McpClientError(`the MCP server "${server.label}" was closed`));
      await h?.close();
    },
  };
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = (event: string, fn: (e: { payload: { session: number; kind: StdioEvent["kind"]; line: string } }) => void) => Promise<() => void>;

/**
 * The desktop bridge: the Tauri commands of src-tauri/src/mcp_stdio.rs. The
 * native approval dialog comes first when the exact command is not approved
 * yet; a "no" there means nothing runs.
 */
export function tauriStdioBridge(deps?: { invoke: Invoke; listen: Listen }): StdioBridge {
  return {
    async spawn(server, spec, onEvent) {
      const invoke = deps?.invoke ?? ((await import("@tauri-apps/api/core")).invoke as Invoke);
      const listen = deps?.listen ?? ((await import("@tauri-apps/api/event")).listen as unknown as Listen);
      const args = { command: spec.command, args: spec.args, cwd: spec.cwd ?? null };
      if (!(await invoke<boolean>("mcp_stdio_approved", args))) {
        if (!(await invoke<boolean>("mcp_stdio_approve", { server: server.label, ...args }))) throw new McpClientError(`not approved: you did not allow "${spec.command}" to run`);
      }
      // Listen before the process starts, so no early line is lost; lines for a session not known yet wait.
      let session: number | null = null;
      const early: Array<{ session: number; kind: StdioEvent["kind"]; line: string }> = [];
      const unlisten = await listen("mcp-stdio", (e) => {
        if (session === null) early.push(e.payload);
        else if (e.payload.session === session) {
          onEvent({ kind: e.payload.kind, line: e.payload.line });
          if (e.payload.kind === "exit") unlisten();
        }
      });
      try {
        session = await invoke<number>("mcp_stdio_spawn", args);
      } catch (e) {
        unlisten();
        throw new McpClientError(String((e as Error)?.message ?? e));
      }
      for (const p of early.splice(0)) if (p.session === session) onEvent({ kind: p.kind, line: p.line });
      return {
        write: (line) => invoke<void>("mcp_stdio_write", { session, line }),
        async close() {
          try {
            await invoke("mcp_stdio_close", { session });
          } finally {
            unlisten();
          }
        },
      };
    },
  };
}
