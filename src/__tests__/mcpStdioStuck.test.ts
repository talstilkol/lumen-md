/**
 * R8b-L6: a stdio server that stops reading its stdin (a write that fails or
 * times out on the Rust side) is closed and leaves the pool, so the next call
 * starts a new process instead of writing to the stuck one again.
 */
import { afterEach, describe, expect, it } from "vitest";
import { stdioTransport, type StdioBridge, type StdioEvent } from "../agents/mcp/transports/stdio";
import { closeStdioServers, transportFor } from "../agents/mcp/registry";
import { clearServerLogs, serverLog } from "../agents/mcp/log";
import type { McpServerConfig } from "../agents/mcp/servers";

/** A bridge whose processes stop reading after `okWrites` lines: the next write rejects, as mcp_stdio_write does after WRITE_TIMEOUT. */
function stuckBridge(okWrites: number) {
  const b = {
    started: 0,
    closed: 0,
    written: [] as string[],
    events: [] as Array<(e: StdioEvent) => void>,
    async spawn(_server: unknown, _spec: unknown, onEvent: (e: StdioEvent) => void) {
      b.started++;
      b.events.push(onEvent);
      let n = 0;
      return {
        async write(line: string) {
          if (n++ >= okWrites) throw new Error("the server did not read the message within 10000 ms");
          b.written.push(line);
        },
        async close() {
          b.closed++;
        },
      };
    },
  };
  return b satisfies StdioBridge;
}

const req = (id: number) => ({ jsonrpc: "2.0" as const, id, method: "tools/list", params: {} });
const ctx = { protocolVersion: "2026-07-28" };
const tick = () => new Promise((r) => setTimeout(r, 10));

afterEach(async () => {
  await closeStdioServers("all");
  clearServerLogs();
});

describe("a stdio server that stops reading", () => {
  it("a failed write closes the transport, fails every waiting call and tells the pool", async () => {
    const bridge = stuckBridge(1);
    const stuck: string[] = [];
    const t = stdioTransport({ id: "s", label: "Stuck" }, { command: "srv", args: [] }, bridge, { reach: "local", timeoutMs: 5000, onStuck: (w) => stuck.push(w) });
    const first = t.send(req(1), ctx); // written; waits for an answer that never comes
    await tick();
    expect(t.state).toBe("running");
    await expect(t.send(req(2), ctx)).rejects.toThrow(/stopped reading: the server did not read the message/);
    await expect(first).rejects.toThrow(/stopped reading its input and was closed/);
    expect(t.state).toBe("closed");
    expect(stuck).toEqual(["the server did not read the message within 10000 ms"]);
    await tick();
    expect(bridge.closed).toBe(1);
    await expect(t.send(req(3), ctx)).rejects.toThrow(/is closed/);
    expect(bridge.started).toBe(1);
  });

  it("a notification whose write fails does the same", async () => {
    const bridge = stuckBridge(0);
    const t = stdioTransport({ id: "s", label: "Stuck" }, { command: "srv", args: [] }, bridge, { reach: "local" });
    await expect(t.send({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx)).rejects.toThrow(/stopped reading/);
    expect(t.state).toBe("closed");
    await tick();
    expect(bridge.closed).toBe(1);
  });

  it("the pool drops it: the next call gets a new process (before: the stuck one again)", async () => {
    const bridge = stuckBridge(0);
    const server: McpServerConfig = { id: "pool", label: "Pooled", transport: "stdio", command: "srv", args: [], enabled: true, defaultPermission: "ask", tools: {}, offline: true };
    const get = transportFor(server, { bridge });
    const a = get();
    await expect(a.send(req(1), ctx)).rejects.toThrow(/stopped reading/);
    const b = get();
    expect(b).not.toBe(a);
    await expect(b.send(req(2), ctx)).rejects.toThrow(/stopped reading/);
    expect(bridge.started).toBe(2);
    expect(serverLog("pool").some((l) => l.text.startsWith("closed: it stopped reading its input"))).toBe(true);
  });

  it("a server that only answers slowly is not abandoned: a timeout without a failed write keeps it", async () => {
    const bridge = stuckBridge(10);
    const t = stdioTransport({ id: "s", label: "Slow" }, { command: "srv", args: [] }, bridge, { reach: "local", timeoutMs: 50 });
    await expect(t.send(req(1), ctx)).rejects.toThrow(/did not answer/);
    await tick();
    expect(t.state).toBe("running");
    expect(bridge.written.map((l) => JSON.parse(l).method)).toEqual(["tools/list", "notifications/cancelled"]);
    await t.close();
  });
});
