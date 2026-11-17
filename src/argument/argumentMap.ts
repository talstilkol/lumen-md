/**
 * The argument map (plan W12.V4): claims and their sources, with
 * "supports", "contradicts" and "qualifies" — the typed relations of
 * W12.T6, not a separate graph.
 *
 * Two built-in types (src/types, `registerBuiltinTypes`): `claim` (טענה)
 * and `evidence` (מקור). Each has the three relation fields, all pointing at
 * claims; a claim may be marked `conclusion: true`. They are ordinary notes:
 *
 *     ---
 *     type: evidence
 *     supports: ["[[השכר עלה]]"]
 *     ---
 *
 * The map lays them out in layers, sources → claims → conclusions (our own
 * layered layout: longest path from the sources over the relations, a cycle
 * broken where it closes, then one barycentre pass to cut crossings), and
 * flags a claim that no source reaches through "supports" or "qualifies".
 * It exports to JSON Canvas (and from there to Excalidraw), and its
 * alternative is a nested list: claim ← its sources.
 *
 * Pure.
 */

import type { JsonCanvas } from "../canvas/jsonCanvas";

export const ARGUMENT_RELATIONS = ["supports", "contradicts", "qualifies"] as const;
export type ArgumentRelation = (typeof ARGUMENT_RELATIONS)[number];

export type ArgNodeKind = "source" | "claim" | "conclusion";

export interface ArgNode {
  id: string;
  /** The note's name, as shown. */
  label: string;
  kind: ArgNodeKind;
}
export interface ArgEdge {
  from: string;
  to: string;
  relation: ArgumentRelation;
}
export interface ArgumentGraph {
  nodes: ArgNode[];
  edges: ArgEdge[];
}

export interface ArgNoteInput {
  path: string;
  /** Parsed frontmatter. */
  fm: Record<string, unknown>;
  tags?: readonly string[];
}

const WIKI = /^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/;
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");

function typesOf(fm: Record<string, unknown>, tags: readonly string[]): Set<string> {
  const t = fm.type;
  const list = Array.isArray(t) ? t : t === undefined || t === null ? [] : [t];
  const out = new Set(list.map((x) => String(x).trim().toLowerCase()));
  for (const tag of tags) {
    const base = tag.replace(/^#/, "").toLowerCase().split("/")[0];
    if (base === "claim" || base === "evidence") out.add(base);
  }
  // The types' Hebrew labels in `type:` work too (W12.T1).
  if (out.has("טענה")) out.add("claim");
  if (out.has("מקור")) out.add("evidence");
  return out;
}

/** The link targets of a relation value: `[[A]]`, `"[[A|alias]]"`, a list of them, or a bare name. */
export function linkTargets(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
  return list.map((x) => String(x)).map((s) => (WIKI.exec(s)?.[1] ?? s).trim()).filter(Boolean);
}

/** Notes of type claim / evidence and their relations, resolved by path or name. */
export function argumentGraph(notes: readonly ArgNoteInput[]): ArgumentGraph {
  const byKey = new Map<string, string>();
  for (const n of notes) {
    byKey.set(n.path.toLowerCase(), n.path);
    byKey.set(n.path.replace(/\.(md|markdown)$/i, "").toLowerCase(), n.path);
    if (!byKey.has(basename(n.path).toLowerCase())) byKey.set(basename(n.path).toLowerCase(), n.path);
  }
  const nodes: ArgNode[] = [];
  const kept = new Set<string>();
  for (const n of notes) {
    const types = typesOf(n.fm, n.tags ?? []);
    if (!types.has("claim") && !types.has("evidence")) continue;
    const kind: ArgNodeKind = types.has("claim") ? (n.fm.conclusion === true ? "conclusion" : "claim") : "source";
    nodes.push({ id: n.path, label: basename(n.path), kind });
    kept.add(n.path);
  }
  const edges: ArgEdge[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    if (!kept.has(n.path)) continue;
    for (const relation of ARGUMENT_RELATIONS)
      for (const target of linkTargets(n.fm[relation])) {
        const to = byKey.get(target.toLowerCase()) ?? byKey.get(`${target}.md`.toLowerCase());
        if (!to || to === n.path || !kept.has(to)) continue;
        const k = `${n.path}\u0000${to}\u0000${relation}`;
        if (seen.has(k)) continue;
        seen.add(k);
        edges.push({ from: n.path, to, relation });
      }
  }
  return { nodes, edges };
}

/** Claims no source reaches through "supports" / "qualifies" (directly or through other claims). */
export function unsupportedClaims(g: ArgumentGraph): Set<string> {
  const reached = new Set<string>();
  const out = new Map<string, string[]>();
  for (const e of g.edges) if (e.relation !== "contradicts") (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
  const stack = g.nodes.filter((n) => n.kind === "source").map((n) => n.id);
  while (stack.length) {
    const x = stack.pop()!;
    for (const y of out.get(x) ?? [])
      if (!reached.has(y)) {
        reached.add(y);
        stack.push(y);
      }
  }
  return new Set(g.nodes.filter((n) => n.kind !== "source" && !reached.has(n.id)).map((n) => n.id));
}

export interface LaidOut {
  layers: string[][];
  /** Node → [layer, position in layer]. */
  at: Map<string, [number, number]>;
}

/**
 * Layers: sources in layer 0; every other node one past its deepest
 * predecessor (a cycle is broken at the edge that closes it, in input
 * order); conclusions in a last layer of their own. One barycentre pass
 * orders each layer by its predecessors' positions.
 */
export function layoutArgument(g: ArgumentGraph): LaidOut {
  const preds = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  // Drop the edges that would close a cycle (DFS in input order).
  const outs = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) outs.get(e.from)?.push(e.to);
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const dfs = (x: string) => {
    state.set(x, 1);
    for (const y of outs.get(x) ?? []) {
      if (state.get(y) === 1) back.add(`${x}\u0000${y}`);
      else if (!state.has(y)) dfs(y);
    }
    state.set(x, 2);
  };
  for (const n of g.nodes) if (n.kind === "source" && !state.has(n.id)) dfs(n.id);
  for (const n of g.nodes) if (!state.has(n.id)) dfs(n.id);
  for (const e of g.edges) if (!back.has(`${e.from}\u0000${e.to}`)) preds.get(e.to)?.push(e.from);
  const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const layer = new Map<string, number>();
  const depth = (x: string, guard = new Set<string>()): number => {
    if (layer.has(x)) return layer.get(x)!;
    if (kind.get(x) === "source" || guard.has(x)) return 0;
    guard.add(x);
    const ps = preds.get(x) ?? [];
    const d = ps.length ? 1 + Math.max(...ps.map((p) => depth(p, guard))) : 1;
    layer.set(x, d);
    return d;
  };
  for (const n of g.nodes) layer.set(n.id, n.kind === "source" ? 0 : depth(n.id));
  const lastClaim = Math.max(0, ...g.nodes.filter((n) => n.kind !== "conclusion").map((n) => layer.get(n.id)!));
  for (const n of g.nodes) if (n.kind === "conclusion") layer.set(n.id, Math.max(layer.get(n.id)!, lastClaim + 1));
  const count = Math.max(0, ...layer.values()) + 1;
  const layers: string[][] = Array.from({ length: count }, () => []);
  for (const n of g.nodes) layers[layer.get(n.id)!].push(n.id);
  const at = new Map<string, [number, number]>();
  layers.forEach((ids, li) => {
    if (li > 0) {
      const bary = (id: string) => {
        const ps = (preds.get(id) ?? []).map((p) => at.get(p)?.[1]).filter((x): x is number => x !== undefined);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.POSITIVE_INFINITY;
      };
      ids.sort((a, b) => bary(a) - bary(b));
    }
    ids.forEach((id, i) => at.set(id, [li, i]));
  });
  return { layers: layers.filter((l) => l.length), at: relayer(layers, at) };
}

function relayer(layers: string[][], at: Map<string, [number, number]>): Map<string, [number, number]> {
  // Empty layers (none can be empty but the conclusions' when there are none) are dropped; renumber.
  const keep = layers.map((l, i) => (l.length ? i : -1)).filter((i) => i >= 0);
  const map = new Map(keep.map((old, i) => [old, i]));
  const out = new Map<string, [number, number]>();
  for (const [id, [l, p]] of at) out.set(id, [map.get(l)!, p]);
  return out;
}

export const NODE_W = 220;
export const NODE_H = 60;
const GAP_X = 120;
const GAP_Y = 40;

/** Pixel boxes: layer 0 at the inline start — on the right in RTL. */
export function argumentBoxes(lo: LaidOut, dir: "rtl" | "ltr"): Map<string, { x: number; y: number }> {
  const width = lo.layers.length * NODE_W + (lo.layers.length - 1) * GAP_X;
  const out = new Map<string, { x: number; y: number }>();
  for (const [id, [l, p]] of lo.at) {
    const x = l * (NODE_W + GAP_X);
    out.set(id, { x: dir === "rtl" ? width - NODE_W - x : x, y: p * (NODE_H + GAP_Y) });
  }
  return out;
}

/** The reading order of the nodes: layer by layer, top to bottom (the keyboard's order). */
export function readingOrder(lo: LaidOut): string[] {
  return lo.layers.flat();
}

const COLOR: Record<ArgumentRelation, string> = { supports: "4", contradicts: "1", qualifies: "3" };

/** The map as a JSON Canvas (file nodes for the notes, labelled edges; green supports, red contradicts, yellow qualifies). */
export function argumentToJsonCanvas(g: ArgumentGraph, lo: LaidOut, dir: "rtl" | "ltr", labels: Record<ArgumentRelation, string>): JsonCanvas {
  const boxes = argumentBoxes(lo, dir);
  const ids = new Map(g.nodes.map((n, i) => [n.id, `n${i}`]));
  return {
    nodes: g.nodes.map((n) => ({ id: ids.get(n.id)!, type: "file" as const, file: n.id, x: boxes.get(n.id)!.x, y: boxes.get(n.id)!.y, width: NODE_W, height: NODE_H, ...(n.kind === "conclusion" ? { color: "6" } : {}) })),
    edges: g.edges.map((e, i) => {
      // The edge leaves the side facing its target (in RTL the target is usually to the left).
      const forward = boxes.get(e.from)!.x <= boxes.get(e.to)!.x;
      return {
        id: `e${i}`,
        fromNode: ids.get(e.from)!,
        toNode: ids.get(e.to)!,
        fromSide: forward ? ("right" as const) : ("left" as const),
        toSide: forward ? ("left" as const) : ("right" as const),
        toEnd: "arrow" as const,
        color: COLOR[e.relation],
        label: labels[e.relation],
      };
    }),
  };
}
