/**
 * Plan 7.6 / W10.B18: the reranker seam of the evals (crossEncoder.ts) and
 * the gate on the public sets (rerank.mjs publicSourceProblem,
 * beirToRerankSet). The model itself runs on the Mac (npm run eval:rerank).
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { rerankModelId, rerankWith, RERANK_BATCH, RERANK_MAX_PASSAGE_CHARS, type PairScorer } from "../../scripts/eval/lib/crossEncoder";
import { parseBeir } from "../agents/eval/retrievalPublic";
// @ts-expect-error the harness is plain JavaScript
import { beirToRerankSet, publicSourceProblem } from "../../scripts/golden/evals/rerank.mjs";

const docs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, text: `passage ${i} ${"x".repeat(3000)}` }));

describe("the reranker seam", () => {
  it("scores in batches of 8, cuts passages to 2,000 characters, orders by score and keeps ties stable", async () => {
    const calls: Array<{ q: string; n: number; max: number }> = [];
    const score: PairScorer = async (q, passages) => {
      calls.push({ q, n: passages.length, max: Math.max(...passages.map((p) => p.length)) });
      // d5 best, then d17, the rest tied at 0.
      return passages.map((p) => (p.startsWith("passage 5 ") ? 0.9 : p.startsWith("passage 17 ") ? 0.5 : 0));
    };
    const out = await rerankWith(score)("q", docs(20));
    expect(calls.map((c) => c.n)).toEqual([RERANK_BATCH, RERANK_BATCH, 4]);
    expect(calls.every((c) => c.q === "q" && c.max === RERANK_MAX_PASSAGE_CHARS)).toBe(true);
    expect(out.map((d) => d.id).slice(0, 4)).toEqual(["d5", "d17", "d0", "d1"]);
    expect(out).toHaveLength(20);
  });

  it("a scorer that returns the wrong number of scores is an error, and NaN ranks last", async () => {
    await expect(rerankWith(async () => [1])("q", docs(3))).rejects.toThrow(/1 scores for 3 passages/);
    const out = await rerankWith(async (_q, p) => p.map((_, i) => (i === 0 ? Number.NaN : i)))("q", docs(3));
    expect(out.map((d) => d.id)).toEqual(["d2", "d1", "d0"]);
  });

  it("picks the model from LUMEN_EVAL_RERANK_MODEL, else the app's default, and refuses an excluded licence", () => {
    expect(rerankModelId({}, "onnx-community/bge-reranker-v2-m3-ONNX")).toBe("onnx-community/bge-reranker-v2-m3-ONNX");
    expect(rerankModelId({ LUMEN_EVAL_RERANK_MODEL: " BAAI/bge-reranker-base " }, "x")).toBe("BAAI/bge-reranker-base");
    expect(() => rerankModelId({ LUMEN_EVAL_RERANK_MODEL: "jinaai/jina-reranker-v3" }, "x")).toThrow(/CC-BY-NC/);
  });
});

describe("public sets enter the rerank decision only with an accepted licence and their fetch-time sha256 (W10.B18)", () => {
  const files = { "corpus.jsonl": '{"_id":"c1","text":"שלום"}\n', "queries.jsonl": '{"_id":"q1","text":"שלום?"}\n', "qrels.tsv": "query-id\tcorpus-id\tscore\nq1\tc1\t1\n" };
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const shas = Object.fromEntries(Object.entries(files).map(([f, t]) => [f, sha(t)]));
  const of = (over: Record<string, string> = {}) => (f: string) => (f in over ? over[f] : f in files ? sha(files[f as keyof typeof files]) : null);
  const good = { source: "https://huggingface.co/datasets/mteb/WebFAQRetrieval", revision: "a".repeat(40), cardLicense: "cc-by-4.0", sha256: shas };

  it("accepts a set fetched with the plan's licence whose files are unchanged", () => {
    expect(publicSourceProblem("webfaq-heb", good, of())).toBeNull();
    expect(publicSourceProblem("belebele-heb", { ...good, source: "https://huggingface.co/datasets/facebook/belebele", cardLicense: "cc-by-sa-4.0" }, of())).toBeNull();
  });

  it("refuses a missing source, another repo, another licence, no revision, no sha256 or a changed file", () => {
    expect(publicSourceProblem("webfaq-heb", null, of())).toBe("webfaq-heb: no source.json");
    expect(publicSourceProblem("beir-fiqa", good, of())).toMatch(/not a public rerank set/);
    expect(publicSourceProblem("webfaq-heb", { ...good, source: "https://huggingface.co/datasets/someone/webfaq" }, of())).toMatch(/is not mteb\/WebFAQRetrieval/);
    expect(publicSourceProblem("webfaq-heb", { ...good, cardLicense: "cc-by-nc-4.0" }, of())).toBe("webfaq-heb: the dataset card says cc-by-nc-4.0, the plan accepts cc-by-4.0");
    expect(publicSourceProblem("belebele-heb", { ...good, source: "https://huggingface.co/datasets/facebook/belebele", cardLicense: "cc-by-4.0" }, of())).toMatch(/accepts cc-by-sa-4.0/);
    expect(publicSourceProblem("webfaq-heb", { ...good, cardLicense: undefined }, of())).toMatch(/says no licence/);
    expect(publicSourceProblem("webfaq-heb", { ...good, revision: "main" }, of())).toBe("webfaq-heb: no pinned revision");
    expect(publicSourceProblem("webfaq-heb", { ...good, sha256: {} }, of())).toBe("webfaq-heb: no sha256 recorded at fetch");
    expect(publicSourceProblem("webfaq-heb", good, of({ "qrels.tsv": "0".repeat(64) }))).toMatch(/qrels\.tsv sha256 0+ ≠/);
  });

  it("turns a BEIR set into compareRerank's shape, dropping queries without a positive judgment", () => {
    const set = parseBeir("t", { corpus: files["corpus.jsonl"] + '{"_id":"c2","title":"T","text":"עוד"}\n', queries: files["queries.jsonl"] + '{"_id":"q2","text":"אין"}\n', qrels: files["qrels.tsv"] });
    expect(beirToRerankSet(set)).toEqual({ items: [{ id: "q1", query: "שלום?", relevant: ["c1"] }], documents: [{ id: "c1", text: "שלום" }, { id: "c2", text: "T\nעוד" }] });
  });
});
