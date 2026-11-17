/**
 * Clusters and structural gaps (plan W13.G8, after InfraNodus's
 * "structural gaps"): what the graph's communities are about, and which of
 * them should know about each other but do not.
 *
 * - Clusters: Leiden communities (R12.8, ../views/leiden.ts) of at least
 *   `minSize` nodes, with modularity (Newman's Q) for the whole partition.
 * - A label per cluster: its three terms of highest TF-IDF, a cluster being
 *   one document (all its notes' text) among the clusters. Hebrew-aware
 *   tokens: NFC, niqqud and cantillation dropped, geresh/gershayim kept
 *   inside a word (צה״ל), a one-letter prefix (ו ה ב ל מ ש כ) folded when
 *   the bare word also occurs, stop words of Hebrew and English dropped.
 * - Gaps: pairs of clusters whose content is close (cosine of their TF-IDF
 *   vectors — a lexical embedding; a local embedding model can be passed
 *   instead) and whose links are far fewer than the modularity null model
 *   expects. Each gap names one bridge: the note on each side that shares
 *   the most of the pair's common terms — a link the link agent can propose.
 * - Hulls: the convex hull of each cluster's laid-out positions.
 *
 * Pure: nothing is written; the caller stages a proposal per gap for the
 * user's approval (./clusterGapsStage.ts).
 */
import { leiden } from "../views/leiden";

export { convexHull } from "./hull";

export interface GapNode {
  id: string;
  label: string;
  /** The note's text (or what stands for it: title, tags, properties). */
  text: string;
}

export interface GapInput {
  nodes: readonly GapNode[];
  edges: ReadonlyArray<{ source: string; target: string }>;
}

export interface Cluster {
  /** 0.. in size order (biggest first). */
  index: number;
  members: string[];
  /** The top terms (TF-IDF), most first. */
  terms: string[];
}

export interface Gap {
  a: number;
  b: number;
  /** Cosine of the two clusters' term vectors, 0..1. */
  similarity: number;
  /** Links between them, and how many the null model expects. */
  links: number;
  expected: number;
  /** similarity × (1 − links / expected), clamped to 0..1. */
  score: number;
  /** Terms both clusters share, strongest first. */
  shared: string[];
  /** The proposed link: from a note in `a` to a note in `b`. */
  from: string;
  to: string;
}

export interface ClusterAnalysis {
  modularity: number;
  /** All Leiden communities, small ones included. */
  communities: number;
  clusters: Cluster[];
  /** Node id → cluster index (−1: in a community smaller than minSize). */
  clusterOf: Map<string, number>;
  gaps: Gap[];
}

const STOP = new Set(
  (
    "של את על עם זה זו זאת הוא היא הם הן אני אתה את אנחנו לא כן גם או אם כי אבל רק כל יש אין היה היו הייתה יהיה מה מי איך למה כמו עוד כבר אז שם פה כאן בין אחרי לפני תחת מול אצל אל עד מן מאוד יותר פחות אחד אחת שני שתי כך כאשר אשר לכן ולא וגם " +
    "the a an and or of to in on at for with by from is are was were be been this that these those it its as not no but if then than so do does did have has had will would can could should may might into about over under after before between also just only very more most other some such their there they them we you he she his her our your my me"
  ).split(" "),
);
const PREFIX = /^[והבלמשכ]/;

/** Words of `text`, normalised (no niqqud, lower case), stop words out; prefixes folded later. */
export function words(text: string): string[] {
  const clean = text
    .normalize("NFC")
    .replace(/[֑-ׇ]/g, "")
    .replace(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g, " $1 ")
    .toLowerCase();
  const out: string[] = [];
  for (const m of clean.matchAll(/[\p{L}\p{N}]+(?:[״"׳'][\p{L}]+)*/gu)) {
    const w = m[0].replace(/"/g, "״").replace(/'/g, "׳");
    if (w.length < 2 || /^\d+$/.test(w) || STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}

const cosine = (a: Map<string, number>, b: Map<string, number>) => {
  let dot = 0;
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
  return dot;
};

export interface AnalyzeOptions {
  minSize?: number;
  /** Clusters kept (the biggest); the rest count as unclustered. */
  maxClusters?: number;
  terms?: number;
  gaps?: number;
  /** Optional: a vector per cluster text (a local embedding model). Default: the TF-IDF vectors. */
  vectors?: (clusterTexts: string[]) => number[][];
}

export function analyzeClusters(input: GapInput, opts: AnalyzeOptions = {}): ClusterAnalysis {
  const minSize = opts.minSize ?? 3;
  const maxClusters = opts.maxClusters ?? 40;
  const nTerms = opts.terms ?? 3;
  const nGaps = opts.gaps ?? 10;
  const ids = input.nodes.map((n) => n.id);
  const known = new Set(ids);
  const edges = input.edges.filter((e) => e.source !== e.target && known.has(e.source) && known.has(e.target));
  const r = leiden({ nodes: ids, edges: edges.map((e) => ({ source: e.source, target: e.target })) });
  // Communities by size; keep those of minSize or more, the biggest maxClusters.
  const members = new Map<number, string[]>();
  for (const id of ids) {
    const c = r.communities.get(id)!;
    (members.get(c) ?? members.set(c, []).get(c)!).push(id);
  }
  const kept = [...members.values()].filter((m) => m.length >= minSize).sort((a, b) => b.length - a.length || a[0].localeCompare(b[0])).slice(0, maxClusters);
  const clusterOf = new Map<string, number>(ids.map((id) => [id, -1]));
  kept.forEach((m, i) => m.forEach((id) => clusterOf.set(id, i)));

  // Tokens per node; a prefix is folded when the bare word occurs anywhere.
  const raw = new Map(input.nodes.map((n) => [n.id, words(`${n.label} ${n.text}`)]));
  const vocab = new Set<string>();
  for (const ws of raw.values()) for (const w of ws) vocab.add(w);
  const fold = (w: string) => (w.length >= 4 && PREFIX.test(w) && vocab.has(w.slice(1)) ? w.slice(1) : w);
  const tokens = new Map([...raw].map(([id, ws]) => [id, ws.map(fold)]));

  // TF-IDF with each cluster as a document.
  const tf = kept.map((m) => {
    const c = new Map<string, number>();
    let total = 0;
    for (const id of m) for (const w of tokens.get(id)!) (c.set(w, (c.get(w) ?? 0) + 1), total++);
    for (const [k, v] of c) c.set(k, v / Math.max(1, total));
    return c;
  });
  const df = new Map<string, number>();
  for (const c of tf) for (const k of c.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const idf = (k: string) => Math.log((tf.length + 1) / ((df.get(k) ?? 0) + 0.5));
  const vec = tf.map((c) => {
    const v = new Map<string, number>();
    for (const [k, x] of c) if (x > 0) v.set(k, x * idf(k));
    const top = [...v].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 80);
    const norm = Math.sqrt(top.reduce((s, [, x]) => s + x * x, 0)) || 1;
    return new Map(top.map(([k, x]) => [k, x / norm]));
  });
  const clusters: Cluster[] = kept.map((m, i) => ({ index: i, members: m, terms: [...vec[i]].slice(0, nTerms).map(([k]) => k) }));

  // Cluster content vectors for similarity: TF-IDF by default, or the caller's embeddings.
  let sim: (i: number, j: number) => number = (i, j) => cosine(vec[i], vec[j]);
  if (opts.vectors && kept.length) {
    const labelOf = new Map(input.nodes.map((n) => [n.id, n.label]));
    const emb = opts.vectors(kept.map((m) => m.map((id) => `${labelOf.get(id) ?? ""} ${(tokens.get(id) ?? []).join(" ")}`).join("\n")));
    const unit = emb.map((v) => {
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / n);
    });
    sim = (i, j) => unit[i].reduce((s, x, k) => s + x * (unit[j][k] ?? 0), 0);
  }

  // Links between clusters, against the null model: expected = d_a · d_b / 2m.
  const deg = new Float64Array(kept.length);
  const between = new Map<string, number>();
  for (const e of edges) {
    const a = clusterOf.get(e.source)!, b = clusterOf.get(e.target)!;
    if (a >= 0) deg[a]++;
    if (b >= 0) deg[b]++;
    if (a >= 0 && b >= 0 && a !== b) {
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      between.set(k, (between.get(k) ?? 0) + 1);
    }
  }
  const m2 = Math.max(1, 2 * edges.length);
  const gaps: Gap[] = [];
  for (let i = 0; i < kept.length; i++)
    for (let j = i + 1; j < kept.length; j++) {
      const s = Math.max(0, sim(i, j));
      if (s <= 0.02) continue;
      const links = between.get(`${i}:${j}`) ?? 0;
      const expected = Math.max(1e-9, (deg[i] * deg[j]) / m2);
      if (links >= expected * 0.5) continue;
      const score = Math.max(0, Math.min(1, s * (1 - links / expected)));
      const shared = [...vec[i].keys()].filter((k) => vec[j].has(k)).sort((x, y) => vec[i].get(y)! * vec[j].get(y)! - vec[i].get(x)! * vec[j].get(x)! || x.localeCompare(y)).slice(0, 5);
      gaps.push({ a: i, b: j, similarity: s, links, expected, score, shared, from: "", to: "" });
    }
  gaps.sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b);
  const top = gaps.slice(0, nGaps);
  // The bridge: in each cluster, the note with the most of the shared terms (ties: the most linked, then by id).
  const degree = new Map<string, number>();
  for (const e of edges) (degree.set(e.source, (degree.get(e.source) ?? 0) + 1), degree.set(e.target, (degree.get(e.target) ?? 0) + 1));
  const best = (c: number, shared: string[]) => {
    let pick = kept[c][0], score = -1;
    for (const id of kept[c]) {
      const set = new Set(tokens.get(id));
      const s = shared.reduce((n, w, k) => n + (set.has(w) ? shared.length - k : 0), 0) * 1000 + (degree.get(id) ?? 0);
      if (s > score || (s === score && id < pick)) (pick = id), (score = s);
    }
    return pick;
  };
  for (const g of top) (g.from = best(g.a, g.shared)), (g.to = best(g.b, g.shared));
  return { modularity: r.modularity, communities: r.numCommunities, clusters, clusterOf, gaps: top };
}
