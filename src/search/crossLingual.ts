/**
 * Cross-language search (plan W5.28): ask in Hebrew, find English sources.
 * Smart search already fuses BM25 (with W2.11's Hebrew→English lexicon)
 * and local embeddings; this decides when a search is cross-lingual, which
 * embedding models can bridge the two languages, and marks the hits whose
 * text is in another language so the dialog can show a local translation
 * next to the original (./passageTranslator.ts).
 *
 * Only embedding models that map Hebrew and English into one space are
 * used for it: an English-only model (nomic-embed-text) would put a Hebrew
 * question nowhere near an English paragraph.
 *
 * Status (W10.B6, coordinator decision): keyword search alone does not
 * cross languages — a Hebrew query finds 0 of 30 English notes on the
 * held-out probe (eval/probes/crosslingual-heldout-he-en.json). Cross-lingual
 * search needs a multilingual embedding model (bge-m3 or EmbeddingGemma,
 * through Ollama), and `crossLingualPath` says whether a Hebrew query takes
 * the embedding path here, or why not. The UI and the docs say so instead
 * of claiming the feature works without the model.
 */

export type Script = "he" | "en" | "other";

/** The dominant script of a text: Hebrew letters vs Latin letters. */
export function scriptOf(text: string): Script {
  let he = 0;
  let la = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x05d0 && c <= 0x05ea) he++;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) la++;
  }
  if (!he && !la) return "other";
  return he >= la ? "he" : "en";
}

/**
 * Embedding providers (EmbeddingProvider.id) whose vectors are multilingual,
 * Hebrew included. multilingual-e5 is MIT, allowed in models/registry.json.
 */
const MULTILINGUAL = [/multilingual-e5/i, /bge-m3/i, /embeddinggemma/i, /paraphrase-multilingual/i, /LaBSE/i];

/** The multilingual models the status line names (Ollama tags). */
export const CROSS_LINGUAL_MODELS = ["bge-m3", "embeddinggemma"] as const;

export type CrossLingualPath =
  /** The query is not Hebrew→English, or there is nothing to decide. */
  | { path: "same-language" }
  /** A multilingual model is in use and the index was built with it: the embedding path answers. */
  | { path: "embedding"; model: string }
  /** No multilingual model: keyword search only, which does not reach English notes. */
  | { path: "keyword-only"; reason: "needs-model" }
  /** A multilingual model is in use, but the index was built with another one (or not at all). */
  | { path: "keyword-only"; reason: "reindex"; model: string };

/**
 * Which path a query takes across languages. `embedding` is the provider
 * smart search uses (`embeddingStatus`), `indexEmbedding` the provider the
 * stored index was built with (`semanticIndexEmbedding`): vectors of two
 * models are not comparable, so a mismatch means the embeddings answer nothing.
 */
export function crossLingualPath(query: string, embedding: { id: string; multilingual: boolean } | null, indexEmbedding: string | null): CrossLingualPath {
  if (scriptOf(query) !== "he") return { path: "same-language" };
  if (!embedding?.multilingual) return { path: "keyword-only", reason: "needs-model" };
  if (indexEmbedding !== embedding.id) return { path: "keyword-only", reason: "reindex", model: embedding.id };
  return { path: "embedding", model: embedding.id };
}

export function isMultilingualEmbedding(providerId: string): boolean {
  return MULTILINGUAL.some((re) => re.test(providerId));
}

export interface CrossLingualMark {
  /** The hit's language differs from the query's: show the translation. */
  crossLingual: boolean;
  lang: Script;
}

/** Mark the hits written in another language than the query. */
export function markCrossLingual<T extends { snippet: string }>(query: string, hits: T[]): Array<T & CrossLingualMark> {
  const q = scriptOf(query);
  return hits.map((h) => {
    const lang = scriptOf(h.snippet);
    return { ...h, lang, crossLingual: q !== "other" && lang !== "other" && lang !== q };
  });
}

/**
 * Rank documents by cosine similarity to a query vector. Vectors should be
 * L2-normalised (e5's are); `norms` is computed once per document set, so a
 * query over 10,000 notes is one pass of dot products.
 */
export function rankByCosine(query: Float32Array, docs: ReadonlyArray<{ id: string; vector: Float32Array }>, k = 10, skip: ReadonlySet<string> = new Set()): Array<{ id: string; score: number }> {
  let qn = 0;
  for (let i = 0; i < query.length; i++) qn += query[i] * query[i];
  qn = Math.sqrt(qn) || 1;
  const top: Array<{ id: string; score: number }> = [];
  for (const d of docs) {
    if (skip.has(d.id)) continue;
    const v = d.vector;
    let dot = 0;
    let n = 0;
    for (let i = 0; i < v.length; i++) {
      dot += query[i] * v[i];
      n += v[i] * v[i];
    }
    const score = dot / (qn * (Math.sqrt(n) || 1));
    if (top.length < k || score > top[top.length - 1].score) {
      top.push({ id: d.id, score });
      top.sort((a, b) => b.score - a.score);
      if (top.length > k) top.pop();
    }
  }
  return top;
}

/** Reciprocal-rank fusion of several rankings (ids), with per-list weights. */
export function fuse(rankings: ReadonlyArray<{ ids: string[]; weight?: number }>, k = 10, rrfK = 60): string[] {
  const score = new Map<string, number>();
  for (const { ids, weight = 1 } of rankings) ids.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + weight / (rrfK + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k).map(([id]) => id);
}
