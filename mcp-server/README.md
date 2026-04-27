# @lumen-md/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that
exposes a Lumen workspace to AI agents — Claude Desktop, Cursor, Cline, or
any MCP-aware client. Once configured, you can say "read my note about X"
and the agent finds, reads, or writes files in your workspace transparently.

## Install

```bash
npm install -g @lumen-md/mcp-server
# or, no install:
npx @lumen-md/mcp-server
```

## Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) — or the equivalent on Windows / Linux — and add:

```json
{
  "mcpServers": {
    "lumen": {
      "command": "npx",
      "args": ["-y", "@lumen-md/mcp-server"],
      "env": { "LUMEN_WORKSPACE": "/Users/you/Documents/Lumen" }
    }
  }
}
```

Restart Claude Desktop. A 🔌 icon in the chat input confirms the server is
attached.

## Tools exposed

| Tool                | Args                | What it does                                  |
| ------------------- | ------------------- | --------------------------------------------- |
| `read_note`         | `path`              | Return the markdown body of a single note.    |
| `write_note`        | `path`, `content`   | Create or overwrite a note (mkdir-p).         |
| `list_notes`        | —                   | Recursively list every `.md` / `.txt` path.   |
| `search_workspace`  | `query`, `limit?`   | Case-insensitive substring search.            |

## Security boundary

The server refuses any path containing `..` or that is absolute, so an agent
cannot escape `LUMEN_WORKSPACE` to read the rest of your filesystem. Run the
server only against directories you'd be comfortable showing the agent.

## Sync with the Lumen web app

The web app stores files in OPFS (Origin-Private File System), which the
Node MCP process can't reach. To bridge the gap, point your Lumen workspace
at a Git repo (`⌘K → Git: Clone …`) and clone that same repo to the path
you set in `LUMEN_WORKSPACE`. Lumen's commit/pull commands keep the two
sides in sync, and the MCP server reads from the local clone.

## Dev

```bash
npm install
npm run build
LUMEN_WORKSPACE=/tmp/test-vault npm start
```

Talk to it via stdio (the MCP `Inspector` tool from
`@modelcontextprotocol/inspector` is the easiest dev loop).
