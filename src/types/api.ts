/**
 * Typed objects for MCP clients and the CLI (plan W12.T4): list the types,
 * one type's schema, and the note a new object would be — checked against
 * the schema. Nothing here writes: the MCP server puts a valid object in
 * the approval queue (mcp-server/src/vault/pending.ts), and a value that
 * does not fit is a schema error, not a write.
 *
 * `npm run build` in mcp-server/ bundles this file into
 * dist/types-engine.js (scripts/bundle-bases.mjs), as it does the Bases
 * engine, so a client gets exactly the app's own schema rules.
 */
import { loadTypeRegistry, typesOfNote, type TypeRegistry } from "./typeRegistry";
import { linkTarget, newObjectText, relationTargetOk, type ValueProblem } from "./fieldValues";
import type { FieldDef } from "./typeSchema";
import { basesFileFromText } from "../views/bases/base";

export interface TypesDeps {
  /** `.lumen/types/*.yaml` with their text. */
  typeFiles(): Promise<Array<{ path: string; text: string }>>;
  /** Every vault file path (for relation targets). */
  paths?(): Promise<string[]>;
  /** A note's text, or null when it does not exist. */
  readNote?(path: string): Promise<string | null>;
}

export interface TypeSummary {
  id: string;
  label: { he?: string; en?: string };
  tag?: string;
  extends?: string;
  fields: number;
  errors: string[];
}

export interface FieldJson {
  name: string;
  kind: FieldDef["kind"];
  label?: { he?: string; en?: string };
  pinned: boolean;
  default?: unknown;
  options?: string[];
  to?: string;
  multiple?: boolean;
  computed?: boolean;
  /** The type that declared it (a parent, for inherited fields). */
  from: string;
}

export interface TypeSchemaJson extends TypeSummary {
  chain: string[];
  schema: FieldJson[];
}

async function registry(deps: TypesDeps): Promise<TypeRegistry> {
  return loadTypeRegistry(await deps.typeFiles());
}

export async function listTypes(deps: TypesDeps): Promise<{ types: TypeSummary[]; errors: string[] }> {
  const reg = await registry(deps);
  return {
    types: [...reg.types.values()].map((t) => ({ id: t.id, label: t.label, ...(t.tag ? { tag: t.tag } : {}), ...(t.extends ? { extends: t.extends } : {}), fields: t.effective.length, errors: t.errors })),
    errors: [...reg.errors],
  };
}

export async function getType(deps: TypesDeps, id: string): Promise<TypeSchemaJson | null> {
  const reg = await registry(deps);
  const t = reg.get(id) ?? (reg.resolveName(id) ? reg.get(reg.resolveName(id)!) : undefined);
  if (!t) return null;
  return {
    id: t.id,
    label: t.label,
    ...(t.tag ? { tag: t.tag } : {}),
    ...(t.extends ? { extends: t.extends } : {}),
    fields: t.effective.length,
    errors: t.errors,
    chain: t.chain,
    schema: t.effective.map((f) => ({
      name: f.name,
      kind: f.kind,
      ...(f.label ? { label: f.label } : {}),
      pinned: f.pinned,
      ...(f.default !== undefined ? { default: f.default } : {}),
      ...(f.options ? { options: f.options } : {}),
      ...(f.to ? { to: f.to, multiple: !!f.multiple } : {}),
      ...(f.kind === "formula" || f.kind === "rollup" ? { computed: true } : {}),
      from: t.declaredBy[f.name] ?? t.id,
    })),
  };
}

export interface ObjectRequest {
  type: string;
  /** Vault-relative path of the new note; default `<title>.md`. */
  path?: string;
  title?: string;
  values?: Record<string, unknown>;
  body?: string;
}

export type ObjectPlan = { ok: true; path: string; text: string; type: string } | { ok: false; problems: ValueProblem[] };

const bad = (field: string, message: string): ObjectPlan => ({ ok: false, problems: [{ field, code: "kind", message }] });

/** Resolve `[[Target]]` the way Obsidian does: path, path + .md, then the shortest path with that note name. */
function resolveLink(paths: readonly string[], target: string): string | null {
  const t = target.trim().replace(/^\/+/, "").toLowerCase();
  const exact = paths.find((p) => p.toLowerCase() === t || p.toLowerCase() === `${t}.md`);
  if (exact) return exact;
  const name = t.slice(t.lastIndexOf("/") + 1);
  const byName = paths.filter((p) => p.toLowerCase().replace(/^.*\//, "").replace(/\.md$/, "") === name).sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1));
  return byName[0] ?? null;
}

/**
 * The new note of a type, checked against the schema (W12.T4): unknown
 * fields, values that do not fit, and relation targets of another type are
 * problems, and then there is no text to write.
 */
export async function planObject(deps: TypesDeps, raw: unknown): Promise<ObjectPlan> {
  if (!raw || typeof raw !== "object") return bad("type", "the request is { type, title or path, values }");
  const req = raw as ObjectRequest;
  if (typeof req.type !== "string" || !req.type.trim()) return bad("type", "type is required");
  const reg = await registry(deps);
  const id = reg.get(req.type)?.id ?? reg.resolveName(req.type);
  if (!id) return bad("type", `no type '${req.type}' (types: ${[...reg.types.keys()].join(", ") || "none"})`);
  const values = req.values && typeof req.values === "object" && !Array.isArray(req.values) ? req.values : {};
  if (req.values !== undefined && values !== req.values) return bad("values", "values is a map of field: value");
  const title = typeof req.title === "string" ? req.title.trim() : "";
  const path = typeof req.path === "string" && req.path.trim() ? req.path.trim() : title ? `${title.replace(/[\\/:*?"<>|#^[\]]+/g, "-")}.md` : "";
  if (!path) return bad("path", "give a title or a path");
  const body = typeof req.body === "string" ? req.body : title ? `# ${title}\n` : "";
  const made = newObjectText(reg, id, { values, body });
  if (!made.ok) return made;
  // Relation targets that exist must be of the target type; a link to a note that does not exist yet is allowed, as in Obsidian.
  const problems: ValueProblem[] = [];
  const t = reg.get(id)!;
  if (deps.paths && deps.readNote) {
    const paths = await deps.paths();
    for (const f of t.effective) {
      if (f.kind !== "relation" || !(f.name in values)) continue;
      for (const v of Array.isArray(values[f.name]) ? (values[f.name] as unknown[]) : [values[f.name]]) {
        const target = linkTarget(v);
        const at = target ? resolveLink(paths, target) : null;
        if (!at) continue;
        const text = await deps.readNote(at);
        const file = text === null ? null : basesFileFromText(at, text);
        if (!relationTargetOk(reg, f, file)) {
          const has = file ? typesOfNote(reg, file).types.map((x) => x.id) : [];
          problems.push({ field: f.name, code: "target", message: `${f.name}: ${at} is ${has.length ? `a ${has.join(", ")}` : "not typed"}, not a ${f.to}` });
        }
      }
    }
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, path, text: made.text, type: id };
}
