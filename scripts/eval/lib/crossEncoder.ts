/**
 * The reranker seam of the evals (plan 7.6, W10.B18): one function shape,
 * `(query, docs) → docs in the new order`, that rerank.eval.ts measures. The
 * model is chosen by id (LUMEN_EVAL_RERANK_MODEL; default the app's
 * RERANK_MODEL, bge-reranker-v2-m3), so a candidate cross-encoder is measured
 * by the same harness and the same decision rule as the default one, without
 * editing the eval. Models whose licence the plan excludes
 * (retrievalPublic.ts EXCLUDED_MODELS, e.g. jina-reranker NC) are refused
 * before anything is downloaded.
 *
 * The scoring core is separate from the model loading, so the batching and
 * the ordering are unit-tested without a model (crossEncoderSeam.test.ts).
 */
import { assertAllowed } from "../../../src/agents/eval/retrievalPublic";

export interface RerankDoc {
  id: string;
  text: string;
}

export type RerankFn = (query: string, docs: RerankDoc[]) => Promise<RerankDoc[]>;

/** Scores a batch of (query, passage) pairs; one number per passage, higher is more relevant. */
export type PairScorer = (query: string, passages: string[]) => Promise<number[]>;

export const RERANK_BATCH = 8;
export const RERANK_MAX_PASSAGE_CHARS = 2000;

/** A RerankFn from a pair scorer: passages cut to RERANK_MAX_PASSAGE_CHARS, scored in batches, stable on ties. */
export function rerankWith(score: PairScorer, batch = RERANK_BATCH): RerankFn {
  return async (query, docs) => {
    const scores: number[] = [];
    for (let i = 0; i < docs.length; i += batch) {
      const chunk = docs.slice(i, i + batch).map((d) => d.text.slice(0, RERANK_MAX_PASSAGE_CHARS));
      const got = await score(query, chunk);
      if (got.length !== chunk.length) throw new Error(`reranker returned ${got.length} scores for ${chunk.length} passages`);
      scores.push(...got);
    }
    return docs
      .map((d, i) => ({ d, s: Number.isFinite(scores[i]) ? scores[i] : -Infinity, i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.d);
  };
}

/** The model id the eval measures: LUMEN_EVAL_RERANK_MODEL, else the app's default; an excluded model throws. */
export function rerankModelId(env: Record<string, string | undefined>, fallback: string): string {
  const id = env.LUMEN_EVAL_RERANK_MODEL?.trim() || fallback;
  assertAllowed(id);
  return id;
}

/** A transformers.js cross-encoder (sequence classification, sigmoid of the first logit), q8 by default. */
export async function transformersCrossEncoder(modelId: string, dtype = "q8"): Promise<PairScorer> {
  assertAllowed(modelId);
  const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@huggingface/transformers");
  const tokenizer = await AutoTokenizer.from_pretrained(modelId);
  const model = await AutoModelForSequenceClassification.from_pretrained(modelId, { dtype } as never);
  return async (query, passages) => {
    const inputs = tokenizer(new Array(passages.length).fill(query), { text_pair: passages, padding: true, truncation: true, max_length: 512 } as never);
    const { logits } = (await model(inputs)) as { logits: { sigmoid(): { tolist(): number[][] } } };
    return logits.sigmoid().tolist().map((row) => row[0] ?? 0);
  };
}
