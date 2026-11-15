/**
 * The vault's MCP tools (plan W2.3), independent of the MCP SDK so tests
 * and the CLI drive exactly what a client gets.
 *
 * Every tool has a scope (config.ts). A call is checked against the
 * client's grant in `.lumen/mcp.json`, read again on every call so that
 * `lumen mcp disable` takes effect at once; a client that is not enabled
 * gets no tools and every call is refused. Write tools only propose
 * (pending.ts). Every call — allowed, refused or proposed — goes to the
 * ledger (ledger.ts).
 */
import { grantFor, normalizeClientId, readConfig, type McpScope } from "./config.js";
import { appendLedger } from "./ledger.js";
import { proposeWrite, readNote } from "./pending.js";
import { notePath, safeRel, VaultPathError } from "./paths.js";
import { VaultIndex } from "./search.js";
import { parseFrontmatter, serializeFrontmatter } from "../frontmatter.js";
import { BasesUnavailableError, planBasesUpdate, proposeBatch, queryVaultBase } from "./bases.js";
import { anchorAt, hasRules, inScope, lineOf, noteAnchors, type ScopeRules } from "./scope.js";
import { problemsText, typesDeps, typesEngine, TypesUnavailableError } from "./types.js";

export interface ToolDef {
  name: string;
  scope: McpScope;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  /** Set when the call queued a proposal: its id in the approval queue (not sent to the client as such). */
  proposalId?: string;
  /** Set when the call queued several proposals at once (a Bases update): the batch id (bases.ts). */
  batchId?: string;
  /** W11.I7: where the answer comes from, `[[note#Heading]]` or `[[note#L12]]` (sent in `_meta`). */
  anchors?: string[];
  /** W11.I7: the call touched a note outside the client's scope (logged as denied; answered as if absent). */
  outOfScope?: boolean;
  /** W12.T4: the call was refused for this reason (a schema error); logged as denied, nothing queued. */
  refused?: string;
}

export interface ToolContext {
  vault: string;
  /** The client id (normalised); see `normalizeClientId`. */
  client: string;
  index: VaultIndex;
  /** W11.I7: the vault's and the client's scope rules (filled by callTool from .lumen/mcp.json). */
  rules?: readonly (ScopeRules | undefined)[];
}

/** No note text leaves for a note outside the scope; the answer is the one for a missing note. */
const OUT_OF_SCOPE = "outside the client's scope (allow/deny by folder or tag)";

const str = (description?: string) => (description ? { type: "string", description } : { type: "string" });

export const TOOLS: readonly ToolDef[] = [
  {
    name: "search_notes",
    scope: "search",
    description: "Search the notes (BM25, Hebrew and English). Returns path, title and a matching line per note.",
    inputSchema: { type: "object", properties: { query: str("Words to find; every word must match."), limit: { type: "number", default: 20 } }, required: ["query"] },
  },
  {
    name: "read_note",
    scope: "read",
    description: "Read one note's Markdown.",
    inputSchema: { type: "object", properties: { path: str("Vault-relative path, e.g. 'projects/launch.md'") }, required: ["path"] },
  },
  { name: "list_notes", scope: "read", description: "List every note path in the vault.", inputSchema: { type: "object", properties: {} } },
  { name: "list_tags", scope: "read", description: "Every frontmatter tag with its note count.", inputSchema: { type: "object", properties: {} } },
  {
    name: "get_backlinks",
    scope: "read",
    description: "Notes that contain a [[wiki-link]] to the given note.",
    inputSchema: { type: "object", properties: { path: str() }, required: ["path"] },
  },
  {
    name: "create_note",
    scope: "propose",
    description: "Propose a new note. Nothing is written until the user approves it in Lumen.",
    inputSchema: { type: "object", properties: { path: str(), content: str("Markdown body.") }, required: ["path", "content"] },
  },
  {
    name: "append_note",
    scope: "propose",
    description: "Propose adding text to the end of a note (created if missing). Waits for the user's approval.",
    inputSchema: { type: "object", properties: { path: str(), content: str() }, required: ["path", "content"] },
  },
  {
    name: "write_note",
    scope: "propose",
    description: "Propose replacing a note's whole text. Waits for the user's approval.",
    inputSchema: { type: "object", properties: { path: str(), content: str() }, required: ["path", "content"] },
  },
  {
    name: "update_frontmatter",
    scope: "propose",
    description: "Propose setting or removing frontmatter keys of a note. Waits for the user's approval.",
    inputSchema: {
      type: "object",
      properties: { path: str(), set: { type: "object", description: "Keys to set." }, unset: { type: "array", items: { type: "string" } } },
      required: ["path"],
    },
  },
  {
    name: "list_types",
    scope: "read",
    description: "The vault's object types (W12.T4: .lumen/types/<id>.yaml): id, Hebrew and English label, activating tag, parent type and field count. JSON.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_type",
    scope: "read",
    description: "One type's schema: every field (inherited ones first) with its kind (text, number, date, hebrew-date, select, multi-select, relation, checkbox, url, formula, rollup), options, relation target, default and whether it is computed. JSON.",
    inputSchema: { type: "object", properties: { type: str("Type id or label, e.g. 'book' or 'ספר'.") }, required: ["type"] },
  },
  {
    name: "create_object",
    scope: "propose",
    description:
      "Propose a new note of a type. The values are checked against the type's schema: an unknown field, a value of the wrong kind, an option not in the list or a relation to a note of another type is an error and nothing is proposed. A valid object waits for the user's approval in Lumen.",
    inputSchema: {
      type: "object",
      properties: {
        type: str("Type id or label."),
        title: str("The note's title (also its file name when path is not given)."),
        path: str("Vault-relative path of the new note (optional)."),
        values: { type: "object", description: "field: value. Relations are '[[Note]]' links (a list when the field takes several); dates are YYYY-MM-DD." },
        body: str("Markdown after the frontmatter (default: '# <title>')."),
      },
      required: ["type"],
    },
  },
  {
    name: "bases_query",
    scope: "read",
    description: "Rows of a Lumen/Obsidian .base view, computed by Lumen's own Bases engine: the same rows the app shows. Returns JSON { view, columns, rows: [{ path, cells }], total, errors }.",
    inputSchema: {
      type: "object",
      properties: {
        base: str("Vault-relative path of the .base file, e.g. 'projects/tasks.base'"),
        view: { type: ["string", "number"], description: "View name or index (default: the first view)." },
        offset: { type: "number", default: 0 },
        limit: { type: "number", default: 200, description: "At most 10,000." },
      },
      required: ["base"],
    },
  },
  {
    name: "bases_update",
    scope: "propose",
    description: "Propose changing note properties (rows of a base): one proposal per changed note, in one batch. Nothing is written until the user approves it in Lumen.",
    inputSchema: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          description: "At most 5,000 rows.",
          items: { type: "object", properties: { path: str("The note (.md)."), set: { type: "object", description: "property: value (text, number, true/false, null or a list of texts)." } }, required: ["path", "set"] },
        },
      },
      required: ["edits"],
    },
  },
];

/** Rows `bases_query` returns when the client does not say. */
export const BASES_DEFAULT_LIMIT = 200;

/** Old names from the first MCP server, still answered. */
const ALIASES: Record<string, string> = { search_workspace: "search_notes" };

export function toolDef(name: string): ToolDef | undefined {
  const real = ALIASES[name] ?? name;
  return TOOLS.find((t) => t.name === real);
}

/** The tools this client may call right now (empty when it is not enabled). */
export async function listToolsFor(vault: string, client: string): Promise<ToolDef[]> {
  const scopes = grantFor(await readConfig(vault), client);
  return scopes ? TOOLS.filter((t) => scopes.includes(t.scope)) : [];
}

const text = (t: string, isError = false): ToolResult => (isError ? { content: [{ type: "text", text: t }], isError: true } : { content: [{ type: "text", text: t }] });

export function enableHint(client: string, scope: McpScope): string {
  return `lumen mcp enable ${normalizeClientId(client)} --scopes ${scope === "search" ? "search" : scope === "read" ? "search,read" : "search,read,propose"}`;
}

export async function callTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  const def = toolDef(name);
  const client = normalizeClientId(ctx.client);
  if (!def) return text(`Unknown tool: ${name}`, true);
  const cfg = await readConfig(ctx.vault);
  const scopes = grantFor(cfg, client);
  ctx = { ...ctx, rules: [cfg.scope, cfg.clients[client]?.scope] };
  if (!scopes || !scopes.includes(def.scope)) {
    const reason = scopes ? `scope '${def.scope}' not granted` : "client not enabled";
    await appendLedger(ctx.vault, { client, tool: def.name, scope: def.scope, decision: "denied", bytesOut: 0, reason });
    return text(
      scopes
        ? `Lumen: '${client}' may not use ${def.name} (needs the '${def.scope}' scope). The user can allow it with: ${enableHint(client, def.scope)}`
        : `Lumen: access from '${client}' is off. The user can turn it on with: ${enableHint(client, def.scope)}`,
      true,
    );
  }
  let target: string | undefined;
  try {
    const result = await run(ctx, client, def, args, (p) => (target = p));
    if (result.refused) {
      await appendLedger(ctx.vault, { client, tool: def.name, scope: def.scope, path: target, decision: "denied", bytesOut: 0, reason: result.refused.slice(0, 200) });
      return result;
    }
    if (result.outOfScope) {
      await appendLedger(ctx.vault, { client, tool: def.name, scope: def.scope, path: target, decision: "denied", bytesOut: 0, reason: OUT_OF_SCOPE });
      return result;
    }
    if (def.scope !== "propose") {
      const bytesOut = result.content.reduce((n, c) => n + Buffer.byteLength(c.text, "utf8"), 0);
      await appendLedger(ctx.vault, { client, tool: def.name, scope: def.scope, path: target, decision: "allowed", bytesOut: result.isError ? 0 : bytesOut });
    }
    return result;
  } catch (e) {
    const msg = e instanceof VaultPathError ? e.message : `Lumen: ${(e as Error)?.message ?? String(e)}`;
    await appendLedger(ctx.vault, { client, tool: def.name, scope: def.scope, path: target, decision: "denied", bytesOut: 0, reason: msg.slice(0, 200) });
    return text(msg, true);
  }
}

async function propose(ctx: ToolContext, client: string, tool: string, rel: string, before: string | null, after: string): Promise<ToolResult> {
  if (before === after) return text(`No change to ${rel}.`);
  const p = await proposeWrite(ctx.vault, { client, tool, path: rel, before, after });
  return { ...text(`Proposed ${before === null ? "a new note" : "a change to"} ${rel} (id ${p.id}). Nothing is written until the user approves it; only the user can (do not try to approve it yourself).`), proposalId: p.id };
}

async function run(ctx: ToolContext, client: string, def: ToolDef, args: Record<string, unknown>, onPath: (p: string) => void): Promise<ToolResult> {
  const rules = ctx.rules ?? [];
  const scoped = hasRules(rules);
  /** A note the client may see (path, and its text when it exists). */
  const visible = (rel: string, body: string | null) => !scoped || inScope(rel, body, rules);
  const visiblePaths = () => ctx.index.paths().filter((p) => visible(p, ctx.index.text(p) ?? null));
  /** A write target and its new text: both the note as it is and as it would be must be in scope. */
  const mayChange = (rel: string, before: string | null, after: string | null) => visible(rel, before) && (after === null || visible(rel, after));
  const refuseChange = (rel: string): ToolResult => ({ ...text(`Lumen: ${rel} is outside what this client may change.`, true), outOfScope: true });
  switch (def.name) {
    case "search_notes": {
      const query = String(args.query ?? "");
      if (!query.trim()) return text("Empty query.", true);
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20) || 20));
      // Ask for more when scoped, so filtering does not starve the answer.
      const hits = (await ctx.index.search(query, scoped ? Math.min(500, limit * 5) : limit)).filter((h) => visible(h.path, ctx.index.text(h.path) ?? null)).slice(0, limit);
      const anchors = hits.map((h) => anchorAt(h.path, ctx.index.text(h.path) ?? "", lineOf(ctx.index.text(h.path) ?? "", h.snippet)));
      return hits.length ? { ...text(hits.map((h, i) => `${h.path}\t${h.title}\t${h.snippet}\t${anchors[i]}`).join("\n")), anchors } : text(`No notes match '${query}'.`);
    }
    case "read_note": {
      const rel = safeRel(String(args.path ?? ""));
      onPath(rel);
      const body = await readNote(ctx.vault, rel);
      if (body !== null && !visible(rel, body)) return { ...text(`No note at ${rel}.`, true), outOfScope: true };
      return body === null ? text(`No note at ${rel}.`, true) : { ...text(body), anchors: noteAnchors(rel, body) };
    }
    case "list_notes": {
      await ctx.index.refresh();
      const all = visiblePaths();
      return text(all.join("\n") || "(empty vault)");
    }
    case "list_tags": {
      await ctx.index.refresh();
      const counts = new Map<string, number>();
      for (const rel of visiblePaths()) {
        const tags = parseFrontmatter(ctx.index.text(rel) ?? "").data.tags;
        const list = Array.isArray(tags) ? tags.map(String) : typeof tags === "string" ? tags.split(/[,\s]+/) : [];
        for (const raw of list) {
          const key = raw.replace(/^#/, "").toLowerCase();
          if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return text(sorted.length ? sorted.map(([t, c]) => `${t}\t${c}`).join("\n") : "(no tags found)");
    }
    case "get_backlinks": {
      const rel = safeRel(String(args.path ?? ""));
      onPath(rel);
      await ctx.index.refresh();
      const target = rel.split("/").pop()!.replace(/\.(md|markdown|txt)$/i, "");
      const re = new RegExp(`\\[\\[(?:[^\\]|#]*/)?${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.md)?(?:[|#][^\\]]*)?\\]\\]`, "i");
      const self = await readNote(ctx.vault, rel);
      if (self !== null && !visible(rel, self)) return { ...text(`(no backlinks to ${target})`), outOfScope: true };
      const hits = visiblePaths().filter((p) => p !== rel && re.test(ctx.index.text(p) ?? ""));
      const anchors = hits.map((p) => {
        const t = ctx.index.text(p) ?? "";
        const m = re.exec(t);
        return anchorAt(p, t, m ? t.slice(0, m.index).split("\n").length : 1);
      });
      // The text stays one path a line (clients parse it); the anchors go in _meta.
      return hits.length ? { ...text(hits.join("\n")), anchors } : text(`(no backlinks to ${target})`);
    }
    case "create_note": {
      const rel = notePath(String(args.path ?? ""));
      onPath(rel);
      const content = String(args.content ?? "");
      const existing = await readNote(ctx.vault, rel);
      if (!mayChange(rel, existing, content)) return refuseChange(rel);
      if (existing !== null) return text(`${rel} already exists; use append_note or write_note.`, true);
      return propose(ctx, client, def.name, rel, null, content);
    }
    case "append_note": {
      const rel = notePath(String(args.path ?? ""));
      onPath(rel);
      const content = String(args.content ?? "");
      const before = await readNote(ctx.vault, rel);
      const after = before === null || before === "" ? content : before.endsWith("\n") ? before + content : `${before}\n${content}`;
      if (!mayChange(rel, before, after)) return refuseChange(rel);
      return propose(ctx, client, def.name, rel, before, after);
    }
    case "write_note": {
      const rel = notePath(String(args.path ?? ""));
      onPath(rel);
      const before = await readNote(ctx.vault, rel);
      const after = String(args.content ?? "");
      if (!mayChange(rel, before, after)) return refuseChange(rel);
      return propose(ctx, client, def.name, rel, before, after);
    }
    case "update_frontmatter": {
      const rel = notePath(String(args.path ?? ""));
      onPath(rel);
      const before = await readNote(ctx.vault, rel);
      if (before === null) return text(`No note at ${rel}.`, true);
      if (!visible(rel, before)) return { ...text(`No note at ${rel}.`, true), outOfScope: true };
      const fm = parseFrontmatter(before);
      const data: Record<string, unknown> = { ...fm.data, ...((args.set && typeof args.set === "object" ? args.set : {}) as Record<string, unknown>) };
      for (const k of Array.isArray(args.unset) ? args.unset.map(String) : []) delete data[k];
      const after = serializeFrontmatter(data) + before.slice(fm.bodyStart);
      if (!visible(rel, after)) return refuseChange(rel);
      return propose(ctx, client, def.name, rel, before, after);
    }
    case "bases_query": {
      const base = String(args.base ?? "");
      onPath(base);
      try {
        if (scoped && !visible(safeRel(base), null)) return { ...text(`No file at ${base}.`, true), outOfScope: true };
        const r = await queryVaultBase(ctx.vault, base, args.view, { offset: args.offset, limit: args.limit ?? BASES_DEFAULT_LIMIT }, undefined, scoped ? (p, t) => visible(p, t) : undefined);
        return text(JSON.stringify(r));
      } catch (e) {
        if (e instanceof BasesUnavailableError || e instanceof VaultPathError) return text(e.message, true);
        return text(`Lumen: ${(e as Error)?.message ?? String(e)}`, true);
      }
    }
    case "bases_update": {
      let plan;
      try {
        plan = await planBasesUpdate(ctx.vault, args.edits, scoped ? (p, t) => visible(p, t) : undefined);
      } catch (e) {
        if (e instanceof BasesUnavailableError || e instanceof VaultPathError) return text(e.message, true);
        return text(`Lumen: ${(e as Error)?.message ?? String(e)}`, true);
      }
      if (!plan.changes.length) return text(`No change: ${plan.summary.unchanged} row(s) already have these values.`);
      const outside = plan.changes.find((c) => !mayChange(c.path, c.before, c.after));
      if (outside) return refuseChange(outside.path);
      const batch = await proposeBatch(ctx.vault, client, def.name, plan.changes);
      onPath(plan.changes[0]!.path);
      const props = plan.summary.properties.join(", ");
      return {
        ...text(
          `Proposed changes to ${plan.changes.length} note(s) (${props}; batch ${batch.id}). Nothing is written until the user approves them; only the user can (do not try to approve them yourself).`,
        ),
        batchId: batch.id,
      };
    }
    case "list_types":
    case "get_type":
    case "create_object": {
      let e;
      try {
        e = await typesEngine();
      } catch (err) {
        if (err instanceof TypesUnavailableError) return text(err.message, true);
        throw err;
      }
      const deps = typesDeps(ctx.vault);
      if (def.name === "list_types") return text(JSON.stringify(await e.listTypes(deps)));
      if (def.name === "get_type") {
        const t = await e.getType(deps, String(args.type ?? ""));
        return t ? text(JSON.stringify(t)) : text(`No type '${String(args.type ?? "")}'.`, true);
      }
      const plan = await e.planObject(deps, args);
      if (!plan.ok) {
        const msg = `Lumen: the object does not fit the type's schema; nothing was proposed.\n${problemsText(plan.problems)}`;
        return { ...text(msg, true), refused: `schema: ${plan.problems.map((p) => p.field).join(", ")}` };
      }
      const rel = notePath(plan.path);
      onPath(rel);
      const existing = await readNote(ctx.vault, rel);
      if (!mayChange(rel, existing, plan.text)) return refuseChange(rel);
      if (existing !== null) return text(`${rel} already exists; choose another title or path.`, true);
      return propose(ctx, client, def.name, rel, null, plan.text);
    }
    default:
      return text(`Unknown tool: ${def.name}`, true);
  }
}
