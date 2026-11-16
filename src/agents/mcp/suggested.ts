/**
 * Suggested MCP servers (plan W7.18, W10.C3): shown in Settings → MCP
 * servers with their licence and what they can reach. Choosing one only
 * fills the add form: nothing connects, runs or downloads until the user
 * saves it, enables it and (for a program) approves its command.
 *
 * Lumen never installs a server: a program is one the user installed
 * (`npm i -g …`, `pip install …`), named without `npx -y`. No program is
 * marked offline here: only the user says a program makes no network
 * requests (servers.ts `offline`), so each counts as remote until then.
 */
import type { McpServerConfig } from "./servers";

export interface SuggestedServer extends Omit<McpServerConfig, "enabled" | "tools"> {
  /** SPDX id when we checked it, or "unverified" (shown as "check its licence"). */
  license: string;
  /** Where to get it (shown as text, not fetched). */
  source: string;
  /** What it can reach, as the user should read it before adding it. */
  reaches: "network" | "this computer" | "your files";
  /** How to install it, when it is a program. */
  install?: string;
}

export const SUGGESTED: readonly SuggestedServer[] = [
  {
    // It calls the Knesset's API: remote (blocked in airplane mode). Set `cwd` to your Knessy checkout.
    id: "knesset",
    label: "Knesset (Knessy — bills, votes, committee protocols)",
    transport: "stdio",
    command: "python3",
    args: ["-I", "-m", "mcp_server.server"],
    defaultPermission: "ask",
    license: "MIT",
    source: "the Knessy repository (its README)",
    reaches: "network",
    install: "git clone the Knessy repository, then set the folder to it",
  },
  { id: "data-gov-il", label: "data.gov.il (Israeli government open data)", transport: "http", url: "", defaultPermission: "ask", license: "unverified", source: "the server's own page", reaches: "network" },
  // W11.H17: built in (the four tools of Sivan22/mcp-sefaria-server, rewritten in TypeScript, mcp/sefariaTools.ts); remote: off in airplane mode.
  {
    id: "sefaria",
    label: "Sefaria (Jewish texts: get_text, get_commentaries, search_texts, get_daily_learnings; tools ported from Sivan22/mcp-sefaria-server, MIT)",
    transport: "http",
    url: "https://www.sefaria.org",
    builtin: true,
    defaultPermission: "ask",
    license: "MIT",
    source: "built into Lumen (tools ported from Sivan22/mcp-sefaria-server)",
    reaches: "network",
  },
  { id: "zotero", label: "Zotero (your library, on this computer)", transport: "http", url: "http://127.0.0.1:23119/mcp", defaultPermission: "ask", license: "unverified", source: "a Zotero MCP plugin", reaches: "this computer" },
  {
    id: "files",
    label: "Your files (the reference filesystem server)",
    transport: "stdio",
    command: "mcp-server-filesystem",
    args: [],
    defaultPermission: "ask",
    license: "MIT",
    source: "npm @modelcontextprotocol/server-filesystem",
    reaches: "your files",
    install: "npm i -g @modelcontextprotocol/server-filesystem, then add the folders it may use as arguments",
  },
  {
    id: "everything",
    label: "Everything (the MCP test server: echo, add, elicitation)",
    transport: "stdio",
    command: "mcp-server-everything",
    args: [],
    defaultPermission: "ask",
    license: "MIT",
    source: "npm @modelcontextprotocol/server-everything",
    reaches: "this computer",
    install: "npm i -g @modelcontextprotocol/server-everything",
  },
];

/** The add form's values for a suggestion (a copy: editing the form never changes the list). */
export function formFromSuggestion(s: SuggestedServer): Omit<McpServerConfig, "enabled" | "tools"> {
  const { license: _l, source: _s, reaches: _r, install: _i, ...cfg } = s;
  void _l;
  void _s;
  void _r;
  void _i;
  return { ...cfg, ...(cfg.args ? { args: [...cfg.args] } : {}) };
}
