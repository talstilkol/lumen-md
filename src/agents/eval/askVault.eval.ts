/**
 * Plan W12.A3 — "Ask the vault" on public sets: `npm run eval:ask-vault`.
 * Not part of the normal test run.
 *
 *   LUMEN_EVAL_RETRIEVAL_DIR  W11.I13 sets (scripts/retrieval/fetch.py), default eval/public-data/retrieval;
 *                             webfaq-heb, belebele-heb and belebele-he-en are run when present
 *   LUMEN_EVAL_HEQ            HeQ v1.1 test in its upstream form, default eval/public-data/heq/test v1.1.json
 *                             (fetch.py, pinned commit); without it, the committed dev split
 *                             eval/golden/retrieval/dev/heq.json, and the card is tagged dev
 *   LUMEN_ASK_MODEL           an Ollama model for the answers (with LUMEN_ASK_MODEL_DIGEST); without it,
 *                             the labelled no-LLM extractive baseline
 *   LUMEN_ASK_RERANK          off,lexical[,model] (default off,lexical)
 *   LUMEN_EVAL_OUT            default eval/results
 *
 * One carded report (W11.I18) per set and setting. The real-model run is the Mac's (W12.M1).
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBeir } from "./retrievalPublic";
import { askPathRetriever, citationScores, extractiveAnswerer, heqFromGolden, heqFromSquad, ollamaAnswerer, runAskRetrieval, runHeqCitations } from "./askVaultEval";
// @ts-expect-error — plain .mjs module without type declarations
import { makeCard } from "../../../scripts/lib/evalCard.mjs";

const retrievalDir = process.env.LUMEN_EVAL_RETRIEVAL_DIR || "eval/public-data/retrieval";
const heqPath = process.env.LUMEN_EVAL_HEQ || "eval/public-data/heq/test v1.1.json";
const outDir = process.env.LUMEN_EVAL_OUT || "eval/results";
const reranks = (process.env.LUMEN_ASK_RERANK || "off,lexical").split(",") as Array<"off" | "lexical" | "model">;
const HEQ_COMMIT = "f46d2ff1b796a95e897530f167ae0d5bed123fe1";
const HEQ_SOURCE = `https://github.com/NNLP-IL/Hebrew-Question-Answering-Dataset/tree/${HEQ_COMMIT}`;

// skip-reason: an opt-in eval on public sets (LUMEN_EVAL_ASK=1), not a unit test | task: W12.A3 | until: 2027-05-15
describe.skipIf(!process.env.LUMEN_EVAL_ASK)("ask the vault — retrieval and citations on public sets", () => {
  it("writes a carded report per set and setting", async () => {
    mkdirSync(outDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    for (const name of ["webfaq-heb", "belebele-heb", "belebele-he-en"]) {
      const d = join(retrievalDir, name);
      if (!existsSync(d)) continue;
      const f = (x: string) => readFileSync(join(d, x), "utf8");
      const src = JSON.parse(f("source.json")) as { source: string; revision: string; license: string };
      const set = parseBeir(name, { corpus: f("corpus.jsonl"), queries: f("queries.jsonl"), qrels: f("qrels.tsv") });
      for (const rr of reranks) {
        const run = await runAskRetrieval(set, askPathRetriever({ rerank: rr }));
        const card = makeCard({ tag: "public", model: { name: `ask path, rerank ${rr}`, digest: rr === "model" ? "bge-reranker-v2-m3 (q8, see eval:rerank)" : "none:lexical" }, seed: 1, temperature: 0, dataset: { name, version: src.revision, license: src.license, source: src.source }, scores: { ndcg_at_10: run.ndcg10, recall_at_20: run.recall20 } });
        writeFileSync(join(outDir, `ask-retrieval-${name}-${rr}-${date}.json`), JSON.stringify({ card, retriever: run.retriever }, null, 2));
        // hygiene-allow: progress output of a CLI eval run
        console.log(`${name} rerank=${rr}: nDCG@10 ${card.metrics.ndcg_at_10.value} [${card.metrics.ndcg_at_10.ci95}] · R@20 ${card.metrics.recall_at_20.value} · n ${run.n}`);
      }
    }
    const upstream = existsSync(heqPath);
    const heq = upstream
      ? heqFromSquad("heq-test-v1.1", JSON.parse(readFileSync(heqPath, "utf8")))
      : heqFromGolden("heq (golden dev split)", JSON.parse(readFileSync("eval/golden/retrieval/dev/heq.json", "utf8")));
    const model = process.env.LUMEN_ASK_MODEL;
    const answerer = model ? ollamaAnswerer(model, process.env.LUMEN_ASK_MODEL_DIGEST || "unpinned", { url: process.env.OLLAMA_HOST }) : extractiveAnswerer();
    expect(answerer.model.digest, "pin the model: LUMEN_ASK_MODEL_DIGEST").not.toBe("unpinned");
    for (const rr of reranks) {
      const run = await runHeqCitations(heq, askPathRetriever({ rerank: rr }), answerer);
      // Only the full upstream test split is public; the committed 12-question split is dev (W11.I18).
      const card = makeCard({ tag: upstream ? "public" : "dev", model: answerer.model, seed: 1, temperature: answerer.temperature, dataset: { name: heq.name, version: HEQ_COMMIT, license: "CC-BY-4.0 AND CC-BY-SA-4.0", source: HEQ_SOURCE }, scores: citationScores(run) });
      writeFileSync(join(outDir, `ask-citations-heq-${upstream ? "test" : "dev"}-${rr}-${date}.json`), JSON.stringify({ card, retriever: run.retriever, questions: run.n }, null, 2));
      // hygiene-allow: progress output of a CLI eval run
      console.log(`heq rerank=${rr} (${card.tag}): cite recall ${card.metrics.cite_recall.value} · precision ${card.metrics.cite_precision?.value ?? "—"} · unsupported ${card.metrics.unsupported_rate.value} · n ${run.n}`);
    }
  }, 6 * 60 * 60 * 1000);
});
