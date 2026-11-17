/**
 * Harness for plan 7.6: does a reranker improve the retrieval golden set
 * (7.1)? nDCG@10 of BM25 alone against BM25 + a reranker over the same
 * candidates, per part. Plain JavaScript, like retrieval.mjs, so the tests,
 * the real-model eval (src/agents/eval/rerank.eval.ts) and CI share it.
 *
 *   compareRerank(Index, rerankFn, { items, documents, candidates })
 *     → { items, bm25, reranked, gain, perItem: { bm25, reranked } }      (gain = reranked − bm25, in nDCG points ×100)
 *
 * `rerankFn(query, [{ id, text }])` returns the same objects in its order.
 * The plan's rule: a gain under 5 points → the model reranker is removed or
 * off by default; otherwise it runs only on WebGPU / the desktop app, after
 * the user agrees to its download.
 *
 *     The result also carries `p95Ms`: the 95th-percentile time of one
 *     rerankFn call (the top-`candidates` list of one query).
 *
 *   modelDefaultAllowed(receipt) → { ok, why }
 *     The app's default is BM25 only (src/ai/reranker.ts DEFAULT_RERANK_MODE,
 *     W10.B18). The model reranker may become the default only with an eval
 *     receipt (rerank.eval.ts → eval/results/rerank-<date>.json) measured on a
 *     Mac that
 *       - beats BM25 by at least MODEL_DEFAULT_MIN_GAIN_POINTS on both the dev
 *         and the held-out split of eval/synthetic/retrieval-hard, and
 *       - beats BM25 by at least PUBLIC_MIN_GAIN_POINTS on each public set of
 *         PUBLIC_RERANK_SETS (WebFAQ-heb, Belebele heb_Hebr; W10.B18
 *         acceptance, W11.M5), rows `split: "public/<name>"`, and
 *       - reranks the top 20 within RERANK_MAX_P95_MS at p95 on every row.
 *
 *   publicSourceProblem(name, source, sha256Of) → string | null
 *     A fetched public set (scripts/retrieval/fetch.py writes source.json) is
 *     used only when its dataset card's licence is the one the plan accepts
 *     (PUBLIC_RERANK_SETS) and every file still has the sha256 recorded at
 *     fetch time. null when it may be used, else why not.
 *
 *   beirToRerankSet(set) → { items, documents }
 *     A BEIR-form set (retrievalPublic.ts parseBeir) in compareRerank's shape.
 *
 *   rerankCardInput({ dir, part, manifest, model, result }) → makeCard input
 *     The eval card (scripts/lib/evalCard.mjs) of one row. Always `dev`: a
 *     committed split is not a sealed held-out run, and the hard set is
 *     synthetic (eval/synthetic, coordinator W7.13), so its cards carry
 *     dataset.origin "synthetic" and can never back a ✅.
 */
import { ndcgAt } from "./retrieval.mjs";

export const MIN_GAIN_POINTS = 5;

/** nDCG@10 points (×100) the model must add over BM25, on each hard split, to become the default. */
export const MODEL_DEFAULT_MIN_GAIN_POINTS = 3;

/** nDCG@10 points the model must add over BM25 on each public set (W10.B18: ≥ +2). */
export const PUBLIC_MIN_GAIN_POINTS = 2;

/** p95 of one top-20 rerank, ms (W10.B18: ≤ 150 ms). */
export const RERANK_MAX_P95_MS = 150;

/** The public sets the decision needs, with the dataset-card licence each must carry (fetch.py checks it at download). */
export const PUBLIC_RERANK_SETS = Object.freeze({
  "webfaq-heb": { repo: "mteb/WebFAQRetrieval", license: "cc-by-4.0" },
  "belebele-heb": { repo: "facebook/belebele", license: "cc-by-sa-4.0" },
});

export function publicSourceProblem(name, source, sha256Of) {
  const want = PUBLIC_RERANK_SETS[name];
  if (!want) return `${name}: not a public rerank set`;
  if (!source || typeof source !== "object") return `${name}: no source.json`;
  if (!String(source.source ?? "").endsWith(want.repo)) return `${name}: source ${source.source ?? "none"} is not ${want.repo}`;
  const lic = String(source.cardLicense ?? "").toLowerCase();
  if (lic !== want.license) return `${name}: the dataset card says ${lic || "no licence"}, the plan accepts ${want.license}`;
  if (!/^[0-9a-f]{40}$/.test(String(source.revision ?? ""))) return `${name}: no pinned revision`;
  const files = source.sha256 && typeof source.sha256 === "object" ? Object.entries(source.sha256) : [];
  if (!files.length) return `${name}: no sha256 recorded at fetch`;
  for (const [file, sha] of files) {
    const got = sha256Of(file);
    if (got !== sha) return `${name}: ${file} sha256 ${got ?? "missing"} ≠ ${sha} recorded at fetch`;
  }
  return null;
}

export function beirToRerankSet(set) {
  const items = [];
  for (const [qid, query] of set.queries) {
    const rel = set.qrels.get(qid);
    if (!rel || !rel.size) continue;
    items.push({ id: qid, query, relevant: [...rel.keys()] });
  }
  return { items, documents: [...set.corpus].map(([id, text]) => ({ id, text })) };
}

export function modelDefaultAllowed(receipt) {
  if (!receipt || typeof receipt !== "object") return { ok: false, why: "no eval receipt" };
  if (!/bge-reranker/i.test(String(receipt.model ?? ""))) return { ok: false, why: `the receipt is for ${receipt.model ?? "no model"}, not the bge reranker` };
  if (receipt.machine?.platform !== "darwin") return { ok: false, why: "the receipt was not measured on a Mac" };
  const rows = Array.isArray(receipt.rows) ? receipt.rows : [];
  const gainOf = (r) => round((Number(r.reranked) - Number(r.bm25)) * 100, 2);
  for (const part of ["dev", "heldout"]) {
    const r = rows.find((x) => String(x.split ?? "").includes("retrieval-hard") && x.part === part);
    if (!r) return { ok: false, why: `no retrieval-hard ${part} row` };
    const gain = gainOf(r);
    if (!(gain >= MODEL_DEFAULT_MIN_GAIN_POINTS)) return { ok: false, why: `retrieval-hard ${part}: gain ${gain} < ${MODEL_DEFAULT_MIN_GAIN_POINTS} points` };
  }
  for (const name of Object.keys(PUBLIC_RERANK_SETS)) {
    const r = rows.find((x) => x.split === `public/${name}`);
    if (!r) return { ok: false, why: `no public/${name} row (W10.B18: WebFAQ-heb and Belebele)` };
    const gain = gainOf(r);
    if (!(gain >= PUBLIC_MIN_GAIN_POINTS)) return { ok: false, why: `public/${name}: gain ${gain} < ${PUBLIC_MIN_GAIN_POINTS} points` };
  }
  for (const r of rows) {
    const p95 = Number(r.p95Ms);
    if (!Number.isFinite(p95)) return { ok: false, why: `${r.split} ${r.part}: no p95 latency` };
    if (p95 > RERANK_MAX_P95_MS) return { ok: false, why: `${r.split} ${r.part}: top-20 rerank p95 ${p95} ms > ${RERANK_MAX_P95_MS} ms` };
  }
  return { ok: true, why: "" };
}

export async function compareRerank(Index, rerankFn, { items, documents, candidates = 20, k = 10, now = () => performance.now() }) {
  const index = new Index();
  for (const d of documents) index.set(d.id, d.text ?? "", d.title ?? "");
  const text = new Map(documents.map((d) => [d.id, d.text ?? ""]));
  let base = 0;
  let rr = 0;
  const perItem = { bm25: [], reranked: [] };
  const ms = [];
  for (const it of items) {
    const skip = new Set(it.sameArticle ?? []);
    const ids = index
      .search(it.query, { limit: candidates + skip.size })
      .map((h) => h.id)
      .filter((id) => !skip.has(id));
    const b = ndcgAt(ids, it.relevant, k);
    const t0 = now();
    const ranked = await rerankFn(it.query, ids.map((id) => ({ id, text: text.get(id) ?? "" })));
    ms.push(now() - t0);
    const r = ndcgAt(ranked.map((x) => x.id), it.relevant, k);
    perItem.bm25.push(b);
    perItem.reranked.push(r);
    base += b;
    rr += r;
  }
  const n = items.length || 1;
  const bm25 = base / n;
  const reranked = rr / n;
  const sorted = [...ms].sort((a, b) => a - b);
  const p95Ms = sorted.length ? round(sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)], 1) : 0;
  return { items: items.length, bm25: round(bm25), reranked: round(reranked), gain: round((reranked - bm25) * 100, 2), p95Ms, perItem };
}

/** A split folder (or its set) that is synthetic: under eval/synthetic, or its manifest says so (W7.13). */
export const isSyntheticDir = (dir, manifest) => /(^|\/)eval\/synthetic\//.test(`${String(dir).replace(/\\/g, "/")}/`) || manifest?.origin === "synthetic";

/** The makeCard input of one rerank row: tag `dev` always; a synthetic set adds dataset.origin "synthetic". */
export function rerankCardInput({ dir, part, manifest, model, result, seed = 1 }) {
  const synthetic = isSyntheticDir(dir, manifest);
  const set = String(dir).replace(/\\/g, "/").replace(/\/$/, "");
  const dataset = {
    name: synthetic ? `${set.replace(/^.*?eval\/synthetic\//, "synthetic/")}/${part}` : `${set}/${part}`,
    version: String(manifest?.version ?? "unversioned"),
    license: String(manifest?.license ?? "see SOURCES.md"),
    ...(synthetic ? { origin: "synthetic" } : {}),
  };
  return { tag: "dev", model, seed, temperature: 0, dataset, scores: { ndcg_at_10_bm25: result.perItem.bm25, ndcg_at_10_reranked: result.perItem.reranked } };
}

/** The decision the plan asks for, from a measured gain (points). */
export function rerankDecision(gainPoints) {
  return gainPoints >= MIN_GAIN_POINTS ? "keep-webgpu-desktop-with-consent" : "off-by-default";
}

function round(x, d = 4) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
