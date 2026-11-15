/**
 * Plan W11.I9 — the MCP ledger in the privacy panel. The vault's MCP server
 * and the `lumen` CLI append one JSON line per call to
 * `<vault>/.lumen/mcp/ledger.jsonl` (mcp-server/src/vault/ledger.ts): who
 * (client), which tool, which note, the decision and how many bytes of the
 * vault went to the client. It never holds note text. This reads it for
 * PrivacyLedgerPanel, so "everything is in the privacy ledger" covers what
 * outside agents took from the vault, not only the app's own requests.
 */
/** The same file as agents/mcpInbox.ts MCP_LEDGER (a test holds them equal); not imported, so the panel chunk stays small. */
export const MCP_LEDGER_PATH = ".lumen/mcp/ledger.jsonl";

export type McpLedgerDecision = "allowed" | "denied" | "proposed" | "approved" | "rejected" | "conflict" | "written";
export const MCP_DECISIONS: readonly McpLedgerDecision[] = ["allowed", "denied", "proposed", "approved", "rejected", "conflict", "written"];

export interface McpLedgerRow {
  ts: string;
  client: string;
  tool: string;
  scope?: string;
  path?: string;
  decision: McpLedgerDecision;
  bytesOut: number;
  id?: string;
  reason?: string;
}

/** The ledger's lines, oldest first; malformed or unknown lines are skipped (a torn last line, a newer format). */
export function parseMcpLedger(text: string, limit = 1000): McpLedgerRow[] {
  const out: McpLedgerRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Partial<McpLedgerRow>;
      if (!e || typeof e.tool !== "string" || typeof e.client !== "string" || typeof e.ts !== "string" || !MCP_DECISIONS.includes(e.decision as McpLedgerDecision)) continue;
      out.push({ ...e, bytesOut: typeof e.bytesOut === "number" && e.bytesOut >= 0 ? e.bytesOut : 0 } as McpLedgerRow);
    } catch {
      /* why: a line that is not JSON (torn write) is skipped */
    }
  }
  return out.slice(-limit);
}

/** The clients in the ledger, sorted, for the filter. */
export const mcpClients = (rows: readonly McpLedgerRow[]): string[] => [...new Set(rows.map((r) => r.client))].sort();

/** Bytes of vault content each client received. */
export function mcpBytesByClient(rows: readonly McpLedgerRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.client] = (out[r.client] ?? 0) + r.bytesOut;
  return out;
}

/** The ledger text from the open vault, or null when it has none. */
export async function readVaultMcpLedger(): Promise<string | null> {
  const ws = await import("../storage/workspace");
  return (await ws.workspaceHasFile(MCP_LEDGER_PATH)) ? ws.readWorkspaceFile(MCP_LEDGER_PATH) : null;
}
