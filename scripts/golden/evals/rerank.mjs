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
 *   modelDefaultAllowed(receipt) → { ok, why }
 *     The app's default is BM25 only (src/ai/reranker.ts DEFAULT_RERANK_MODE,
 *     W10.B18). The model reranker may become the default only with an eval
 *     receipt (rerank.eval.ts → eval/results/rerank-<date>.json) measured on a
 *     Mac, on eval/synthetic/retrieval-hard, that beats BM25 by at least
 *     MODEL_DEFAULT_MIN_GAIN_POINTS on both the dev and the held-out split.
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
  const perItem = { bm25: [], reranked: [] };
  for (const it of items) {
    const skip = new Set(it.sameArticle ?? []);
    const ids = index
      .search(it.query, { limit: candidates + skip.size })
      .map((h) => h.id)
      .filter((id) => !skip.has(id));
    const b = ndcgAt(ids, it.relevant, k);
    const ranked = await rerankFn(it.query, ids.map((id) => ({ id, text: text.get(id) ?? "" })));
    const r = ndcgAt(ranked.map((x) => x.id), it.relevant, k);
    perItem.bm25.push(b);
    perItem.reranked.push(r);
    base += b;
    rr += r;
  }
  const n = items.length || 1;
  const bm25 = base / n;
  const reranked = rr / n;
  return { items: items.length, bm25: round(bm25), reranked: round(reranked), gain: round((reranked - bm25) * 100, 2), perItem };
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
