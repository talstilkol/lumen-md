---
title: MCP and the lumen CLI
description: Let Claude Desktop, Claude Code or your IDE search and read your vault — off by default, with scopes per client, and every change waits for your approval.
---

Lumen's vault can be used from outside the app in two ways:

- the **MCP server** (`@lumen-md/mcp-server`) for AI clients that speak the
  [Model Context Protocol](https://modelcontextprotocol.io/) — Claude
  Desktop, Claude Code, Cursor, VS Code, Zed;
- the **`lumen` CLI** for you at a terminal: `lumen search`, `open`, `new`,
  `append`, `daily`.

Both work on the vault folder on disk. Three rules hold everywhere:

1. **Off by default.** A client gets no tools until you enable it.
2. **Scopes per client.** You choose what each client may do.
3. **No write without approval.** A client's write is only a proposal; the
   note changes when you approve it.

## Install

The server is not published to npm yet, so build it from the repository (Node 22+):

```bash
git clone https://github.com/talstilkol/lumen-md
cd lumen-md/mcp-server
npm ci
npm run build          # → mcp-server/dist/index.js and dist/lumen.js
```

Until it is on npm, run `node /path/to/lumen-md/mcp-server/dist/lumen.js`
where this page says `npx -p @lumen-md/mcp-server lumen`, and use
`"command": "node", "args": ["/path/to/lumen-md/mcp-server/dist/index.js", "--client", "…"]`
where a client config says `npx -y @lumen-md/mcp-server`.

## Turn a client on

```bash
cd ~/Documents/Lumen            # your vault folder
npx -p @lumen-md/mcp-server lumen mcp enable claude-desktop --scopes search,read
npx -p @lumen-md/mcp-server lumen mcp status
```

| Scope | Tools |
|---|---|
| `search` | `search_notes` — BM25 over Hebrew and English (prefix letters ו ה ב ל מ ש כ and niqqud are handled) |
| `read` | `read_note`, `list_notes`, `list_tags`, `get_backlinks`, `list_types`, `get_type`, `bases_query` |
| `propose` | `create_note`, `append_note`, `write_note`, `update_frontmatter`, `create_object`, `bases_update` — proposals only |

`lumen mcp enable <client>` without `--scopes` grants `search,read`. Add
`propose` only for a client you want suggestions from. `lumen mcp disable
<client>` takes effect on its next call. The settings live in
`<vault>/.lumen/mcp.json`; clients cannot read or write anything under
`.lumen/` (or any other dot folder), `..` or absolute paths.

## Connect it

Give each client its own `--client` name — the one you enabled. (Without
it, the server uses the name the client reports when it connects.)

The name is the client's own word, not a proof: a client that reports another
client's name gets that client's tools, and the app that starts the server
chooses `--client` anyway. So grants keep apart the apps you set up, not an app
that lies about itself. Enable only apps you trust with the scopes you give,
and writes still wait for your approval whatever the name.

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS; `%APPDATA%\Claude\` on Windows):

```json
{
  "mcpServers": {
    "lumen": {
      "command": "npx",
      "args": ["-y", "@lumen-md/mcp-server", "--client", "claude-desktop"],
      "env": { "LUMEN_VAULT": "/Users/you/Documents/Lumen" }
    }
  }
}
```

**Claude Code** — from any folder:

```bash
claude mcp add lumen -e LUMEN_VAULT="$HOME/Documents/Lumen" -- npx -y @lumen-md/mcp-server --client claude-code
npx -p @lumen-md/mcp-server lumen mcp enable claude-code --vault "$HOME/Documents/Lumen" --scopes search,read
```

**Cursor** (`~/.cursor/mcp.json`), **VS Code** (`.vscode/mcp.json`, key
`servers`) and **Zed** (`context_servers`) take the same command and
arguments: `npx -y @lumen-md/mcp-server --client cursor` (or `vscode`,
`zed`) with `LUMEN_VAULT` in `env`.

## What a client may see

`.lumen/mcp.json` can limit, for every client (`scope`) or for one (`clients.<id>.scope`), which notes the MCP tools see at all:

```json
{ "scope": { "deny": { "folders": ["journal"], "tags": ["private"] } },
  "clients": { "cursor": { "enabled": true, "scopes": ["search", "read"],
                           "scope": { "allow": { "folders": ["work"] } } } } }
```

- **How a note is judged.** A note is visible when no allow list is set or it matches one (a folder or a tag), and it matches no deny entry. Deny always wins. Both the vault's rules and the client's rules must pass.
- **Tags.** Tags are the frontmatter `tags` and inline `#tags`, outside code. `private` also covers `private/health`.
- **Where it applies.** The rules apply to every tool: search, read, list, tags, backlinks and Bases. They also apply to every proposed change, so a client can't write into a hidden note, or tag a note to hide it.
- **Hidden notes.** A hidden note answers exactly like a missing one, and the refusal is logged.
- **Citations.** Every answer from a note carries an anchor: `[[note#Heading]]`, or `[[note#L12]]` above the first heading. It appears as a fourth column in search hits, and as `_meta["io.lumen/anchors"]` on read_note, search_notes and get_backlinks. A note's text is never changed.

## Approving changes

A client's `create_note` / `append_note` / `write_note` /
`update_frontmatter` writes a proposal to `.lumen/mcp/pending/` and tells
the client nothing is written yet. You decide:

- **In Lumen:** the proposals appear in the review screen
  (⌘K → *AI: Review changes proposed by agents*, or the **Review** badge in
  the status bar) as "Proposed by claude-desktop (MCP client)", each as a
  diff. Approve writes the note; Reject drops it. This needs the vault
  folder in the app — the same folder, or synced with Git (`.lumen/` is
  synced like the notes).
- **In a terminal:**

  ```bash
  lumen mcp review              # every proposal as a diff
  lumen mcp approve <id>        # or --client <id>: each diff, then type yes (needs a terminal)
  lumen mcp reject <id>         # or --all
  ```

A proposal keeps the text it was computed from. If the note changed since,
approving writes nothing and the proposal is dropped as a conflict.

## Protocol versions

The server speaks the [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
protocol and, on the same process, the older `initialize` handshake
(2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05), so clients of either
generation connect.

- **2026-07-28:** no handshake and no session. Every request names its
  protocol version and client capabilities in `_meta`; `server/discover`
  lists the versions, capabilities and server identity. Tool lists say how
  long they stay fresh (`ttlMs`) and that they are `private` (they depend on
  what you granted that client), and come in one fixed order.
- **A write waits for you:** on a 2026-07-28 connection a proposal answers
  `input_required` with a signed `requestState`. The client retries the same
  call with it, and gets "written", "rejected" or "conflict" once you decide
  — or `input_required` again while you have not. Nothing the client sends
  can approve a change: the state is signed with a key that stays in
  `.lumen/mcp/state.key`, bound to that client and that call, and expires
  after an hour (then the client simply proposes again).
- **Not offered:** Roots, Sampling and Logging (deprecated in 2026-07-28).
  The server logs to stderr only.
- **Errors:** an unknown version gets `-32022` with the supported list; a
  request without the required `_meta` (and no handshake) gets `-32602`.

### Checking a client by hand

1. Build and enable the client as above, then add `--client claude-code`
   (or `claude-desktop`) to its config.
2. Ask the client to *search the vault for "launch"*, then to *read* one of
   the results: both answer from your notes.
3. Ask it to *create a note*: the client says it is waiting for approval,
   and the proposal is in Lumen's review screen. Approve it; the note
   appears, and `lumen mcp log` shows `proposed` then `approved`.

## Streamable HTTP

`lumen mcp serve --http [port]` serves the same tools over Streamable HTTP. It listens on `127.0.0.1` only, at `/mcp`, and the default port is 3917. It follows MCP 2026-07-28:

- **Request headers.** Every request must carry `MCP-Protocol-Version`, `Mcp-Method` and, for `tools/call`, `Mcp-Name`. Each has to match the request body. A missing header or one that doesn't match is refused with 400 and `HeaderMismatch` (-32020). A Base64 `=?base64?…?=` value is decoded first.
- **Change notifications.** `subscriptions/listen` opens the stream, in place of the old GET stream. It acknowledges first, then sends `notifications/tools/list_changed` when you turn a client on or off, or change its scopes. GET and DELETE answer 405.
- **Origin.** A browser origin other than a loopback one gets 403.
- **Older clients.** A client that starts with `initialize` (2025-11-25 and earlier) still works.

On stdio, `subscriptions/listen` works too, and its messages carry the subscription's id.

## Bases

`bases_query` returns the rows of a `.base` view as JSON: `{ view, columns,
rows: [{ path, cells }], total, errors }`, 200 rows at a time (`offset`,
`limit` up to 10,000). The rows come from Lumen's own Bases engine, bundled
into the server at build time, so they are exactly the rows the app shows.

`bases_update` takes the same edits as the plugin API
(`[{ "path": "Tasks/a.md", "set": { "status": "done" } }]`, up to 5,000
rows). Each note that would change becomes a proposal in the approval queue,
all under one batch; nothing is written until you approve them. Over MCP
2026-07-28 the client waits (`input_required`) until you have decided on
every note of the batch, then learns how many were written, rejected or not
written because the note changed.

From a terminal:

```bash
lumen bases query Tasks.base --view Open          # tab-separated; --json for JSON
lumen bases update --edits edits.json --dry-run   # what would change; nothing written
lumen bases update --edits edits.json             # queued for the review screen
lumen bases update --edits edits.json --approve   # each diff at the terminal; type yes to write
```

Bases need the engine bundle: build the server with `npm ci` in the
repository root first, then `npm run build` in `mcp-server/`.

## Types

A type is a file in the vault, `.lumen/types/<id>.yaml`. It has labels, an
activating tag, one `extends` parent and typed fields. The notes stay plain
frontmatter.

- `list_types` lists the types.
- `get_type` gives one type's fields, inherited ones first, with their
  kinds, options and relation targets.
- `create_object` proposes a new note of a type. Its values are checked
  against the schema first. An unknown field, a value of the wrong kind, an
  option that is not in the list, or a relation to a note of another type is
  an error. When there is an error nothing is proposed, and the ledger
  records `denied` with the reason `schema: <fields>`. A valid object is one
  proposal in the approval queue, inside the client's folder and tag scope.

From a terminal:

```bash
lumen types                                   # the types
lumen types show book                         # its fields; --json for JSON
lumen new "Dune" --type book --set pages=412 --set 'author=[[Frank Herbert]]'
```

Like `lumen new`, `lumen new --type` writes directly, because you are at
your terminal. A value that does not fit the type writes nothing.

## Lumen as a client: outside servers for the local agents

The other way round: Lumen's own agents can use tools of other MCP servers,
for example the Knesset's bills and votes, data.gov.il, your Zotero library or
your files. Nothing is connected until you add a server and turn it on.

- **Servers:** local ones (a command on this computer, desktop app only, or a
  `127.0.0.1` address) and remote ones (Streamable HTTP). Lumen speaks MCP
  2026-07-28 and falls back to the older handshake for older servers.
- **Permission per server and per tool:** *read* (runs without asking, only
  for tools the server marks read-only), *ask* (you approve each call, the
  default) or *block* (never offered to the model).
- **Airplane mode and local-only AI:** every remote server is blocked, and no
  connection is made. A program on this computer counts as remote too, since it
  may reach the network itself, unless you mark it *offline*. Each remote call is in the privacy ledger.
- **Injection guard:** what a server returns is outside content. It is cleaned
  and marked before the model sees it, and any change or network call the
  agent then tries needs your approval.
- **Sign-in (OAuth):** Lumen identifies itself with a client metadata document
  (`https://lumen-md.vercel.app/oauth/client-metadata.json`), uses PKCE, checks
  that the sign-in answer comes from the server it asked (`iss`), and keeps
  each server's credentials tied to the server that issued them.
- **Suggested servers** (off until you turn them on): Knesset (Knessy, MIT),
  data.gov.il, Zotero, your files.

## The ledger

Every call — allowed, refused, proposed, approved, rejected — is a line in
`.lumen/mcp/ledger.jsonl`: time, client, tool, scope, note path, decision,
and how many bytes of your vault went to the client. Never the note text
or the query. `lumen mcp log` prints it.

## The `lumen` CLI

```bash
lumen search budget meeting      # path, title, matching line (exit 3: nothing found)
lumen open "Launch plan"         # opens it in your default app; --print to print it
lumen new ideas/one "first line" # creates; refuses if it exists
lumen append ideas/one.md "more"
lumen daily "call Dana"          # journal/YYYY-MM-DD.md, adds "- 09:05 call Dana"
```

The vault is `--vault <dir>`, else `$LUMEN_VAULT`, else the current folder.
`new`, `append` and `daily` are you at the keyboard, so they write directly
(logged as client `cli`). Install with `npm i -g @lumen-md/mcp-server`, or
run from a clone with `npm run lumen -- search …`.

## Speed

Search keeps an index in memory, built on the first search and brought up
to date before each one (only changed notes are read again). On 10,000
notes a search answers in well under 300 ms.
