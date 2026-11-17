/**
 * Reranking search hits (T29).
 *
 * Retrieval (BM25 + embeddings, see ./semanticSearch) is good at recall and
 * loose at order. A reranker reads the query and each candidate together
 * and scores how well the candidate answers it.
 *
 *  - "model": the multilingual cross-encoder bge-reranker-v2-m3 (Hebrew
 *    included) on this device via transformers.js — a one-time download
 *    (~570 MB q8), opt-in.
 *  - "lexical" (opt-in): a Hebrew-aware term-coverage score — every query
 *    word (niqqud stripped, prefixes ו/ה/ב/ל/מ/ש/כ tolerated) found in the
 *    passage — blended with the retrieval rank. No download, instant.
 *  - "off" (the default): no reranking; the retrieval order (BM25, fused
 *    with embeddings where they run) is kept.
 *
 * Why "off" is the default (coordinator decision, W10.B18): on the hard
 * retrieval set (eval/synthetic/retrieval-hard, a synthetic set: dev numbers) BM25 alone scores nDCG@10
 * 0.950 (dev) / 0.952 (held-out), and the lexical reranker lowers that to
 * 0.918 / 0.907. src/__tests__/rerankHard.test.ts re-measures both and pins
 * the default to the winner. The model may become the default only with a
 * Mac receipt that beats BM25 by ≥ 3 points on both splits, by ≥ 2 points on
 * WebFAQ-heb and on Belebele (fetched with a checked licence), and reranks
 * the top 20 within 150 ms at p95 (scripts/golden/evals/rerank.mjs
 * `modelDefaultAllowed`, W10.B18).
 */
import { normalizeForMatch, prefixVariants, words } from "../text/hebrew";

export type RerankMode = "off" | "model" | "lexical";
const MODE_KEY = "lumen.ai.rerank";

/** BM25 only: the measured winner on the hard set (see the header). */
export const DEFAULT_RERANK_MODE: RerankMode = "off";

/** The measurement the default rests on; rerankHard.test.ts re-measures it on every run. */
export const RERANK_DEFAULT_EVIDENCE = {
  set: "eval/synthetic/retrieval-hard",
  metric: "nDCG@10",
  bm25: { dev: 0.95, heldout: 0.9521 },
  lexical: { dev: 0.9184, heldout: 0.9072 },
  /** Not measured yet: needs the model (Mac, `npm run eval:rerank`). */
  model: null,
} as const;

export function getRerankMode(): RerankMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "model" || v === "lexical" ? v : DEFAULT_RERANK_MODE;
  } catch {
    return DEFAULT_RERANK_MODE;
  }
}

export function setRerankMode(mode: RerankMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* why: storage denied */
  }
}

/**
 * Plan 7.6: the model reranker is offered only where it is fast enough —
 * a browser with WebGPU, or the desktop app — and after the user agreed to
 * its download. It is not the default: HeQ dev is saturated (BM25 nDCG@10
 * 1.0), and on the hard set (eval/synthetic/retrieval-hard) the model has not
 * been measured yet (`npm run eval:rerank`, Mac). There the built-in lexical
 * reranker scores below BM25 alone (dev 0.918 vs 0.948, held-out 0.907 vs
 * 0.952; src/__tests__/rerankHard.test.ts), so the default is "off".
 */
export function modelRerankSupported(): boolean {
  if (typeof window === "undefined") return false;
  const desktop = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  return desktop || (typeof navigator !== "undefined" && "gpu" in navigator && !!(navigator as Navigator & { gpu?: unknown }).gpu);
}

/** Size of the model's one-time download (q8), shown in the consent. */
export const RERANK_MODEL_MB = 571;

/** Share of the query's words present in `text` (0..1), Hebrew-aware. */
export function lexicalScore(query: string, text: string): number {
  const q = [...new Set(words(normalizeForMatch(query)).filter((w) => w.length > 1))];
  if (!q.length) return 0;
  const bag = new Set<string>();
  for (const w of words(normalizeForMatch(text))) for (const v of prefixVariants(w)) bag.add(v);
  let hit = 0;
  for (const w of q) if (prefixVariants(w).some((v) => bag.has(v))) hit++;
  return hit / q.length;
}

export interface Rankable {
  text: string;
}

/**
 * Reorder `items` by relevance to `query`. "off" keeps the retrieval order.
 * The model path falls back to the retrieval order (the measured winner),
 * not to the lexical score, on any failure (no WebGPU/wasm, download
 * refused, offline).
 */
export async function rerank<T extends Rankable>(
  query: string,
  items: T[],
  opts: { mode?: RerankMode; signal?: AbortSignal } = {},
): Promise<Array<T & { rerankScore: number }>> {
  if (items.length < 2) return items.map((it) => ({ ...it, rerankScore: 1 }));
  const mode = opts.mode ?? getRerankMode();
  const keep = () => items.map((it, i) => ({ ...it, rerankScore: 1 / (1 + i) }));
  if (mode === "off") return keep();
  let scores: number[] | null = null;
  if (mode === "model") {
    try {
      const { rerankLocal } = await import("./transformersEngine");
      scores = await rerankLocal(query, items.map((i) => i.text.slice(0, 2000)), { signal: opts.signal });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      return keep();
    }
    if (!scores) return keep();
  }
  if (!scores) {
    // Blend: term coverage decides, retrieval order breaks ties.
    scores = items.map((it, i) => lexicalScore(query, it.text) + 0.15 / (1 + i));
  }
  return items
    .map((it, i) => ({ ...it, rerankScore: scores![i] ?? 0, _i: i }))
    .sort((a, b) => b.rerankScore - a.rerankScore || a._i - b._i)
    .map(({ _i, ...rest }) => rest as unknown as T & { rerankScore: number });
}
