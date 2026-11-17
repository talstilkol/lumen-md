/**
 * W13.A2: MCP extensions in the client against a mock server — Tasks
 * (tasks/get, tasks/update, tasks/cancel, subscriptions/listen; SEP-2663)
 * shown in the batch jobs list while they run, and lists kept for their
 * ttlMs, per vault unless the server's cacheScope says shared (SEP-2549).
 */
import { describe, expect, it, vi } from "vitest";
import { McpClient, TASKS_EXTENSION, type JsonRpcMessage, type McpTransport } from "../agents/mcp/client";
import { ListCache, MAX_TTL_MS } from "../agents/mcp/listCache";
import { serverTasks, pollDelay, type TaskState } from "../agents/mcp/serverTasks";

type Handler = (m: JsonRpcMessage) => Record<string, unknown> | { error: { code: number; message: string } };

/** A modern (2026-07-28) server: `handle` answers each request; every request is logged. */
function server(handle: Handler, extra: Partial<McpTransport> = {}) {
  const log: JsonRpcMessage[] = [];
  const transport: McpTransport = {
    reach: "local",
    async send(m) {
      log.push(m);
      if (m.id === undefined) return { message: null };
      if (m.method === "server/discover") return { message: { jsonrpc: "2.0", id: m.id, result: { supportedVersions: ["2026-07-28"], capabilities: { extensions: { [TASKS_EXTENSION]: {} } } } } };
      const r = handle(m);
      return { message: "error" in r && !("taskId" in r) ? { jsonrpc: "2.0", id: m.id, error: r.error as { code: number; message: string } } : { jsonrpc: "2.0", id: m.id, result: r } };
    },
    ...extra,
  };
  return { transport, log, calls: (method: string) => log.filter((m) => m.method === method) };
}

const task = (status: string, more: Record<string, unknown> = {}) => ({ resultType: "complete", taskId: "t-1", status, createdAt: new Date(0).toISOString(), pollIntervalMs: 5000, ...more });

/** A fake clock: `sleep` advances it, so a 5 s poll takes no time. */
function clock() {
  let t = 0;
  const slept: number[] = [];
  return { now: () => t, sleep: async (ms: number) => void (slept.push(ms), (t += ms)), slept };
}

describe("tasks", () => {
  it("declares the extension only when asked, and refuses a task it did not ask for", async () => {
    const s = server((m) => (m.method === "tools/call" ? { resultType: "task", taskId: "t-1", status: "working" } : {}));
    await expect(new McpClient(s.transport).callTool("transcribe", {})).rejects.toThrow(/did not ask for/);
    expect(JSON.stringify(s.calls("tools/call")[0].params)).not.toContain(TASKS_EXTENSION);
    const c = new McpClient(s.transport, { tasks: true, ...clock() });
    expect(c.capabilities()).toEqual({ extensions: { [TASKS_EXTENSION]: {} } });
  });

  it("a task that finishes after 3 polls is shown while it runs, then closed, with its result", async () => {
    let polls = 0;
    const seen: Array<ReturnType<typeof serverTasks.list>> = [];
    const off = serverTasks.subscribe(() => seen.push(serverTasks.list()));
    const s = server((m) => {
      if (m.method === "tools/call") return { resultType: "task", taskId: "t-1", status: "working", statusMessage: "Transcribing…", createdAt: new Date(0).toISOString(), ttlMs: 3_600_000, pollIntervalMs: 5000 };
      if (m.method === "tasks/get") return ++polls < 3 ? task("working", { statusMessage: `chunk ${polls}` }) : task("completed", { result: { content: [{ type: "text", text: "the transcript" }], isError: false } });
      return {};
    });
    const ck = clock();
    const statuses: string[] = [];
    const r = await new McpClient(s.transport, { tasks: true, serverLabel: "Whisper", ...ck }).callTool("transcribe", { file: "a.mp3" }, { onTask: (t) => statuses.push(t.status) });
    off();
    expect(r).toEqual({ kind: "complete", text: "the transcript", isError: false });
    expect(s.calls("tasks/get")).toHaveLength(3);
    expect(s.calls("tasks/get").every((m) => m.params?.taskId === "t-1")).toBe(true);
    expect(ck.slept).toEqual([5000, 5000, 5000]); // the server's pollIntervalMs
    expect(statuses).toEqual(["working", "working", "working", "completed"]);
    // Shown in the batch list while running (server, tool, its message), gone when done.
    expect(seen.some((l) => l.length === 1 && l[0].server === "Whisper" && l[0].tool === "transcribe" && l[0].statusMessage === "chunk 1")).toBe(true);
    expect(serverTasks.list()).toEqual([]);
  });

  it("Cancel in the list sends tasks/cancel and stops waiting", async () => {
    const s = server((m) => (m.method === "tools/call" ? { resultType: "task", taskId: "t-1", status: "working" } : m.method === "tasks/get" ? task("working") : {}));
    const ck = clock();
    const c = new McpClient(s.transport, {
      tasks: true,
      now: ck.now,
      sleep: async (ms) => {
        ck.sleep(ms);
        serverTasks.list()[0]?.cancel(); // the user presses Cancel while it waits
      },
    });
    await expect(c.callTool("import", {})).rejects.toThrow(/cancelled/);
    expect(s.calls("tasks/cancel")).toEqual([expect.objectContaining({ params: { taskId: "t-1", _meta: expect.anything() } })]);
    expect(serverTasks.list()).toEqual([]);
    // An AbortSignal from the caller does the same.
    const ac = new AbortController();
    const c2 = new McpClient(s.transport, { tasks: true, now: ck.now, sleep: async () => ac.abort() });
    await expect(c2.callTool("import", {}, { signal: ac.signal })).rejects.toThrow(/cancelled/);
    expect(s.calls("tasks/cancel")).toHaveLength(2);
  });

  it("input the task needs is asked once per key and sent with tasks/update", async () => {
    let n = 0;
    const ask = { method: "elicitation/create", params: { mode: "form", message: "Which language?", requestedSchema: { type: "object", properties: { lang: { type: "string" } } } } };
    const s = server((m) => {
      if (m.method === "tools/call") return { resultType: "task", taskId: "t-1", status: "working" };
      if (m.method === "tasks/get") return ++n <= 2 ? task("input_required", { inputRequests: { lang: ask } }) : task("completed", { result: { content: [{ type: "text", text: "done" }] } });
      return { resultType: "complete" };
    });
    const elicit = vi.fn(async () => ({ action: "accept" as const, content: { lang: "he" } }));
    const r = await new McpClient(s.transport, { tasks: true, elicit, ...clock() }).callTool("transcribe", {});
    expect(r).toMatchObject({ kind: "complete", text: "done" });
    expect(elicit).toHaveBeenCalledTimes(1); // the same key on the next poll is not asked again
    expect(s.calls("tasks/update")[0].params).toMatchObject({ taskId: "t-1", inputResponses: { lang: { action: "accept", content: { lang: "he" } } } });
  });

  it("failed, cancelled by the server, and past its TTL", async () => {
    const make = (get: () => Record<string, unknown>) => new McpClient(server((m) => (m.method === "tools/call" ? { resultType: "task", taskId: "t-1", status: "working", createdAt: new Date(0).toISOString(), ttlMs: 10_000, pollIntervalMs: 4000 } : get())).transport, { tasks: true, ...clock() });
    expect(await make(() => task("failed", { error: { message: "disk full" } })).callTool("x", {})).toEqual({ kind: "complete", isError: true, text: "The server's task failed: disk full" });
    expect(await make(() => task("cancelled")).callTool("x", {})).toMatchObject({ isError: true, text: /cancelled/ });
    await expect(make(() => task("working", { ttlMs: 10_000, pollIntervalMs: 4000 })).callTool("x", {})).rejects.toThrow(/time to live/);
    expect(pollDelay({ taskId: "x", status: "working", pollIntervalMs: 1 } as TaskState)).toBe(250);
    expect(pollDelay({ taskId: "x", status: "working", pollIntervalMs: 10 * 60_000 } as TaskState)).toBe(60_000);
  });

  it("a streaming transport: subscriptions/listen for the task; a pushed completion ends it without another poll", async () => {
    let listenMsg: JsonRpcMessage | null = null;
    const s = server((m) => (m.method === "tools/call" ? { resultType: "task", taskId: "t-1", status: "working" } : m.method === "tasks/get" ? task("working") : {}), {
      async listen(msg, _meta, onMessage, signal) {
        listenMsg = msg;
        setTimeout(() => onMessage({ jsonrpc: "2.0", method: "notifications/tasks", params: task("completed", { result: { content: [{ type: "text", text: "pushed" }] } }) }), 5);
        await new Promise<void>((r) => signal.addEventListener("abort", () => r()));
      },
    });
    const c = new McpClient(s.transport, { tasks: true, sleep: (_ms, signal) => new Promise((r) => signal?.addEventListener("abort", () => r(), { once: true })) });
    expect(await c.callTool("x", {})).toMatchObject({ text: "pushed" });
    expect(listenMsg!.method).toBe("subscriptions/listen");
    expect(listenMsg!.params).toMatchObject({ notifications: { taskIds: ["t-1"] } });
    expect(s.calls("tasks/get")).toHaveLength(0);
  });
});

describe("list caching", () => {
  const tools = (scope?: string, ttl: number | null = 60_000) =>
    server((m) => (m.method === "tools/list" ? { tools: [{ name: "lookup" }], ...(ttl !== null ? { ttlMs: ttl } : {}), ...(scope ? { cacheScope: scope } : {}) } : m.method === "resources/list" ? { resources: [{ uri: "file:///a", name: "a" }], ttlMs: 1000 } : {}));

  it("a list is not asked for again before its ttlMs, and is after", async () => {
    let t = 0;
    const cache = new ListCache(() => t);
    const s = tools();
    const c = new McpClient(s.transport, { listCache: { cache, server: "srv", vault: "v1" } });
    await c.listTools();
    t = 59_999;
    await c.listTools();
    expect(s.calls("tools/list")).toHaveLength(1);
    t = 60_001;
    await c.listTools();
    expect(s.calls("tools/list")).toHaveLength(2);
    await c.listResources();
    await c.listResources();
    expect(s.calls("resources/list")).toHaveLength(1);
  });

  it("cacheScope user (or none) is never shared between vaults; global is", async () => {
    const cache = new ListCache(() => 0);
    for (const scope of ["user", undefined]) {
      const s = tools(scope);
      await new McpClient(s.transport, { listCache: { cache, server: `srv-${scope}`, vault: "v1" } }).listTools();
      await new McpClient(s.transport, { listCache: { cache, server: `srv-${scope}`, vault: "v2" } }).listTools();
      expect(s.calls("tools/list"), String(scope)).toHaveLength(2);
    }
    const g = tools("global");
    await new McpClient(g.transport, { listCache: { cache, server: "srv-g", vault: "v1" } }).listTools();
    await new McpClient(g.transport, { listCache: { cache, server: "srv-g", vault: "v2" } }).listTools();
    expect(g.calls("tools/list")).toHaveLength(1);
  });

  it("no ttlMs: nothing cached; a huge one is capped at a day; list_changed drops it", async () => {
    let t = 0;
    const cache = new ListCache(() => t);
    const none = tools(undefined, null);
    const c0 = new McpClient(none.transport, { listCache: { cache, server: "a", vault: "v" } });
    await c0.listTools();
    await c0.listTools();
    expect(none.calls("tools/list")).toHaveLength(2);
    const big = tools(undefined, 365 * MAX_TTL_MS);
    const c1 = new McpClient(big.transport, { listCache: { cache, server: "b", vault: "v" } });
    await c1.listTools();
    t = MAX_TTL_MS + 1;
    await c1.listTools();
    expect(big.calls("tools/list")).toHaveLength(2);
    c1.onNotification({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    await c1.listTools();
    expect(big.calls("tools/list")).toHaveLength(3);
  });
});
