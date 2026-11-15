/**
 * Plan W11.I9 — the MCP ledger in the privacy panel: 10 real MCP calls
 * through the vault's server (mcp-server, McpEndpoint) write
 * .lumen/mcp/ledger.jsonl, and all 10 show in PrivacyLedgerPanel's MCP tab,
 * filtered by client.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { PrivacyLedgerPanel } from "../ui/PrivacyLedgerPanel";
import { MCP_LEDGER_PATH, mcpBytesByClient, mcpClients, parseMcpLedger } from "../privacy/mcpLedger";
import { MCP_LEDGER } from "../agents/mcpInbox";
import { __resetLedger } from "../ai/privacyLedger";
import { McpEndpoint, META } from "../../mcp-server/src/protocol";
import { enableClient } from "../../mcp-server/src/vault/config";

let vault: string;
let seq = 0;
const call = (client: string, name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id: ++seq,
  method: "tools/call",
  params: { name, arguments: args, _meta: { [META.protocolVersion]: "2026-07-28", [META.clientInfo]: { name: client, version: "1" }, [META.clientCapabilities]: {} } },
});
const ledgerText = () => (existsSync(path.join(vault, MCP_LEDGER_PATH)) ? readFileSync(path.join(vault, MCP_LEDGER_PATH), "utf8") : null);

beforeEach(async () => {
  localStorage.clear();
  __resetLedger();
  vault = mkdtempSync(path.join(tmpdir(), "lumen-i9-"));
  mkdirSync(path.join(vault, "ideas"), { recursive: true });
  writeFileSync(path.join(vault, "ideas/launch.md"), "# Launch\n\nThe launch plan and budget.\n");
  await enableClient(vault, "claude-code", ["search", "read"]);
  await enableClient(vault, "cursor", ["search"]);
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe("the MCP ledger in the privacy panel", () => {
  it("10 MCP calls in, 10 rows out, with a filter per client", async () => {
    const ep = new McpEndpoint({ vault });
    const calls = [
      call("claude-code", "search_notes", { query: "launch" }),
      call("claude-code", "read_note", { path: "ideas/launch.md" }),
      call("claude-code", "list_notes", {}),
      call("claude-code", "list_tags", {}),
      call("claude-code", "read_note", { path: "ideas/launch.md" }),
      call("claude-code", "search_notes", { query: "budget" }),
      call("cursor", "search_notes", { query: "plan" }),
      call("cursor", "read_note", { path: "ideas/launch.md" }), // cursor has no read scope: refused, and logged
      call("cursor", "search_notes", { query: "launch" }),
      call("claude-code", "get_backlinks", { path: "ideas/launch.md" }),
    ];
    for (const c of calls) await ep.handle(c);
    const rows = parseMcpLedger(ledgerText() ?? "");
    expect(rows).toHaveLength(10);

    render(<PrivacyLedgerPanel open onClose={() => {}} mcpLedger={async () => ledgerText()} />);
    fireEvent.click(screen.getByTestId("privacy-tab-mcp"));
    await waitFor(() => expect(screen.getAllByTestId("privacy-mcp-row")).toHaveLength(10));
    expect(screen.getByTestId("privacy-tab-mcp").textContent).toContain("(10)");
    const byClient = (c: string) => screen.getAllByTestId("privacy-mcp-row").filter((r) => r.getAttribute("data-client") === c).length;
    expect([byClient("claude-code"), byClient("cursor")]).toEqual([7, 3]);
    expect(screen.getAllByTestId("privacy-mcp-row").some((r) => r.getAttribute("data-decision") === "denied")).toBe(true);

    fireEvent.change(screen.getByTestId("privacy-mcp-client"), { target: { value: "cursor" } });
    expect(screen.getAllByTestId("privacy-mcp-row")).toHaveLength(3);
    expect(screen.getAllByTestId("privacy-mcp-row").every((r) => r.getAttribute("data-client") === "cursor")).toBe(true);
    // No note text in the panel: the ledger holds none.
    expect(document.body.textContent).not.toContain("The launch plan and budget");
  });

  it("a vault without MCP use shows the empty state; the requests tab is unchanged", async () => {
    render(<PrivacyLedgerPanel open onClose={() => {}} mcpLedger={async () => null} />);
    expect(screen.getByTestId("privacy-summary")).toBeTruthy();
    fireEvent.click(screen.getByTestId("privacy-tab-mcp"));
    await waitFor(() => expect(document.body.textContent).toContain("No MCP client has used this vault yet."));
  });

  it("reads the same file as the MCP inbox, skips torn lines, and sums bytes per client", () => {
    expect(MCP_LEDGER_PATH).toBe(MCP_LEDGER);
    const text = [
      JSON.stringify({ ts: "2026-11-15T10:00:00Z", client: "a", tool: "read_note", decision: "allowed", bytesOut: 40 }),
      "{torn",
      JSON.stringify({ ts: "2026-11-15T10:01:00Z", client: "b", tool: "x", decision: "unknown-kind", bytesOut: 1 }),
      JSON.stringify({ ts: "2026-11-15T10:02:00Z", client: "a", tool: "search_notes", decision: "allowed", bytesOut: 2 }),
    ].join("\n");
    const rows = parseMcpLedger(text);
    expect(rows).toHaveLength(2);
    expect(mcpClients(rows)).toEqual(["a"]);
    expect(mcpBytesByClient(rows)).toEqual({ a: 42 });
  });
});
