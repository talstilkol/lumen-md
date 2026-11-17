// @vitest-environment node
/**
 * Plan W12.A3 — the "Ask the vault" eval harness.
 *
 *  - On real public data in the repo: the committed HeQ dev split
 *    (eval/golden/retrieval/dev/heq.json: 12 questions over all 238 HeQ v1.1
 *    test paragraphs, pinned commit f46d2ff). The citation metric is computed
 *    against HeQ's own paragraph for each question, not a set we wrote.
 *  - The cloud run has no model: it uses the labelled no-LLM extractive
 *    baseline, and its card is tagged `dev`, which plan:check never accepts
 *    as a ✅ (W11.I18). The real-model run is W12.M1, on the Mac.
 *  - The small sets in the metric tests are SYNTHETIC (labelled below); they
 *    check the arithmetic only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { askPathRetriever, citationScores, extractiveAnswerer, heqFromGolden, heqFromSquad, heqNotePath, runAskRetrieval, runHeqCitations, type Answerer, type HeqSet } from "../agents/eval/askVaultEval";
import type { RetrievalSet } from "../agents/eval/retrievalPublic";
import { scopeFilter } from "../ai/askScope";
// @ts-expect-error — plain .mjs module without type declarations
import { makeCard, validateCard, CLAIM_TAGS } from "../../scripts/lib/evalCard.mjs";

const golden = JSON.parse(readFileSync("eval/golden/retrieval/dev/heq.json", "utf8"));
const HEQ = heqFromGolden("heq (golden dev split)", golden);
const heqAsRetrieval = (s: HeqSet): RetrievalSet => ({
  name: s.name,
  corpus: new Map([...s.corpus].map(([id, p]) => [heqNotePath(id), `# ${p.title}\n\n${p.text}\n`])),
  queries: new Map(s.items.map((i) => [i.id, i.question])),
  qrels: new Map(s.items.map((i) => [i.id, new Map([[heqNotePath(i.gold), 1]])])),
});

describe("HeQ loaders", () => {
  it("the committed dev split: 12 questions, each with HeQ's own paragraph among the 238", () => {
    expect(HEQ.corpus.size).toBe(238);
    expect(HEQ.items).toHaveLength(12);
    for (const i of HEQ.items) {
      expect(HEQ.corpus.has(i.gold)).toBe(true);
      // The official answer span sits in the official paragraph.
      expect(i.answers.some((a) => HEQ.corpus.get(i.gold)!.text.includes(a))).toBe(true);
    }
  });

  it("the upstream SQuAD form keeps the questions the golden builder keeps (SYNTHETIC two-paragraph file)", () => {
    const squad = {
      data: [
        {
          title: "כותרת",
          paragraphs: [
            { context: "פסקה ראשונה.", qas: [{ id: "a", question: "ש1?", answers: [{ text: "ראשונה" }] }, { id: "b", question: "ש2?", is_impossible: true, answers: [] }] },
            { context: "פסקה שנייה.", qas: [{ id: "c", question: "ש3?", answers: [{ text: "שנייה" }], "question quality": "deixis" }, { id: "d", question: "ש4?", answers: [{ text: "שנייה" }, { text: "שנייה" }] }] },
          ],
        },
      ],
    };
    const s = heqFromSquad("synthetic", squad);
    expect(s.items).toEqual([
      { id: "a", question: "ש1?", gold: "heq-d001", answers: ["ראשונה"] },
      { id: "d", question: "ש4?", gold: "heq-d002", answers: ["שנייה"] },
    ]);
  });
});

describe("retrieval through the ask path", () => {
  it("nDCG@10 and Recall@20 per query on HeQ dev, reranker off and on, all within [0, 1]", async () => {
    for (const rerank of ["off", "lexical"] as const) {
      const run = await runAskRetrieval(heqAsRetrieval(HEQ), askPathRetriever({ rerank }));
      expect(run.n).toBe(12);
      expect(run.retriever).toContain(`rerank=${rerank}`);
      for (const x of [...run.ndcg10, ...run.recall20]) expect(x >= 0 && x <= 1).toBe(true);
      // Hebrew BM25 over heading chunks finds most HeQ paragraphs in the top 20.
      expect(run.recall20.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(6);
    }
  });

  it("the scope filter holds inside the eval: a denied folder is never ranked", async () => {
    const set = heqAsRetrieval(HEQ);
    const r = askPathRetriever({ rerank: "off", filter: scopeFilter({ deny: { folders: ["heq"] } }) });
    await r.index(set.corpus);
    expect(await r.search(HEQ.items[0].question, 20)).toEqual([]);
  });
});

describe("citations on HeQ (official paragraph as gold)", () => {
  it("the cloud run gives a complete card tagged dev, never a claim", async () => {
    const run = await runHeqCitations(HEQ, askPathRetriever({ rerank: "lexical" }), extractiveAnswerer());
    expect(run.n).toBe(12);
    const card = makeCard({ tag: "dev", model: extractiveAnswerer().model, seed: 1, temperature: 0, dataset: { name: HEQ.name, version: "f46d2ff1b796a95e897530f167ae0d5bed123fe1", license: "CC-BY-4.0 AND CC-BY-SA-4.0", source: "https://github.com/NNLP-IL/Hebrew-Question-Answering-Dataset/tree/f46d2ff1b796a95e897530f167ae0d5bed123fe1" }, scores: citationScores(run) });
    expect(validateCard(card)).toEqual([]);
    expect(card.tag).toBe("dev");
    expect(CLAIM_TAGS).not.toContain(card.tag);
    expect(Object.keys(card.metrics).sort()).toEqual(["cite_precision", "cite_recall", "gold_in_context", "unsupported_rate"]);
    // The baseline quotes word for word, so whatever it cites verifies: no unsupported claims.
    expect(card.metrics.unsupported_rate.value).toBe(0);
    // A citation can only be right when the paragraph was retrieved.
    run.citeRecall.forEach((x, i) => expect(x).toBeLessThanOrEqual(run.goldInContext[i]));
  });

  // SYNTHETIC: a scripted answerer per case, to check the arithmetic of each metric.
  const scripted = (fn: (sources: readonly { path: string; content: string }[]) => string): Answerer => ({ model: { name: "scripted (test)", digest: "none:test" }, temperature: 0, answer: async ({ sources }) => fn(sources) });
  const one: HeqSet = { name: "synthetic", corpus: new Map([["g", { title: "א", text: "the launch moved to Tuesday after the review." }], ["o", { title: "ב", text: "the launch budget stays the same this year." }]]), items: [{ id: "q", question: "when did the launch move?", gold: "g", answers: ["Tuesday"] }] };
  const quoteOf = (sources: readonly { path: string; content: string }[], path: string, q: string) => `Claim [${sources.findIndex((s) => s.path === path) + 1}] "${q}".`;

  it("a citation of the gold paragraph: recall 1, precision 1, nothing unsupported", async () => {
    const run = await runHeqCitations(one, askPathRetriever({ rerank: "off" }), scripted((s) => quoteOf(s, "heq/g.md", "the launch moved to Tuesday")));
    expect([run.citeRecall, run.citePrecision, run.unsupportedRate]).toEqual([[1], [1], [0]]);
  });

  it("a verified citation of the wrong paragraph: recall 0, precision 0", async () => {
    const run = await runHeqCitations(one, askPathRetriever({ rerank: "off" }), scripted((s) => quoteOf(s, "heq/o.md", "the launch budget stays the same")));
    expect([run.citeRecall, run.citePrecision]).toEqual([[0], [0]]);
  });

  it("a fabricated quote: no verified citation (no precision item) and the claim is unsupported", async () => {
    const run = await runHeqCitations(one, askPathRetriever({ rerank: "off" }), scripted((s) => quoteOf(s, "heq/g.md", "the launch moved to Friday")));
    expect([run.citeRecall, run.citePrecision, run.unsupportedRate]).toEqual([[0], [], [1]]);
    expect(Object.keys(citationScores(run))).not.toContain("cite_precision");
  });
});
