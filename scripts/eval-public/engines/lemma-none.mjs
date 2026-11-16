/**
 * The lemmatizer A/B's "none" side alone (plan W11.H12): today's search,
 * BM25 over words with the rule-based Hebrew morphology, no lemmatizer model.
 * The baseline every candidate must not fall below (W11.M3):
 *
 *   npm run eval:public -- run retrieval-heq --engine scripts/eval-public/engines/lemma-none.mjs --model none --rev <lumen commit>
 */
export default async () => ({ id: "none", lemmatizers: [] });
