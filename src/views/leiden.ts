/**
 * Leiden community detection, static and live (plan R12.8) — an option
 * next to ./louvain.ts.
 *
 * Static (`leiden`): the structure of Traag, Waltman & van Eck, "From
 * Louvain to Leiden: guaranteeing well-connected communities" (Sci. Rep.
 * 9, 5233, 2019): fast local moving with a queue, a refinement step, and
 * aggregation on the refined partition with each aggregate node starting
 * in its unrefined community; repeated while anything moves. The refinement
 * here is the connectivity part of Leiden's guarantee only: every community
 * is split into its connected parts (Leiden's randomised merge within a
 * community is not done), so a community is never disconnected.
 * Deterministic (nodes in input order), resolution 1.
 *
 * Live (`LiveLeiden`): a batch of edge changes without a rebuild, in the
 * three stages of HIT-Leiden — only the endpoints of the changed edges are
 * queued for local moving (a node that moves requeues its neighbours),
 * every community that lost a node or an inside edge is re-split into its
 * connected parts, and the touched communities may move as a whole to a
 * neighbour community when that raises modularity.
 *
 * `modularity` is Newman's Q, Σ_c [L_c / m − (d_c / 2m)²], for any
 * partition — the one number both algorithms are compared on. (louvain.ts's
 * own `modularity` sums the null-model term over adjacent pairs only, so it
 * is not comparable; it is left as it is.)
 *
 * The owner's IsraelConnect `leiden_live.js` was a design reference for the
 * live stages; this is a separate implementation. Pure, no dependency.
 */

import type { CommunityResult, GraphInput } from "./louvain";

/** The largest value, or `floor` (a loop: spreading 100k values into Math.max overflows the stack). */
function maxOf(values: Iterable<number>, floor: number): number {
  let m = floor;
  for (const v of values) if (v > m) m = v;
  return m;
}

interface WGraph {
  n: number;
  /** Neighbour → weight (a self-loop is stored once, with its weight). */
  adj: Array<Map<number, number>>;
  /** Weighted degree (a self-loop counts twice). */
  deg: Float64Array;
  /** Total edge weight m. */
  m: number;
}

function fromInput(input: GraphInput): { g: WGraph; idx: Map<string, number> } {
  const idx = new Map<string, number>();
  input.nodes.forEach((id) => {
    if (!idx.has(id)) idx.set(id, idx.size);
  });
  const n = idx.size;
  const adj: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
  for (const e of input.edges) {
    const a = idx.get(e.source);
    const b = idx.get(e.target);
    if (a === undefined || b === undefined) continue;
    addEdge(adj, a, b, e.weight ?? 1);
  }
  return { g: finish(adj), idx };
}

function addEdge(adj: Array<Map<number, number>>, a: number, b: number, w: number) {
  adj[a].set(b, (adj[a].get(b) ?? 0) + w);
  if (a !== b) adj[b].set(a, (adj[b].get(a) ?? 0) + w);
}

function finish(adj: Array<Map<number, number>>): WGraph {
  const n = adj.length;
  const deg = new Float64Array(n);
  let m = 0;
  for (let i = 0; i < n; i++)
    for (const [j, w] of adj[i]) {
      deg[i] += i === j ? 2 * w : w;
      if (j > i) m += w;
      else if (j === i) m += w;
    }
  return { n, adj, deg, m };
}

/** Newman's modularity of a partition (community label per node index). */
function q(g: WGraph, comm: ArrayLike<number>): number {
  if (g.m === 0) return 0;
  const inner = new Map<number, number>();
  const tot = new Map<number, number>();
  for (let i = 0; i < g.n; i++) {
    const c = comm[i];
    tot.set(c, (tot.get(c) ?? 0) + g.deg[i]);
    for (const [j, w] of g.adj[i]) if (j >= i && comm[j] === c) inner.set(c, (inner.get(c) ?? 0) + w);
  }
  let out = 0;
  for (const [c, d] of tot) out += (inner.get(c) ?? 0) / g.m - (d / (2 * g.m)) ** 2;
  return out;
}

/** Newman's modularity of a labelled partition of `input` (nodes missing from the map are singletons). */
export function modularity(input: GraphInput, communities: ReadonlyMap<string, number>): number {
  const { g, idx } = fromInput(input);
  const comm = new Int32Array(g.n);
  let next = maxOf(communities.values(), -1) + 1;
  for (const [id, i] of idx) comm[i] = communities.get(id) ?? next++;
  return q(g, comm);
}

/**
 * Queue-based local moving: each queued node goes to the neighbouring
 * community with the best positive gain; a node that moved queues its
 * neighbours outside its new community. Returns whether anything moved.
 */
function localMove(g: WGraph, comm: Int32Array, tot: Float64Array, queue: number[]): boolean {
  const inQ = new Uint8Array(g.n);
  for (const i of queue) inQ[i] = 1;
  let moved = false;
  const m2 = 2 * g.m;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    inQ[i] = 0;
    const ci = comm[i];
    const k = g.deg[i];
    const links = new Map<number, number>();
    for (const [j, w] of g.adj[i]) if (j !== i) links.set(comm[j], (links.get(comm[j]) ?? 0) + w);
    tot[ci] -= k;
    const own = links.get(ci) ?? 0;
    let best = ci;
    let bestGain = 0;
    for (const [c, w] of links) {
      if (c === ci) continue;
      // Gain of moving i from ci to c (both with i taken out), × m.
      const gain = w - own - (k * (tot[c] - tot[ci])) / m2;
      if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && gain > 0 && c < best)) {
        bestGain = gain;
        best = c;
      }
    }
    comm[i] = best;
    tot[best] += k;
    if (best !== ci) {
      moved = true;
      for (const j of g.adj[i].keys())
        if (comm[j] !== best && !inQ[j]) {
          inQ[j] = 1;
          queue.push(j);
        }
    }
  }
  return moved;
}

/** Split every community (or only those in `only`) into its connected parts; new labels from `nextLabel`. */
function splitDisconnected(g: WGraph, comm: Int32Array, only: Set<number> | null, nextLabel: { v: number }): number {
  const seen = new Uint8Array(g.n);
  const firstPart = new Set<number>();
  let splits = 0;
  for (let s = 0; s < g.n; s++) {
    if (seen[s] || (only && !only.has(comm[s]))) continue;
    const c = comm[s];
    const label = firstPart.has(c) ? nextLabel.v++ : c;
    if (label !== c) splits++;
    firstPart.add(c);
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const x = stack.pop()!;
      comm[x] = label;
      for (const y of g.adj[x].keys())
        if (!seen[y] && comm[y] === c) {
          seen[y] = 1;
          stack.push(y);
        }
    }
  }
  return splits;
}

function totals(g: WGraph, comm: Int32Array, size: number): Float64Array {
  const tot = new Float64Array(Math.max(size, g.n));
  for (let i = 0; i < g.n; i++) tot[comm[i]] += g.deg[i];
  return tot;
}

function aggregate(g: WGraph, part: Int32Array): { g: WGraph; size: number } {
  let size = 0;
  for (let i = 0; i < g.n; i++) size = Math.max(size, part[i] + 1);
  const adj: Array<Map<number, number>> = Array.from({ length: size }, () => new Map());
  for (let i = 0; i < g.n; i++)
    for (const [j, w] of g.adj[i]) {
      if (j < i) continue;
      addEdge(adj, part[i], part[j], w);
    }
  return { g: finish(adj), size };
}

function relabel(comm: Int32Array): Int32Array<ArrayBuffer> {
  const map = new Map<number, number>();
  const out = new Int32Array(comm.length);
  comm.forEach((c, i) => {
    if (!map.has(c)) map.set(c, map.size);
    out[i] = map.get(c)!;
  });
  return out;
}

function leidenOn(g0: WGraph, maxLevels = 20): Int32Array<ArrayBuffer> {
  // member[x]: the node of the current level that original node x is in.
  let member = Int32Array.from({ length: g0.n }, (_, i) => i);
  let g = g0;
  let comm = Int32Array.from({ length: g.n }, (_, i) => i);
  for (let level = 0; level < maxLevels; level++) {
    const moved = localMove(g, comm, totals(g, comm, g.n), Array.from({ length: g.n }, (_, i) => i));
    comm = relabel(comm);
    if (!moved) break;
    // Refinement: the connected parts of each community.
    const refined = Int32Array.from(comm);
    splitDisconnected(g, refined, null, { v: maxOf(refined, 0) + 1 });
    const ref = relabel(refined);
    const parts = maxOf(ref, 0) + 1;
    if (parts === g.n) break;
    // Aggregate on the refined partition; each aggregate node starts in its (unrefined) community.
    const parentOf = new Int32Array(parts);
    for (let i = 0; i < g.n; i++) parentOf[ref[i]] = comm[i];
    member = member.map((x) => ref[x]);
    g = aggregate(g, ref).g;
    comm = parentOf;
  }
  // The guarantee on the original graph: a community is never disconnected (splitting one only raises Q).
  const final = member.map((x) => comm[x]);
  splitDisconnected(g0, final, null, { v: maxOf(final, 0) + 1 });
  return relabel(final);
}

function toResult(idx: Map<string, number>, g: WGraph, comm: Int32Array): CommunityResult {
  const communities = new Map<string, number>();
  for (const [id, i] of idx) communities.set(id, comm[i]);
  return { communities, modularity: q(g, comm), numCommunities: new Set(comm).size };
}

/** Static Leiden over a graph; `modularity` in the result is Newman's Q. */
export function leiden(input: GraphInput): CommunityResult {
  const { g, idx } = fromInput(input);
  if (!g.n) return { communities: new Map(), modularity: 0, numCommunities: 0 };
  return toResult(idx, g, leidenOn(g));
}

/** Is every community connected (Leiden's guarantee)? */
export function communitiesConnected(input: GraphInput, communities: ReadonlyMap<string, number>): boolean {
  const { g, idx } = fromInput(input);
  const comm = new Int32Array(g.n);
  for (const [id, i] of idx) comm[i] = communities.get(id) ?? -1 - i;
  const copy = Int32Array.from(comm);
  return splitDisconnected(g, copy, null, { v: maxOf(comm, 0) + 1 }) === 0;
}

export interface EdgeChange {
  source: string;
  target: string;
  weight?: number;
}

/** Communities kept current under edge changes, without a rebuild (HIT-Leiden's three stages). */
export class LiveLeiden {
  private idx = new Map<string, number>();
  private names: string[] = [];
  private adj: Array<Map<number, number>> = [];
  private comm: Int32Array<ArrayBuffer> = new Int32Array(0);
  private g: WGraph;

  constructor(input: GraphInput) {
    const built = fromInput(input);
    this.g = built.g;
    this.idx = built.idx;
    this.names = [...built.idx.keys()];
    this.adj = built.g.adj;
    this.comm = this.g.n ? leidenOn(this.g) : new Int32Array(0);
  }

  private node(id: string): number {
    let i = this.idx.get(id);
    if (i === undefined) {
      i = this.names.length;
      this.idx.set(id, i);
      this.names.push(id);
      this.adj.push(new Map());
      const grown = new Int32Array(this.names.length);
      grown.set(this.comm);
      grown[i] = maxOf(this.comm, -1) + 1;
      this.comm = grown;
    }
    return i;
  }

  /** Apply a batch; returns how many nodes changed community. */
  update(batch: { add?: readonly EdgeChange[]; remove?: readonly EdgeChange[] }): number {
    const before = Int32Array.from(this.comm);
    const touched = new Set<number>();
    const lost = new Set<number>();
    for (const e of batch.remove ?? []) {
      const a = this.idx.get(e.source);
      const b = this.idx.get(e.target);
      if (a === undefined || b === undefined) continue;
      const w = Math.min(e.weight ?? 1, this.adj[a].get(b) ?? 0);
      if (!w) continue;
      const left = (this.adj[a].get(b) ?? 0) - w;
      if (left > 0) {
        this.adj[a].set(b, left);
        if (a !== b) this.adj[b].set(a, left);
      } else {
        this.adj[a].delete(b);
        this.adj[b].delete(a);
      }
      touched.add(a).add(b);
      if (this.comm[a] === this.comm[b]) lost.add(this.comm[a]);
    }
    for (const e of batch.add ?? []) {
      const a = this.node(e.source);
      const b = this.node(e.target);
      addEdge(this.adj, a, b, e.weight ?? 1);
      touched.add(a).add(b);
    }
    this.g = finish(this.adj);
    const comm = this.comm;
    // 1. inc-movement: only the endpoints, then whoever their moves disturb.
    const tot = totals(this.g, comm, Math.max(comm.length, maxOf(comm, -1) + 1));
    for (const i of touched) lost.add(comm[i]);
    localMove(this.g, comm, tot, [...touched]);
    for (let i = 0; i < comm.length; i++) if (comm[i] !== before[i]) lost.add(before[i]);
    // 2. inc-refinement: the communities that lost something are re-split into connected parts.
    splitDisconnected(this.g, comm, lost, { v: maxOf(comm, -1) + 1 });
    // 3. inc-aggregation: a touched community moves whole to a neighbour community when that raises Q.
    const changed = new Set<number>([...touched].map((i) => comm[i]));
    for (const c of changed) this.moveWhole(c);
    let n = 0;
    for (let i = 0; i < comm.length; i++) if (comm[i] !== before[i]) n++;
    return n;
  }

  private moveWhole(c: number) {
    const comm = this.comm;
    const members: number[] = [];
    for (let i = 0; i < comm.length; i++) if (comm[i] === c) members.push(i);
    if (!members.length) return;
    const m2 = 2 * this.g.m;
    let kc = 0;
    const links = new Map<number, number>();
    for (const i of members) {
      kc += this.g.deg[i];
      for (const [j, w] of this.g.adj[i]) if (comm[j] !== c) links.set(comm[j], (links.get(comm[j]) ?? 0) + w);
    }
    const tot = new Map<number, number>();
    for (let i = 0; i < comm.length; i++) tot.set(comm[i], (tot.get(comm[i]) ?? 0) + this.g.deg[i]);
    let best = c;
    let bestGain = 0;
    for (const [d, w] of links) {
      const gain = w - (kc * (tot.get(d) ?? 0)) / m2;
      if (gain > bestGain + 1e-12) {
        bestGain = gain;
        best = d;
      }
    }
    if (best !== c) for (const i of members) comm[i] = best;
  }

  result(): CommunityResult {
    const communities = new Map<string, number>();
    const rel = relabel(this.comm);
    this.names.forEach((id, i) => communities.set(id, rel[i]));
    return { communities, modularity: q(this.g, rel), numCommunities: new Set(rel).size };
  }
}
