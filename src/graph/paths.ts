/**
 * "Show me how A connects to B" (plan W13.G4): the k shortest paths between
 * two entities, each explained as a chain of citations — entity → relation →
 * entity, every link with the paragraph it was read from (`note#^anchor`).
 *
 * - The graph: the entity graph's edges (W12.E7), undirected for the search
 *   (a relation connects both ways), in CSR form over typed arrays. Two
 *   entities joined by several relations keep the strongest as the step and
 *   list the others with it.
 * - The cost of a step: −ln(confidence) + a hop cost, so a short chain of
 *   sure links beats a long one and a sure link beats a doubtful one.
 * - Yen's k-shortest loopless paths over Dijkstra; with a length limit, the
 *   search runs over (node, hops) states, so the limit is exact.
 * - Filters: only some relation types; a minimum confidence; a maximum
 *   length in hops.
 *
 * Pure: no DOM, no storage.
 */
import type { Edge, Entity } from "../entities/model";
import { paragraphByAnchor } from "../entities/paragraphs";

export interface PathOptions {
  /** How many paths (Yen's k). */
  k?: number;
  /** Only these relation types (predicate ids). */
  predicates?: ReadonlySet<string>;
  /** Longest path, in hops (links). */
  maxHops?: number;
  minConfidence?: number;
  /** Cost of one hop on top of −ln(confidence). */
  hopCost?: number;
}

export interface PathStep {
  from: string;
  to: string;
  /** The strongest relation between the two, the one the step stands on. */
  edge: Edge;
  /** True when the relation reads from → to (subject → object); false when it reads to → from. */
  forward: boolean;
  /** Other relations between the same two entities, strongest first. */
  others: Edge[];
}

export interface FoundPath {
  /** Entity ids, from the start to the end. */
  nodes: string[];
  steps: PathStep[];
  cost: number;
}

export interface PathGraph {
  ids: string[];
  index: Map<string, number>;
  /** CSR: the links of node i are offsets[i] .. offsets[i + 1] in `nbr` / `link`. */
  offsets: Uint32Array;
  nbr: Uint32Array;
  /** Which undirected link (an index into `links`). */
  link: Uint32Array;
  /** Per link: its cost and its relations (strongest first). */
  cost: Float64Array;
  links: Edge[][];
}

export const DEFAULT_HOP_COST = 0.1;
const MIN_CONF = 0.01;

/** Cost of one relation. */
export const edgeCost = (confidence: number, hopCost = DEFAULT_HOP_COST) => -Math.log(Math.min(1, Math.max(MIN_CONF, Number.isFinite(confidence) ? confidence : MIN_CONF))) + hopCost;

/** The searchable graph of these entities and edges, after the filters. */
export function buildPathGraph(entities: readonly Entity[], edges: readonly Edge[], opts: Pick<PathOptions, "predicates" | "minConfidence" | "hopCost"> = {}): PathGraph {
  const ids = entities.map((e) => e.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  // One link per unordered pair, keyed by a·n + b (numbers, not strings: 30,000 relations in a few ms).
  const n = ids.length;
  const byPair = new Map<number, number>();
  const links: Edge[][] = [];
  const ends: number[] = [];
  for (const e of edges) {
    if (e.status === "rejected") continue;
    if (opts.predicates && !opts.predicates.has(e.predicate)) continue;
    if (opts.minConfidence !== undefined && e.confidence < opts.minConfidence) continue;
    const a = index.get(e.subject);
    const b = index.get(e.object);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? a * n + b : b * n + a;
    const at = byPair.get(key);
    if (at === undefined) {
      byPair.set(key, links.length);
      links.push([e]);
      ends.push(a, b);
    } else links[at].push(e);
  }
  const cost = new Float64Array(links.length);
  const degree = new Uint32Array(n);
  for (let l = 0; l < links.length; l++) {
    const list = links[l];
    if (list.length > 1) list.sort((x, y) => y.confidence - x.confidence || (x.id < y.id ? -1 : 1));
    cost[l] = edgeCost(list[0].confidence, opts.hopCost);
    degree[ends[2 * l]]++;
    degree[ends[2 * l + 1]]++;
  }
  const offsets = new Uint32Array(ids.length + 1);
  for (let i = 0; i < ids.length; i++) offsets[i + 1] = offsets[i] + degree[i];
  const fill = offsets.slice(0, ids.length);
  const nbr = new Uint32Array(offsets[ids.length]);
  const link = new Uint32Array(offsets[ids.length]);
  for (let l = 0; l < links.length; l++) {
    const a = ends[2 * l];
    const b = ends[2 * l + 1];
    nbr[fill[a]] = b;
    link[fill[a]++] = l;
    nbr[fill[b]] = a;
    link[fill[b]++] = l;
  }
  return { ids, index, offsets, nbr, link, cost, links };
}

/** A binary min-heap of (cost, item) on typed arrays. */
class Heap {
  private keys = new Float64Array(64);
  private vals = new Uint32Array(64);
  size = 0;
  push(k: number, v: number) {
    if (this.size === this.keys.length) {
      const nk = new Float64Array(this.size * 2);
      nk.set(this.keys);
      this.keys = nk;
      const nv = new Uint32Array(this.size * 2);
      nv.set(this.vals);
      this.vals = nv;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= k) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = k;
    this.vals[i] = v;
  }
  /** Pops the smallest; its key is left in `lastKey`. */
  lastKey = 0;
  pop(): number {
    const top = this.vals[0];
    this.lastKey = this.keys[0];
    const k = this.keys[--this.size];
    const v = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= k) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = k;
    this.vals[i] = v;
    return top;
  }
}

interface Search {
  /** Blocked nodes (1) and links (1). */
  nodeOff: Uint8Array;
  linkOff: Uint8Array;
  /**
   * A* heuristic: each node's cost to the target in the whole graph. Blocking
   * nodes and links and limiting the length only make paths dearer, so it
   * never overestimates, and the searches Yen runs after the first one mostly
   * walk straight along it.
   */
  toTarget?: Float64Array;
}

/**
 * The cheapest path from s to t avoiding the blocked nodes and links, in at
 * most `maxHops` links (Infinity: plain Dijkstra). Node indices, or null.
 */
function shortest(g: PathGraph, s: number, t: number, maxHops: number, block: Search): { nodes: number[]; links: number[]; cost: number } | null {
  if (block.nodeOff[s] || block.nodeOff[t]) return null;
  const n = g.ids.length;
  const H = Number.isFinite(maxHops) ? Math.max(0, Math.floor(maxHops)) : 0;
  const layers = H ? H + 1 : 1;
  // State = node (unbounded) or node·(H+1) + hops (bounded).
  const states = n * layers;
  const dist = new Float64Array(states).fill(Infinity);
  const h = block.toTarget;
  const prev = new Int32Array(states).fill(-1);
  const via = new Int32Array(states).fill(-1);
  const heap = new Heap();
  const st = (v: number, h: number) => (H ? v * layers + h : v);
  dist[st(s, 0)] = 0;
  heap.push(h ? h[s] : 0, st(s, 0));
  let found = -1;
  while (heap.size) {
    const x = heap.pop();
    const v = H ? Math.floor(x / layers) : x;
    if (heap.lastKey > dist[x] + (h ? h[v] : 0) + 1e-12) continue;
    const hops = H ? x % layers : 0;
    if (v === t) {
      found = x;
      break;
    }
    if (H && hops >= H) continue;
    for (let j = g.offsets[v]; j < g.offsets[v + 1]; j++) {
      const w = g.nbr[j];
      const l = g.link[j];
      if (block.nodeOff[w] || block.linkOff[l]) continue;
      if (h && h[w] === Infinity) continue;
      const y = st(w, hops + 1);
      const d = dist[x] + g.cost[l];
      if (d < dist[y]) {
        dist[y] = d;
        prev[y] = x;
        via[y] = l;
        heap.push(d + (h ? h[w] : 0), y);
      }
    }
  }
  if (found < 0) return null;
  const nodes: number[] = [];
  const links: number[] = [];
  for (let x = found; x >= 0; x = prev[x]) {
    nodes.push(H ? Math.floor(x / layers) : x);
    if (via[x] >= 0) links.push(via[x]);
  }
  nodes.reverse();
  links.reverse();
  return { nodes, links, cost: dist[found] };
}

/** Every node's cheapest cost to t (Dijkstra from t; links are undirected). */
function distancesTo(g: PathGraph, t: number): Float64Array {
  const dist = new Float64Array(g.ids.length).fill(Infinity);
  const heap = new Heap();
  dist[t] = 0;
  heap.push(0, t);
  while (heap.size) {
    const v = heap.pop();
    if (heap.lastKey > dist[v]) continue;
    for (let j = g.offsets[v]; j < g.offsets[v + 1]; j++) {
      const w = g.nbr[j];
      const d = dist[v] + g.cost[g.link[j]];
      if (d < dist[w]) {
        dist[w] = d;
        heap.push(d, w);
      }
    }
  }
  return dist;
}

/** Yen's k shortest loopless paths from `from` to `to` (entity ids). */
export function kShortestPaths(g: PathGraph, from: string, to: string, opts: Pick<PathOptions, "k" | "maxHops"> = {}): FoundPath[] {
  const s = g.index.get(from);
  const t = g.index.get(to);
  if (s === undefined || t === undefined || s === t) return [];
  const K = Math.max(1, Math.floor(opts.k ?? 5));
  const maxHops = opts.maxHops ?? Infinity;
  const block: Search = { nodeOff: new Uint8Array(g.ids.length), linkOff: new Uint8Array(g.links.length) };
  block.toTarget = distancesTo(g, t);
  const first = shortest(g, s, t, maxHops, block);
  if (!first) return [];
  const A: Array<{ nodes: number[]; links: number[]; cost: number }> = [first];
  const B: Array<{ nodes: number[]; links: number[]; cost: number }> = [];
  const seen = new Set([first.links.join(",")]);
  while (A.length < K) {
    const last = A[A.length - 1];
    for (let i = 0; i < last.nodes.length - 1; i++) {
      const spur = last.nodes[i];
      const rootLinks = last.links.slice(0, i);
      const rootCost = rootLinks.reduce((c, l) => c + g.cost[l], 0);
      block.nodeOff.fill(0);
      block.linkOff.fill(0);
      for (const p of A) if (p.links.length > i && p.links.slice(0, i).every((l, k) => l === rootLinks[k])) block.linkOff[p.links[i]] = 1;
      for (let k = 0; k < i; k++) block.nodeOff[last.nodes[k]] = 1;
      const tail = shortest(g, spur, t, maxHops - i, block);
      if (!tail) continue;
      const links = [...rootLinks, ...tail.links];
      const key = links.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      B.push({ nodes: [...last.nodes.slice(0, i), ...tail.nodes], links, cost: rootCost + tail.cost });
    }
    if (!B.length) break;
    B.sort((x, y) => x.cost - y.cost || x.links.length - y.links.length);
    A.push(B.shift()!);
  }
  return A.map((p) => ({
    nodes: p.nodes.map((i) => g.ids[i]),
    cost: p.cost,
    steps: p.links.map((l, k) => {
      const fromId = g.ids[p.nodes[k]];
      const toId = g.ids[p.nodes[k + 1]];
      const [edge, ...others] = g.links[l];
      return { from: fromId, to: toId, edge, forward: edge.subject === fromId, others };
    }),
  }));
}

/** Build and search in one call (the panel's entry point). */
export function findPaths(entities: readonly Entity[], edges: readonly Edge[], from: string, to: string, opts: PathOptions = {}): FoundPath[] {
  return kShortestPaths(buildPathGraph(entities, edges, opts), from, to, opts);
}

export interface CitedStep extends PathStep {
  /** The paragraph the relation was read from, found by its block id in the note as it is now; null when it is gone. */
  paragraph: string | null;
}

/** Each step with its paragraph, looked up in the notes' current text (`^anchor`). */
export function citeChain(path: FoundPath, texts: ReadonlyMap<string, string>): CitedStep[] {
  return path.steps.map((s) => {
    const text = texts.get(s.edge.provenance.note);
    const p = text === undefined ? null : paragraphByAnchor(text, s.edge.provenance.anchor);
    return { ...s, paragraph: p ? p.text : null };
  });
}
