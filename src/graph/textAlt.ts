/**
 * The graph without the picture (plan W13.G11): what a sighted user reads
 * off the canvas at a glance — how many nodes and links, how many clusters,
 * which nodes are the hubs, what kinds there are — as data a screen reader
 * can speak, and every node's neighbours grouped by relation, so the graph
 * can be walked one neighbour at a time.
 *
 * One model (`AltGraph`) for the entity graph (kind = entity type, relation
 * = predicate) and the note graph (kind = none, relation = "link"); the
 * summary, the list mode and the table all read the same visible graph, so
 * none of them can show a node the others do not.
 *
 * Clusters are Leiden communities (R12.8, views/leiden.ts) of two nodes or
 * more; a node with no link is counted apart, as "unconnected". Above
 * `LEIDEN_MAX` nodes the count is of connected components instead (cheap,
 * and still the shape a sighted user sees), and the result says so.
 *
 * Pure; no DOM. The UI formats the parts with t().
 */
import { leiden } from "../views/leiden";
import { compareNames } from "../i18n/collate";

export interface AltNode {
  id: string;
  label: string;
  /** Entity type, or undefined for notes. */
  kind?: string;
}

export interface AltEdge {
  source: string;
  target: string;
  /** Predicate id, or undefined for a plain note link. */
  relation?: string;
}

export interface AltGraph {
  nodes: readonly AltNode[];
  edges: readonly AltEdge[];
}

export interface GraphSummary {
  nodes: number;
  edges: number;
  /** Clusters of two nodes or more. */
  clusters: number;
  /** How the clusters were counted. */
  clusterMethod: "leiden" | "components";
  /** Nodes with no link. */
  unconnected: number;
  /** The most connected nodes, most first (ties by label), at most `top`. */
  hubs: Array<{ id: string; label: string; degree: number }>;
  /** Nodes per kind, most first (kinds only; notes have none). */
  kinds: Array<{ kind: string; count: number }>;
}

/** Above this many nodes clusters are connected components, not Leiden communities. */
export const LEIDEN_MAX = 20_000;

/** Distinct neighbours of every node (a self-link is not a neighbour). */
export function degrees(g: AltGraph): Map<string, number> {
  const nb = new Map<string, Set<string>>();
  for (const n of g.nodes) nb.set(n.id, new Set());
  for (const e of g.edges) {
    if (e.source === e.target) continue;
    nb.get(e.source)?.add(e.target);
    nb.get(e.target)?.add(e.source);
  }
  return new Map([...nb].map(([id, s]) => [id, s.size]));
}

function components(g: AltGraph): Map<string, number> {
  const parent = new Map(g.nodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const e of g.edges) if (parent.has(e.source) && parent.has(e.target)) parent.set(find(e.source), find(e.target));
  const ids = new Map<string, number>();
  const out = new Map<string, number>();
  for (const n of g.nodes) {
    const r = find(n.id);
    if (!ids.has(r)) ids.set(r, ids.size);
    out.set(n.id, ids.get(r)!);
  }
  return out;
}

/** Cluster of every node: Leiden communities, or components on a big graph. */
export function clustersOf(g: AltGraph): { of: Map<string, number>; method: GraphSummary["clusterMethod"] } {
  if (g.nodes.length > LEIDEN_MAX) return { of: components(g), method: "components" };
  const r = leiden({ nodes: g.nodes.map((n) => n.id), edges: g.edges.filter((e) => e.source !== e.target).map((e) => ({ source: e.source, target: e.target })) });
  return { of: r.communities, method: "leiden" };
}

export function summarize(g: AltGraph, top = 3): GraphSummary {
  const deg = degrees(g);
  const { of, method } = clustersOf(g);
  const size = new Map<number, number>();
  for (const n of g.nodes) if ((deg.get(n.id) ?? 0) > 0) size.set(of.get(n.id)!, (size.get(of.get(n.id)!) ?? 0) + 1);
  const unconnected = g.nodes.filter((n) => !deg.get(n.id)).length;
  const hubs = g.nodes
    .filter((n) => (deg.get(n.id) ?? 0) > 0)
    .map((n) => ({ id: n.id, label: n.label, degree: deg.get(n.id)! }))
    .sort((a, b) => b.degree - a.degree || compareNames(a.label, b.label))
    .slice(0, top);
  const kc = new Map<string, number>();
  for (const n of g.nodes) if (n.kind) kc.set(n.kind, (kc.get(n.kind) ?? 0) + 1);
  const kinds = [...kc].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || compareNames(a.kind, b.kind));
  return { nodes: g.nodes.length, edges: g.edges.length, clusters: [...size.values()].filter((s) => s >= 2).length, clusterMethod: method, unconnected, hubs, kinds };
}

export interface NeighbourGroup {
  /** The relation (predicate id, or "" for a plain link). */
  relation: string;
  /** "out": this node is the subject; "in": it is the object. */
  direction: "out" | "in";
  /** Neighbours in label order. */
  nodes: AltNode[];
}

/**
 * The neighbours of `id`, grouped by relation and direction: outgoing
 * relations first, then incoming, each by relation id; a neighbour reached
 * by two relations is in both groups.
 */
export function neighbourGroups(g: AltGraph, id: string): NeighbourGroup[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const groups = new Map<string, NeighbourGroup & { seen: Set<string> }>();
  for (const e of g.edges) {
    if (e.source === e.target) continue;
    const dir = e.source === id ? "out" : e.target === id ? "in" : null;
    if (!dir) continue;
    const other = byId.get(dir === "out" ? e.target : e.source);
    if (!other) continue;
    const key = `${dir}\u0000${e.relation ?? ""}`;
    const grp = groups.get(key) ?? groups.set(key, { relation: e.relation ?? "", direction: dir, nodes: [], seen: new Set() }).get(key)!;
    if (grp.seen.has(other.id)) continue;
    grp.seen.add(other.id);
    grp.nodes.push(other);
  }
  return [...groups.values()]
    .map(({ seen: _seen, ...grp }) => ({ ...grp, nodes: grp.nodes.sort((a, b) => compareNames(a.label, b.label)) }))
    .sort((a, b) => (a.direction === b.direction ? compareNames(a.relation, b.relation) : a.direction === "out" ? -1 : 1));
}

/** The node ids every view of `g` shows, in one order (for the "same nodes" check). */
export const nodeIds = (g: AltGraph): string[] => g.nodes.map((n) => n.id).sort();
