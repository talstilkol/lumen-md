// @vitest-environment node
/**
 * Plan W11.I13 — loaders, metrics and the report for public retrieval sets.
 * The sample below is SYNTHETIC (20 invented queries in the BEIR file
 * format and 4 invented Belebele-shaped rows), so the loaders and the
 * report are exercised offline; it measures nothing. Its card is tagged
 * `dev`, which plan:check never accepts for a ✅ (W11.I18).
 */
import { describe, it, expect } from "vitest";
import { assertAllowed, beatsDefault, belebeleRetrieval, bm25Retriever, ndcgAt, p95, parseBeir, PUBLIC_SETS, recallAt, rerankerAllowed, rrf, rrfRetriever, runRetrieval, type Retriever } from "../agents/eval/retrievalPublic";
// @ts-expect-error — plain .mjs module without type declarations
import { makeCard, validateCard } from "../../scripts/lib/evalCard.mjs";

const TOPICS = ["budget", "garden", "violin", "harbour", "glacier", "orchard", "lantern", "compass", "falcon", "meadow", "quartz", "saffron", "thunder", "velvet", "walnut", "yarrow", "zephyr", "anchor", "bramble", "cobalt"];
/** SYNTHETIC: one document per topic plus 20 distractors, one query per topic, and a second relevant doc for the first 5. */
function syntheticBeir() {
  const corpus = [
    ...TOPICS.map((t, i) => JSON.stringify({ _id: `d${i}`, title: `Notes on ${t}`, text: `Everything about the ${t}: its history and use.` })),
    ...TOPICS.map((_t, i) => JSON.stringify({ _id: `x${i}`, title: `Misc ${i}`, text: `An unrelated page number ${i} about weather and roads.` })),
    ...TOPICS.slice(0, 5).map((t, i) => JSON.stringify({ _id: `e${i}`, title: `More ${t}`, text: `A second note that mentions ${t} once.` })),
  ].join("\n");
  const queries = [...TOPICS.map((t, i) => JSON.stringify({ _id: `q${i}`, text: `what about the ${t}` })), JSON.stringify({ _id: "q-unjudged", text: "nothing" })].join("\n");
  const qrels = ["query-id\tcorpus-id\tscore", ...TOPICS.map((_, i) => `q${i}\td${i}\t2`), ...TOPICS.slice(0, 5).map((_, i) => `q${i}\te${i}\t1`), "q0\tmissing-doc\t1"].join("\n");
  return { corpus, queries, qrels };
}

describe("loaders", () => {
  it("BEIR / MTEB files: 20 judged queries, unjudged and dangling judgments dropped", () => {
    const set = parseBeir("synthetic-beir", syntheticBeir());
    expect(set.corpus.size).toBe(45);
    expect(set.queries.size).toBe(20);
    expect(set.qrels.get("q0")).toEqual(new Map([["d0", 2], ["e0", 1]]));
  });

  it("Belebele rows: each question retrieves its passage, also across languages (he→en)", () => {
    const he = [
      { link: "a", question_number: 1, flores_passage: "קטע א", question: "שאלה 1" },
      { link: "a", question_number: 2, flores_passage: "קטע א", question: "שאלה 2" },
      { link: "b", question_number: 1, flores_passage: "קטע ב", question: "שאלה 3" },
    ];
    const en = [
      { link: "a", question_number: 1, flores_passage: "passage A", question: "q1" },
      { link: "b", question_number: 1, flores_passage: "passage B", question: "q3" },
    ];
    const mono = belebeleRetrieval("synthetic-belebele-he", he);
    expect([mono.corpus.size, mono.queries.size]).toEqual([2, 3]);
    const cross = belebeleRetrieval("synthetic-belebele-he-en", he, en);
    expect([...cross.corpus.values()]).toEqual(["passage A", "passage B"]);
    expect(cross.queries.get("a#2")).toBe("שאלה 2");
    expect(cross.qrels.get("b#1")).toEqual(new Map([["p1", 1]]));
  });

  it("names every public set with its source, and MAFAT as owed until registration", () => {
    expect(PUBLIC_SETS.map((s) => s.name)).toEqual(["webfaq-heb", "belebele-heb", "belebele-he-en", "beir-scifact", "beir-nfcorpus", "beir-fiqa", "mafat-hsrc"]);
    expect(PUBLIC_SETS.find((s) => s.name === "webfaq-heb")!.license).toBe("CC-BY-4.0");
    expect(PUBLIC_SETS.find((s) => s.name === "mafat-hsrc")!.format).toBe("owed");
  });
});

describe("metrics and rules", () => {
  it("nDCG@10 and Recall@100 match hand-computed values", () => {
    const rel = new Map([["a", 2], ["b", 1]]);
    expect(ndcgAt(["a", "b"], rel)).toBeCloseTo(1, 10);
    // b first, a second: (1/1 + 3/log2(3)) / (3/1 + 1/log2(3))
    expect(ndcgAt(["b", "a"], rel)).toBeCloseTo((1 + 3 / Math.log2(3)) / (3 + 1 / Math.log2(3)), 10);
    expect(ndcgAt(["x", "y"], rel)).toBe(0);
    expect(recallAt(["a", "x"], rel)).toBe(0.5);
    expect(p95([5, 1, 4, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])).toBe(19);
  });

  it("RRF fuses ranks; the default switches only at +3 points with separate intervals; a reranker at +2 and ≤ 150 ms", () => {
    expect(rrf([["a", "b", "c"], ["b", "a", "d"]])).toEqual(["a", "b", "c", "d"]);
    expect(beatsDefault({ value: 0.5, ci95: [0.46, 0.54] }, { value: 0.6, ci95: [0.55, 0.65] })).toBe(true);
    expect(beatsDefault({ value: 0.5, ci95: [0.46, 0.54] }, { value: 0.56, ci95: [0.52, 0.6] })).toBe(false);
    expect(beatsDefault({ value: 0.5, ci95: [0.49, 0.51] }, { value: 0.52, ci95: [0.515, 0.525] })).toBe(false);
    expect(rerankerAllowed(0.02, 150)).toBe(true);
    expect(rerankerAllowed(0.02, 151)).toBe(false);
    expect(rerankerAllowed(0.019, 50)).toBe(false);
  });

  it("jina-reranker-v3 is excluded for its non-commercial licence", () => {
    expect(() => assertAllowed("jinaai/jina-reranker-v3")).toThrow(/CC-BY-NC/);
    expect(() => assertAllowed("BAAI/bge-reranker-v2-m3")).not.toThrow();
  });
});

describe("a fake run end to end (SYNTHETIC)", () => {
  it("BM25 and an RRF hybrid run on the 20 queries and give a report with bootstrap intervals, as a dev card", async () => {
    const set = parseBeir("synthetic-beir", syntheticBeir());
    const bm25 = await runRetrieval(set, bm25Retriever());
    expect(bm25.n).toBe(20);
    expect(bm25.indexBytes).toBeGreaterThan(0);
    // The topic word is in its document: BM25 finds it first every time.
    expect(bm25.ndcg10.every((x) => x > 0.6)).toBe(true);
    expect(bm25.recall100.every((x) => x === 1)).toBe(true);
    // A deliberately bad "embedding" stand-in: reverses the corpus order. RRF with BM25 must still run.
    const bad: Retriever = { id: "fake-dense", index: async (c) => ((ids = [...c.keys()].reverse()), 0), search: async () => ids.slice(0, 100) };
    let ids: string[] = [];
    const hybrid = await runRetrieval(set, rrfRetriever([bm25Retriever(), bad]));
    expect(hybrid.retriever).toBe("rrf(bm25+fake-dense)");
    const card = makeCard({ tag: "dev", model: { name: "bm25 (lumen)", digest: "none:lexical" }, seed: 1, temperature: 0, dataset: { name: "synthetic-beir", version: "test", license: "synthetic" }, scores: { ndcg_at_10: bm25.ndcg10, recall_at_100: bm25.recall100 } });
    expect(validateCard(card)).toEqual([]);
    expect(card.tag).toBe("dev");
    expect(card.metrics.ndcg_at_10.ci95[0]).toBeLessThanOrEqual(card.metrics.ndcg_at_10.value);
    expect(card.n).toBe(20);
  });
});
