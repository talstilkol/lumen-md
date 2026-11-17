/**
 * "Open as graph" from a Base or a query (plan W13.G9): the rows a Base
 * view or a ```query block shows, as a graph.
 *
 * - A Base: one node per row (kind = the note's `type:`, else its folder),
 *   one edge per link from a row to another row; a link written in a
 *   property is named by that property (`author`, `parent`), a link in the
 *   body is a plain "link". Notes the rows link to outside the Base can be
 *   added as their own kind ("outside").
 * - A query: its rows, and the vault graph's links between them (the note
 *   graph of W1.10, restricted to the result).
 *
 * Links resolve as Obsidian resolves them: a path, a path without `.md`, or
 * a note name (case-insensitive, NFC); `#heading` and `|alias` are dropped.
 */
import type { GraphData } from "./graphModel";

export interface SetNode {
  id: string;
  label: string;
  kind: string;
}

export interface SetEdge {
  source: string;
  target: string;
  relation: string;
}

export interface SetGraph {
  nodes: SetNode[];
  edges: SetEdge[];
}

/** What baseToGraph reads of a Bases row (BaseRow["file"], structurally). */
export interface RowFile {
  path: string;
  basename: string;
  folder: string;
  links: readonly string[];
  fm: Record<string, unknown>;
}

export const OUTSIDE_KIND = "outside";

const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();
const target = (raw: string) => raw.replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();

/** Every `[[link]]` in a frontmatter value (strings, lists, nested). */
function fmLinks(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") for (const m of v.matchAll(/\[\[([^\]]+)\]\]/g)) out.push(target(m[1]));
  else if (Array.isArray(v)) for (const x of v) fmLinks(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) fmLinks(x, out);
  return out;
}

export function kindOf(f: Pick<RowFile, "fm" | "folder">): string {
  const t = Array.isArray(f.fm.type) ? f.fm.type[0] : f.fm.type;
  if (typeof t === "string" && t.trim()) return t.trim();
  return f.folder || "/";
}

export function baseToGraph(rows: readonly RowFile[], opts: { outside?: boolean } = {}): SetGraph {
  const byKey = new Map<string, string>();
  const nodes: SetNode[] = [];
  const ids = new Set<string>();
  for (const r of rows) {
    if (ids.has(r.path)) continue;
    ids.add(r.path);
    nodes.push({ id: r.path, label: r.basename, kind: kindOf(r) });
    for (const k of [r.path, r.path.replace(/\.md$/i, ""), r.basename]) if (!byKey.has(norm(k))) byKey.set(norm(k), r.path);
  }
  const edges: SetEdge[] = [];
  const seen = new Set<string>();
  const outside = new Map<string, SetNode>();
  const resolve = (raw: string): string | null => {
    const to = byKey.get(norm(raw)) ?? byKey.get(norm(raw.replace(/\.md$/i, "")));
    if (to) return to;
    if (!opts.outside) return null;
    const label = raw.split("/").pop()!.replace(/\.md$/i, "");
    const id = `outside:${norm(label)}`;
    if (!outside.has(id)) outside.set(id, { id, label, kind: OUTSIDE_KIND });
    return id;
  };
  for (const r of rows) {
    // A link written in a property is named by it; the same target linked from the body adds nothing.
    const rel = new Map<string, string>();
    for (const [key, v] of Object.entries(r.fm)) for (const l of fmLinks(v)) {
      const to = l && resolve(l);
      if (to && !rel.has(to)) rel.set(to, key);
    }
    for (const l of r.links) {
      const to = target(l) && resolve(target(l));
      if (to && !rel.has(to)) rel.set(to, "link");
    }
    for (const [to, relation] of rel) {
      if (to === r.path) continue;
      const key = `${r.path}\u0000${to}\u0000${relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: r.path, target: to, relation });
    }
  }
  return { nodes: [...nodes, ...outside.values()], edges };
}

/** The vault graph restricted to `paths` (a query's rows): their links to each other. */
export function subgraphOfPaths(g: GraphData, paths: readonly string[]): SetGraph {
  const index = new Map(g.paths.map((p, i) => [p, i]));
  const keep = new Set<number>();
  const nodes: SetNode[] = [];
  for (const p of paths) {
    const i = index.get(p);
    if (i === undefined || keep.has(i)) continue;
    keep.add(i);
    const folder = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "/";
    nodes.push({ id: p, label: g.labels[i], kind: folder });
  }
  const edges: SetEdge[] = [];
  const seen = new Set<string>();
  for (const i of keep)
    for (let k = g.offsets[i]; k < g.offsets[i + 1]; k++) {
      const j = g.neighbors[k];
      if (!keep.has(j) || j === i) continue;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      if (seen.has(`${a}:${b}`)) continue;
      seen.add(`${a}:${b}`);
      edges.push({ source: g.paths[a], target: g.paths[b], relation: "link" });
    }
  return { nodes, edges };
}

/** Distinct neighbours per node. */
export function setDegrees(g: SetGraph): Map<string, number> {
  const nb = new Map<string, Set<string>>(g.nodes.map((n) => [n.id, new Set()]));
  for (const e of g.edges) {
    nb.get(e.source)?.add(e.target);
    nb.get(e.target)?.add(e.source);
  }
  return new Map([...nb].map(([k, s]) => [k, s.size]));
}
