/**
 * R8-L11: turning local-only on closes the running stdio servers that may
 * reach the network (as airplane mode does); and the call-approval dialog
 * shows the whole payload, scrollable, not the first 4,000 characters.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { setAiPolicy } from "../ai/policy";
import { closeStdioServers, mcpAgentTools } from "../agents/mcp/registry";
import { serverLog } from "../agents/mcp/log";
import type { StdioBridge } from "../agents/mcp/transports/stdio";
import type { McpServerConfig } from "../agents/mcp/servers";
import { ToolCallDialog } from "../ui/McpDialogs";

/** A stand-in server program: answers every request (discover, initialize, tools/list) with an empty tool list. */
function fakeBridge(): StdioBridge & { closed: number; started: number } {
  const b = {
    closed: 0,
    started: 0,
    async spawn(_server: unknown, _spec: unknown, onEvent: (e: { kind: "out" | "err" | "exit"; line: string }) => void) {
      b.started++;
      return {
        async write(line: string) {
          const m = JSON.parse(line) as { id?: number };
          if (m.id === undefined) return;
          const result = { protocolVersion: "2026-07-28", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" }, tools: [], resultType: "complete" };
          queueMicrotask(() => onEvent({ kind: "out", line: JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) }));
        },
        async close() {
          b.closed++;
        },
      };
    },
  };
  return b as never;
}

const server = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({ id: "net", label: "Net", transport: "stdio", command: "mcp-net", args: [], enabled: true, defaultPermission: "ask", tools: {}, ...over });

describe("local-only closes remote stdio servers (R8-L11)", () => {
  it("a running non-offline server is closed when the policy turns local-only; an offline one keeps running", async () => {
    localStorage.clear();
    setAiPolicy("local-first");
    const bridge = fakeBridge();
    const reach = () => ({ airplane: false, localOnly: false, desktop: true });
    await mcpAgentTools({ servers: [server(), server({ id: "off", label: "Offline", command: "mcp-off", offline: true })], bridge, reach, confirmCall: () => false, elicit: async () => ({ action: "decline" }) } as never);
    expect(bridge.started).toBe(2);
    setAiPolicy("local-only");
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.closed).toBe(1);
    expect(serverLog("net").map((l) => l.text)).toContain("closed: local-only came on");
    // Another policy change does nothing more.
    setAiPolicy("cloud");
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.closed).toBe(1);
    await closeStdioServers("all");
    expect(bridge.closed).toBe(2);
  });
});

describe("ToolCallDialog shows the whole payload (R8-L11)", () => {
  it("a 20,000-character argument is shown in full, in a scrollable region", () => {
    const content = "a".repeat(20_000) + "THE-END";
    render(<ToolCallDialog server={server()} tool="write" args={{ content }} info={{ status: "ask", hash: "h", tool: { name: "write" } }} onResolve={() => {}} />);
    const box = screen.getByTestId("mcp-call-args");
    expect(box.textContent).toContain("THE-END");
    expect(box.getAttribute("tabindex")).toBe("0");
    expect(box.style.overflow).toBe("auto");
  });
});
