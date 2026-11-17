/**
 * Harness of the related-real golden set (plan W10.B19), for
 * scripts/golden/run-evals.mjs: Recall@5 of the app's related notes on the
 * CI-built test split. The scoring lives with the pair builder in
 * ./related.mjs; src/__tests__/relatedRealLinks.test.ts scores the dev split.
 */
export { score } from "./related.mjs";
