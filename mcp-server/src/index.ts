#!/usr/bin/env node
/**
 * @lumen-md/mcp-server — exposes a Lumen workspace to AI agents over the
 * Model Context Protocol.
 *
 * The server is intentionally tiny: it points at a directory on disk (the
 * workspace the user keeps in sync with Lumen via Git or `lumen export`)
 * and offers four tools:
 *
 *   • read_note(path)         — return the markdown body of a single note.
 *   • write_note(path, body)  — create or overwrite a note.
 *   • list_notes()            — return every .md path in the workspace.
 *   • search_workspace(query) — naive case-insensitive substring search.
 *
 * Usage from Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "lumen": {
 *         "command": "npx",
 *         "args": ["-y", "@lumen-md/mcp-server"],
 *         "env": { "LUMEN_WORKSPACE": "/Users/you/Documents/Lumen" }
 *       }
 *     }
 *   }
 *
 * Then in Claude: "Read my note about deep learning" — the agent calls
 * search_workspace + read_note transparently.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from "node:fs";
import * as path from "node:path";

const WORKSPACE = process.env.LUMEN_WORKSPACE || path.join(process.cwd(), "lumen-workspace");

/* ─── Helpers ────────────────────────────────────────────────────────── */

function safeJoin(rel: string): string {
  // Reject `..` segments and absolute paths so the agent can't escape the
  // workspace root. This is the main security boundary.
  const normalized = path.posix.normalize(rel.replace(/\\/g, "/"));
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Path '${rel}' is outside the workspace.`);
  }
  return path.join(WORKSPACE, normalized);
}

async function listMarkdownFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await listMarkdownFiles(path.join(dir, e.name), rel)));
    } else if (/\.(md|markdown|txt)$/i.test(e.name)) {
      out.push(rel);
    }
  }
  return out;
}

/* ─── MCP server ─────────────────────────────────────────────────────── */

const server = new Server(
  { name: "lumen-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "read_note",
      description: "Read the markdown body of a single note inside the Lumen workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path, e.g. 'projects/launch-plan.md'" },
        },
        required: ["path"],
      },
    },
    {
      name: "write_note",
      description: "Create or overwrite a note. Parent directories are created automatically.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string", description: "UTF-8 markdown body." },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "list_notes",
      description: "Recursively list every .md / .markdown / .txt path in the workspace.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "search_workspace",
      description: "Case-insensitive substring search across all note titles and bodies.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", default: 20 },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  switch (req.params.name) {
    case "read_note": {
      const rel = String(args.path ?? "");
      const body = await fs.readFile(safeJoin(rel), "utf8");
      return { content: [{ type: "text", text: body }] };
    }
    case "write_note": {
      const rel = String(args.path ?? "");
      const content = String(args.content ?? "");
      const abs = safeJoin(rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      return { content: [{ type: "text", text: `Wrote ${rel} (${content.length} chars).` }] };
    }
    case "list_notes": {
      const files = await listMarkdownFiles(WORKSPACE);
      return { content: [{ type: "text", text: files.join("\n") || "(empty workspace)" }] };
    }
    case "search_workspace": {
      const query = String(args.query ?? "").toLowerCase();
      const limit = Number(args.limit ?? 20);
      if (!query.trim()) return { content: [{ type: "text", text: "Empty query." }] };
      const files = await listMarkdownFiles(WORKSPACE);
      const hits: { path: string; line: number; snippet: string }[] = [];
      for (const rel of files) {
        let body: string;
        try {
          body = await fs.readFile(safeJoin(rel), "utf8");
        } catch {
          continue;
        }
        const lines = body.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(query)) {
            hits.push({ path: rel, line: i + 1, snippet: lines[i].trim().slice(0, 200) });
            if (hits.length >= limit) break;
          }
        }
        if (hits.length >= limit) break;
      }
      const text = hits.length
        ? hits.map((h) => `${h.path}:${h.line}: ${h.snippet}`).join("\n")
        : `No matches for '${query}'.`;
      return { content: [{ type: "text", text }] };
    }
    default:
      throw new Error(`Unknown tool: ${req.params.name}`);
  }
});

await server.connect(new StdioServerTransport());
// stdout is reserved for MCP framing — log to stderr instead.
process.stderr.write(`lumen-mcp: ready on workspace ${WORKSPACE}\n`);
