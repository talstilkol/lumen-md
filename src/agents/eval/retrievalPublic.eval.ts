/**
 * Plan W11.I13 — retrieval on the public sets, on a machine that has them
 * (W11.M5). Not part of the normal test run: `npm run eval:retrieval-public`.
 *
 *   LUMEN_EVAL_RETRIEVAL_DIR   default eval/public-data/retrieval (from scripts/retrieval/fetch.py)
 *   LUMEN_EVAL_OUT             default eval/results
 *
 * Each set folder holds corpus.jsonl, queries.jsonl, qrels.tsv (BEIR form; the
 * fetch script writes Belebele the same way) and source.json ({ source,
 * revision, license }). One carded report per set and retriever (W11.I18,
 * tag public). Embedding models and rerankers join as Retrievers on the Mac.
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bm25Retriever, parseBeir, runRetrieval } from "./retrievalPublic";
// @ts-expect-error — plain .mjs module without type declarations
import { makeCard } from "../../../scripts/lib/evalCard.mjs";

const dir = process.env.LUMEN_EVAL_RETRIEVAL_DIR || "eval/public-data/retrieval";
const outDir = process.env.LUMEN_EVAL_OUT || "eval/results";

// skip-reason: an opt-in eval on downloaded public sets (LUMEN_EVAL_RETRIEVAL=1), not a unit test | task: W11.I13 | until: 2027-05-15
describe.skipIf(!process.env.LUMEN_EVAL_RETRIEVAL)(`public retrieval sets — ${dir}`, () => {
  it("runs BM25 on every set and writes a carded report", async () => {
    expect(existsSync(dir) ? "ok" : `no data at ${dir}: run python3 scripts/retrieval/fetch.py`).toBe("ok");
    mkdirSync(outDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    for (const name of readdirSync(dir)) {
      const f = (x: string) => readFileSync(join(dir, name, x), "utf8");
      const src = JSON.parse(f("source.json")) as { source: string; revision: string; license: string };
      const set = parseBeir(name, { corpus: f("corpus.jsonl"), queries: f("queries.jsonl"), qrels: f("qrels.tsv") });
      const run = await runRetrieval(set, bm25Retriever());
      const card = makeCard({ tag: "public", model: { name: "bm25 (lumen neuralSearch)", digest: "none:lexical" }, seed: 1, temperature: 0, dataset: { name, version: src.revision, license: src.license, source: src.source }, scores: { ndcg_at_10: run.ndcg10, recall_at_100: run.recall100 } });
      writeFileSync(join(outDir, `retrieval-${name}-bm25-${date}.json`), JSON.stringify({ card, p95Ms: run.p95Ms, indexBytes: run.indexBytes, docs: set.corpus.size }, null, 2));
      // hygiene-allow: progress output of a CLI eval run
      console.log(`${name}: nDCG@10 ${card.metrics.ndcg_at_10.value} [${card.metrics.ndcg_at_10.ci95}] · R@100 ${card.metrics.recall_at_100.value} · p95 ${run.p95Ms.toFixed(1)} ms · n ${run.n}`);
    }
  }, 6 * 60 * 60 * 1000);
});
