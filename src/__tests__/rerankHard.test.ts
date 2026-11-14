/**
 * Plan W10.B18 (audit 7.6): the reranker decision was taken on HeQ dev,
 * where BM25 alone already scores nDCG@10 1.0, so no reranker can show a
 * gain there (1.0 vs 1.0). Here the same comparison runs on the hard set
 * (eval/golden/retrieval-hard, plan W7.13: real HeQ test questions with
 * spelling, paraphrase and other changes, over 238 real HeQ paragraphs),
 * where BM25 is below 1.0.
 *
 * Measured: BM25 against the built-in lexical reranker. The model reranker
 * (bge-reranker-v2-m3) is NOT measured here; it needs the model (Mac /
 * `npm run eval:rerank`). Until then the decision "off by default" stands
 * as provisional.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Bm25Index } from "../search/bm25";
import { rerank } from "../ai/reranker";
// @ts-expect-error the harness is plain JavaScript
import { compareRerank, rerankDecision } from "../../scripts/golden/evals/rerank.mjs";

type Split = { items: Array<{ id: string; query: string; relevant: string[]; sameArticle?: string[] }>; corpus: Array<{ id: string; title: string; text: string }> };
const load = (f: string) => JSON.parse(readFileSync(join(__dirname, "../../eval/golden/retrieval-hard", f), "utf8")) as Split;

describe("reranker on the hard retrieval set (W10.B18)", () => {
  for (const split of ["dev.json", "heldout.json"]) {
    it(`${split}: BM25 is below 1.0, and the lexical reranker's gain is measured`, async () => {
      const s = load(split);
      const res = (await compareRerank(Bm25Index, (q: string, docs: Array<{ id: string; text: string }>) => rerank(q, docs, { mode: "lexical" }), {
        items: s.items,
        documents: s.corpus,
        candidates: 20,
      })) as { items: number; bm25: number; reranked: number; gain: number };
      console.info(`[7.6] retrieval-hard ${split}: ${res.items} queries · BM25 nDCG@10 ${res.bm25} · BM25 + lexical rerank ${res.reranked} · gain ${res.gain} points → ${rerankDecision(res.gain)} (the model reranker is not measured here)`);
      expect(res.items).toBeGreaterThan(50);
      // The point of this set: BM25 is not saturated, so a gain could show.
      expect(res.bm25).toBeLessThan(1);
    }, 120_000);
  }
});
