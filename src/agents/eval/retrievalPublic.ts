/**
 * Plan W11.I13 — retrieval measured on public sets instead of the saturated
 * HeQ dev (1.0 against 1.0), research R4.9.
 *
 * Loaders for the formats the sets are published in:
 *   - BEIR / MTEB retrieval (corpus.jsonl `{_id, title, text}`, queries.jsonl
 *     `{_id, text}`, qrels TSV `query-id corpus-id score`): BEIR SciFact,
 *     NFCorpus and FiQA, and MTEB WebFAQRetrieval `heb` (CC-BY-4.0).
 *   - Belebele rows (`flores_passage`, `question`, `link`, `question_number`):
 *     each question retrieves its own passage, in `heb_Hebr`, and he→en with
 *     Hebrew questions over the English passages of the same items.
 *   - MAFAT HSRC needs a registration (owner item W11.O4): no loader until
 *     its files and terms are in hand.
 *
 * Metrics per query, nDCG@10 and Recall@100, with a bootstrap 95% interval
 * (W11.I18 cards), p95 query latency and the index size. Competitors are
 * `Retriever`s: Lumen's BM25 here; embedding models and rerankers plug in
 * on the Mac (W11.M5). RRF fuses any of them.
 */
import { bm25Search, buildBM25Index } from "../../ai/neuralSearch";
import { compareCodePoints } from "../../i18n/collate";

export interface RetrievalSet {
  name: string;
  corpus: Map<string, string>;
  queries: Map<string, string>;
  /** query id → (doc id → graded relevance > 0). */
  qrels: Map<string, Map<string, number>>;
}

const jsonl = <T>(text: string): T[] =>
  text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

/** BEIR / MTEB retrieval files. Queries without a positive judgment are dropped, as BEIR's evaluator does. */
export function parseBeir(name: string, files: { corpus: string; queries: string; qrels: string }): RetrievalSet {
  const corpus = new Map<string, string>();
  for (const d of jsonl<{ _id: string | number; title?: string; text?: string }>(files.corpus)) corpus.set(String(d._id), [d.title, d.text].filter(Boolean).join("\n"));
  const allQueries = new Map<string, string>();
  for (const q of jsonl<{ _id: string | number; text: string }>(files.queries)) allQueries.set(String(q._id), q.text);
  const qrels = new Map<string, Map<string, number>>();
  for (const line of files.qrels.split("\n")) {
    const cols = line.trim().split(/\t/);
    if (cols.length < 3 || cols[0] === "query-id") continue;
    const [qid, did, score] = [cols[0], cols[1], Number(cols[cols.length - 1])];
    if (!(score > 0) || !corpus.has(did)) continue;
    if (!qrels.has(qid)) qrels.set(qid, new Map());
    qrels.get(qid)!.set(did, score);
  }
  const queries = new Map([...allQueries].filter(([id]) => qrels.has(id)));
  return { name, corpus, queries, qrels };
}

export interface BelebeleRow {
  link: string;
  question_number: number | string;
  flores_passage: string;
  question: string;
}

/** Belebele as retrieval: the question finds its passage. `docs` defaults to the questions' own language (he→en: the English rows). */
export function belebeleRetrieval(name: string, questions: BelebeleRow[], docs: BelebeleRow[] = questions): RetrievalSet {
  const corpus = new Map<string, string>();
  const byLink = new Map<string, string>();
  for (const r of docs) {
    if (!byLink.has(r.link)) {
      const id = `p${byLink.size}`;
      byLink.set(r.link, id);
      corpus.set(id, r.flores_passage);
    }
  }
  const queries = new Map<string, string>();
  const qrels = new Map<string, Map<string, number>>();
  for (const r of questions) {
    const doc = byLink.get(r.link);
    if (!doc) continue;
    const qid = `${r.link}#${r.question_number}`;
    queries.set(qid, r.question);
    qrels.set(qid, new Map([[doc, 1]]));
  }
  return { name, corpus, queries, qrels };
}

// ───────────────────────────── metrics ─────────────────────────────

/** nDCG@k with graded gains (2^rel − 1), the BEIR / pytrec_eval definition. */
export function ndcgAt(ranked: readonly string[], rel: Map<string, number>, k = 10): number {
  const gain = (r: number) => 2 ** r - 1;
  let dcg = 0;
  ranked.slice(0, k).forEach((id, i) => (dcg += gain(rel.get(id) ?? 0) / Math.log2(i + 2)));
  const ideal = [...rel.values()].sort((a, b) => b - a).slice(0, k);
  let idcg = 0;
  ideal.forEach((r, i) => (idcg += gain(r) / Math.log2(i + 2)));
  return idcg ? dcg / idcg : 0;
}

export function recallAt(ranked: readonly string[], rel: Map<string, number>, k = 100): number {
  if (!rel.size) return 0;
  const top = new Set(ranked.slice(0, k));
  let hit = 0;
  for (const id of rel.keys()) if (top.has(id)) hit++;
  return hit / rel.size;
}

export const p95 = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};

// ───────────────────────────── retrievers ─────────────────────────────

export interface Retriever {
  id: string;
  /** Builds the index; returns its size in bytes (as stored), for the report. */
  index(corpus: Map<string, string>): Promise<number>;
  search(query: string, k: number): Promise<string[]>;
}

/** Models the plan names that may not be used (licence). */
export const EXCLUDED_MODELS: Readonly<Record<string, string>> = { "jinaai/jina-reranker-v3": "CC-BY-NC-4.0 (non-commercial)" };
export function assertAllowed(model: string): void {
  const why = EXCLUDED_MODELS[model];
  if (why) throw new Error(`${model} is excluded: ${why}`);
}

/** Lumen's own BM25+ (neuralSearch.ts), on the whole document. */
export function bm25Retriever(): Retriever {
  let idx: ReturnType<typeof buildBM25Index> | null = null;
  return {
    id: "bm25",
    async index(corpus) {
      idx = buildBM25Index([...corpus].map(([path, content]) => ({ path, content })));
      let bytes = 0;
      for (const d of idx.docs) for (const t of d.tokens) bytes += t.length + 1;
      for (const [t] of idx.df) bytes += t.length + 4;
      return bytes;
    },
    async search(q, k) {
      if (!idx) throw new Error("bm25: index first");
      return bm25Search(q, idx, k).map((h) => h.path);
    },
  };
}

/** Reciprocal-rank fusion (Cormack et al., k = 60). */
export function rrf(lists: readonly (readonly string[])[], k = 60, top = 100): string[] {
  const score = new Map<string, number>();
  for (const l of lists) l.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score].sort((a, b) => b[1] - a[1] || compareCodePoints(a[0], b[0])).slice(0, top).map(([id]) => id);
}

/** RRF of several retrievers as one retriever (each retrieves 100). */
export function rrfRetriever(parts: Retriever[]): Retriever {
  return {
    id: `rrf(${parts.map((p) => p.id).join("+")})`,
    async index(corpus) {
      let n = 0;
      for (const p of parts) n += await p.index(corpus);
      return n;
    },
    async search(q, k) {
      return rrf(await Promise.all(parts.map((p) => p.search(q, 100))), 60, k);
    },
  };
}

// ───────────────────────────── run ─────────────────────────────

export interface RetrievalRun {
  set: string;
  retriever: string;
  n: number;
  /** Per query, in query order: the inputs of a bootstrap interval. */
  ndcg10: number[];
  recall100: number[];
  p95Ms: number;
  indexBytes: number;
}

export async function runRetrieval(set: RetrievalSet, r: Retriever, now: () => number = () => performance.now()): Promise<RetrievalRun> {
  const indexBytes = await r.index(set.corpus);
  const ndcg10: number[] = [];
  const recall100: number[] = [];
  const ms: number[] = [];
  for (const [qid, text] of set.queries) {
    const t0 = now();
    const ranked = await r.search(text, 100);
    ms.push(now() - t0);
    const rel = set.qrels.get(qid)!;
    ndcg10.push(ndcgAt(ranked, rel, 10));
    recall100.push(recallAt(ranked, rel, 100));
  }
  return { set: set.name, retriever: r.id, n: ndcg10.length, ndcg10, recall100, p95Ms: p95(ms), indexBytes };
}

/**
 * The plan's decision rules, on two runs' intervals (W7.13 / R4.9): switch the
 * default only at ≥ +3 nDCG points on WebFAQ-heb with intervals that do not
 * overlap; a reranker only at ≥ +2 nDCG points and ≤ 150 ms p95 for top-20.
 */
export function beatsDefault(base: { value: number; ci95: [number, number] }, cand: { value: number; ci95: [number, number] }, minGain = 0.03): boolean {
  return cand.value - base.value >= minGain - 1e-9 && cand.ci95[0] > base.ci95[1];
}
export const rerankerAllowed = (gainNdcg: number, p95Ms: number) => gainNdcg >= 0.02 - 1e-9 && p95Ms <= 150;

/** The public sets this task covers, with where they are published (pinned revisions are W11.M5's fetch). */
export const PUBLIC_SETS = Object.freeze([
  { name: "webfaq-heb", source: "https://huggingface.co/datasets/mteb/WebFAQRetrieval", subset: "heb", license: "CC-BY-4.0", format: "beir" },
  { name: "belebele-heb", source: "https://huggingface.co/datasets/facebook/belebele", subset: "heb_Hebr", license: "per the dataset card (checked at pinning, W11.M5)", format: "belebele" },
  { name: "belebele-he-en", source: "https://huggingface.co/datasets/facebook/belebele", subset: "heb_Hebr→eng_Latn", license: "per the dataset card (checked at pinning, W11.M5)", format: "belebele" },
  { name: "beir-scifact", source: "https://huggingface.co/datasets/BeIR/scifact", license: "per BEIR's dataset card; checked when W11.M5 pins the revision", format: "beir" },
  { name: "beir-nfcorpus", source: "https://huggingface.co/datasets/BeIR/nfcorpus", license: "per BEIR's dataset card; checked when W11.M5 pins the revision", format: "beir" },
  { name: "beir-fiqa", source: "https://huggingface.co/datasets/BeIR/fiqa", license: "per BEIR's dataset card; checked when W11.M5 pins the revision", format: "beir" },
  { name: "mafat-hsrc", source: "MAFAT HSRC, after registration (owner item W11.O4)", license: "the terms that come with the registration", format: "owed" },
] as const);
