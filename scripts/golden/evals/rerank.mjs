/**
 * Harness for plan 7.6: does a reranker improve the retrieval golden set
 * (7.1)? nDCG@10 of BM25 alone against BM25 + a reranker over the same
 * candidates, per part. Plain JavaScript, like retrieval.mjs, so the tests,
 * the real-model eval (src/agents/eval/rerank.eval.ts) and CI share it.
 *
 *   compareRerank(Index, rerankFn, { items, documents, candidates })
 *     → { items, bm25, reranked, gain }      (gain = reranked − bm25, in nDCG points ×100)
 *
 * `rerankFn(query, [{ id, text }])` returns the same objects in its order.
 * The plan's rule: a gain under 5 points → the model reranker is removed or
 * off by default; otherwise it runs only on WebGPU / the desktop app, after
 * the user agrees to its download.
 *
 *   modelDefaultAllowed(receipt) → { ok, why }
 *     The app's default is BM25 only (src/ai/reranker.ts DEFAULT_RERANK_MODE,
 *     W10.B18). The model reranker may become the default only with an eval
 *     receipt (rerank.eval.ts → eval/results/rerank-<date>.json) measured on a
 *     Mac, on eval/golden/retrieval-hard, that beats BM25 by at least
 *     MODEL_DEFAULT_MIN_GAIN_POINTS on both the dev and the held-out split.
 */
import { ndcgAt } from "./retrieval.mjs";

export const MIN_GAIN_POINTS = 5;

/** nDCG@10 points (×100) the model must add over BM25, on each hard split, to become the default. */
export const MODEL_DEFAULT_MIN_GAIN_POINTS = 3;

export function modelDefaultAllowed(receipt) {
  if (!receipt || typeof receipt !== "object") return { ok: false, why: "no eval receipt" };
  if (!/bge-reranker/i.test(String(receipt.model ?? ""))) return { ok: false, why: `the receipt is for ${receipt.model ?? "no model"}, not the bge reranker` };
  if (receipt.machine?.platform !== "darwin") return { ok: false, why: "the receipt was not measured on a Mac" };
  const rows = Array.isArray(receipt.rows) ? receipt.rows : [];
  for (const part of ["dev", "heldout"]) {
    const r = rows.find((x) => String(x.split ?? "").includes("retrieval-hard") && x.part === part);
    if (!r) return { ok: false, why: `no retrieval-hard ${part} row` };
    const gain = round((Number(r.reranked) - Number(r.bm25)) * 100, 2);
    if (!(gain >= MODEL_DEFAULT_MIN_GAIN_POINTS)) return { ok: false, why: `retrieval-hard ${part}: gain ${gain} < ${MODEL_DEFAULT_MIN_GAIN_POINTS} points` };
  }
  return { ok: true, why: "" };
}

export async function compareRerank(Index, rerankFn, { items, documents, candidates = 20, k = 10 }) {
  const index = new Index();
  for (const d of documents) index.set(d.id, d.text ?? "", d.title ?? "");
  const text = new Map(documents.map((d) => [d.id, d.text ?? ""]));
  let base = 0;
  let rr = 0;
  for (const it of items) {
    const skip = new Set(it.sameArticle ?? []);
    const ids = index
      .search(it.query, { limit: candidates + skip.size })
      .map((h) => h.id)
      .filter((id) => !skip.has(id));
    base += ndcgAt(ids, it.relevant, k);
    const ranked = await rerankFn(it.query, ids.map((id) => ({ id, text: text.get(id) ?? "" })));
    rr += ndcgAt(ranked.map((r) => r.id), it.relevant, k);
  }
  const n = items.length || 1;
  const bm25 = base / n;
  const reranked = rr / n;
  return { items: items.length, bm25: round(bm25), reranked: round(reranked), gain: round((reranked - bm25) * 100, 2) };
}

/** The decision the plan asks for, from a measured gain (points). */
export function rerankDecision(gainPoints) {
  return gainPoints >= MIN_GAIN_POINTS ? "keep-webgpu-desktop-with-consent" : "off-by-default";
}

function round(x, d = 4) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
