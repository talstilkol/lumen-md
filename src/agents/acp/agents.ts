/**
 * Plan W11.I23 — the external agents Lumen can host over the Agent Client
 * Protocol (ACP, https://agentclientprotocol.com) on the desktop, as
 * Obsidian Copilot 4 does (research R4.18).
 *
 * Each runs as a local process Lumen starts (stdio, newline-delimited
 * JSON-RPC). All three send what they read to a cloud model by default, so
 * they are `reach: "remote"`: a session needs the user's consent, airplane
 * mode refuses it, and the privacy ledger records it (host.ts).
 *
 * The launch commands are the adapters' published ones as of 2026-11; the
 * real runs are W11.M6, which checks each one on the Mac.
 */

export interface AcpAgentSpec {
  id: "claude-code" | "codex" | "opencode";
  label: string;
  command: string;
  args: string[];
  /** Where the agent's model runs by default. */
  reach: "local" | "remote";
  /** Where its ACP adapter is documented. */
  docs: string;
}

export const ACP_AGENTS: readonly AcpAgentSpec[] = Object.freeze([
  { id: "claude-code", label: "Claude Code", command: "npx", args: ["-y", "@zed-industries/claude-code-acp"], reach: "remote", docs: "https://github.com/zed-industries/claude-code-acp" },
  { id: "codex", label: "Codex", command: "npx", args: ["-y", "@zed-industries/codex-acp"], reach: "remote", docs: "https://github.com/zed-industries/codex-acp" },
  { id: "opencode", label: "OpenCode", command: "opencode", args: ["acp"], reach: "remote", docs: "https://opencode.ai/docs/acp/" },
]);

export const acpAgent = (id: string): AcpAgentSpec | undefined => ACP_AGENTS.find((a) => a.id === id);

/**
 * Lumen's own MCP server (W7.17, `lumen mcp serve`), offered to the agent in
 * `session/new` so it reaches the vault through the same scoped tools as
 * any MCP client. Its writes wait in that server's approval queue.
 */
export function lumenMcpServer(vaultRoot: string, agentId: string): { name: string; command: string; args: string[]; env: { name: string; value: string }[] } {
  return { name: "lumen", command: "lumen", args: ["mcp", "serve", "--client", `acp-${agentId}`, "--vault", vaultRoot], env: [] };
}
