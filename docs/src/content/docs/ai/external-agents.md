---
title: External agents (ACP)
description: Host Claude Code, Codex or OpenCode on the desktop over the Agent Client Protocol. Every write they make waits in the same review queue as Lumen's own agents.
type: reference
tasks: ["W11.I23"]
---

On the desktop, Lumen can run an external coding agent on your vault over the [Agent Client Protocol](https://agentclientprotocol.com) (ACP, version 1). Three are supported: Claude Code, Codex and OpenCode.

- **Writes wait for you.** A file the agent writes goes to the review panel as a proposed change. The agent gets its answer only after you approve the change, or reject it.
- **Its own tools are limited.** When the agent asks to edit, delete, move, run a command or fetch a page with its own tools, Lumen says no. A change reaches the vault only as a proposed change. Lumen may ask you about read, search and think steps, once each and never "always".
- **The vault only.** The agent can read only files inside the vault. It gets no terminal, and it cannot write files that steer agents, such as `CLAUDE.md` or `AGENTS.md`.
- **Lumen's tools.** The agent also gets Lumen's MCP server (`lumen mcp serve`) with the scopes you gave it.
- **Privacy.** All three agents send what they read to a cloud model. A session needs your consent. Airplane mode refuses it. The privacy ledger records the session and every prompt as `acp://<agent>`.
- **Limit.** The agent is a program running with your permissions. If it ignores ACP and writes files itself, Lumen can't stop it from inside the app. Only run agents you trust.
