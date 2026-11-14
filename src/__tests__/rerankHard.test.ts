/**
 * Plan W10.B18 (audit 7.6): the reranker decision was taken on HeQ dev,
 * where BM25 alone already scores nDCG@10 1.0, so no reranker can show a
 * gain there (1.0 vs 1.0). Here the same comparison runs on the hard set
 * (eval/golden/retrieval-hard, plan W7.13: real HeQ test questions with
 * spelling, paraphrase and other changes, over 238 real HeQ paragraphs),
 * where BM25 is below 1.0.
 *
 * Measured: BM25 against the built-in lexical reranker. BM25 wins on both
 * splits, so the app's default is BM25 only ("off"), and this file pins the
 * default to the measured winner (coordinator decision, W10.B18). The model
 * reranker (bge-reranker-v2-m3) is NOT measured here; it needs the model
 * (Mac / `npm run eval:rerank`), and it may become the default only with a
 * Mac receipt that beats BM25 by ≥ 3 points on both splits.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Bm25Index } from "../search/bm25";
import { DEFAULT_RERANK_MODE, RERANK_DEFAULT_EVIDENCE, getRerankMode, rerank, setRerankMode, type RerankMode } from "../ai/reranker";
// @ts-expect-error the harness is plain JavaScript
import { compareRerank, rerankDecision, modelDefaultAllowed, MODEL_DEFAULT_MIN_GAIN_POINTS } from "../../scripts/golden/evals/rerank.mjs";

// The model can't run in a unit test; this stands in for "no WebGPU / download refused / offline".
vi.mock("../ai/transformersEngine", () => ({
  rerankLocal: async () => {
    throw new Error("no WebGPU");
  },
}));

type Split = { items: Array<{ id: string; query: string; relevant: string[]; sameArticle?: string[] }>; corpus: Array<{ id: string; title: string; text: string }> };
type Res = { items: number; bm25: number; reranked: number; gain: number };
const load = (f: string) => JSON.parse(readFileSync(join(__dirname, "../../eval/golden/retrieval-hard", f), "utf8")) as Split;
const SPLITS = ["dev", "heldout"] as const;
const measured: Record<string, Res> = {};

beforeAll(async () => {
  for (const split of SPLITS) {
    const s = load(`${split}.json`);
    measured[split] = (await compareRerank(Bm25Index, (q: string, docs: Array<{ id: string; text: string }>) => rerank(q, docs, { mode: "lexical" }), {
      items: s.items,
      documents: s.corpus,
      candidates: 20,
    })) as Res;
  }
}, 240_000);

describe("reranker on the hard retrieval set (W10.B18)", () => {
  for (const split of SPLITS) {
    it(`${split}.json: BM25 is below 1.0, and the lexical reranker's gain is measured`, () => {
      const res = measured[split];
      console.info(`[7.6] retrieval-hard ${split}: ${res.items} queries · BM25 nDCG@10 ${res.bm25} · BM25 + lexical rerank ${res.reranked} · gain ${res.gain} points → ${rerankDecision(res.gain)} (the model reranker is not measured here)`);
      expect(res.items).toBeGreaterThan(50);
      // The point of this set: BM25 is not saturated, so a gain could show.
      expect(res.bm25).toBeLessThan(1);
      // The numbers the default rests on are the ones measured here.
      expect(res.bm25).toBeCloseTo(RERANK_DEFAULT_EVIDENCE.bm25[split], 3);
      expect(res.reranked).toBeCloseTo(RERANK_DEFAULT_EVIDENCE.lexical[split], 3);
    });
  }
});

/** Committed eval receipts of the model reranker (rerank.eval.ts writes eval/results/rerank-<date>.json). */
function modelReceipts(): unknown[] {
  const dir = join(__dirname, "../../eval/results");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^rerank-.*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown);
}

describe("the default is pinned to the measured winner (W10.B18)", () => {
  it("BM25 only wins on both hard splits, so the default is \"off\"; the lexical reranker is not the default", () => {
    const mean = (f: (r: Res) => number) => SPLITS.reduce((a, s) => a + f(measured[s]), 0) / SPLITS.length;
    const candidates: Array<{ mode: RerankMode; score: number }> = [
      { mode: "off", score: mean((r) => r.bm25) },
      { mode: "lexical", score: mean((r) => r.reranked) },
    ];
    const winner = candidates.sort((a, b) => b.score - a.score)[0].mode;
    // The model joins only through a Mac receipt that clears the bar.
    const modelOk = modelReceipts().some((r) => (modelDefaultAllowed(r) as { ok: boolean }).ok);
    if (DEFAULT_RERANK_MODE === "model") expect(modelOk, "the model is the default only with a Mac receipt ≥ 3 points over BM25 on dev and held-out").toBe(true);
    else expect(DEFAULT_RERANK_MODE).toBe(winner);
    for (const s of SPLITS) expect(measured[s].bm25, s).toBeGreaterThan(measured[s].reranked);
  });

  it("the model may become the default only from a Mac receipt that beats BM25 by ≥ 3 points on both splits", () => {
    expect(MODEL_DEFAULT_MIN_GAIN_POINTS).toBe(3);
    const row = (part: string, bm25: number, reranked: number) => ({ split: "eval/golden/retrieval-hard", part, items: 90, bm25, reranked, gain: Math.round((reranked - bm25) * 10000) / 100 });
    const mac = { platform: "darwin", arch: "arm64", cpu: "Apple M1" };
    const ok = { model: "onnx-community/bge-reranker-v2-m3-ONNX", machine: mac, rows: [row("dev", 0.9479, 0.98), row("heldout", 0.9521, 0.99)] };
    expect(modelDefaultAllowed(ok)).toEqual({ ok: true, why: "" });
    expect(modelDefaultAllowed(null).ok).toBe(false);
    expect(modelDefaultAllowed({ ...ok, machine: { ...mac, platform: "linux" } }).why).toMatch(/Mac/);
    expect(modelDefaultAllowed({ ...ok, rows: [row("dev", 0.9479, 0.98), row("heldout", 0.9521, 0.98)] }).why).toMatch(/heldout: gain 2\.79 < 3/);
    expect(modelDefaultAllowed({ ...ok, rows: [row("dev", 0.9479, 0.98)] }).why).toMatch(/no retrieval-hard heldout/);
    expect(modelDefaultAllowed({ ...ok, model: "some-other-model" }).ok).toBe(false);
  });
});

describe("what the default does", () => {
  beforeEach(() => localStorage.clear());
  const docs = [
    { id: "a", text: "פסקה על משהו אחר לגמרי" },
    { id: "b", text: "ירושלים היא בירת ישראל" },
    { id: "c", text: "עוד פסקה" },
  ];

  it("with nothing stored, search keeps the BM25 order", async () => {
    expect(getRerankMode()).toBe("off");
    expect((await rerank("בירת ישראל", docs)).map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("the lexical reranker is still there as an opt-in setting", async () => {
    setRerankMode("lexical");
    expect(getRerankMode()).toBe("lexical");
    expect((await rerank("בירת ישראל", docs))[0].id).toBe("b");
  });

  it("the model path, when the model can't run, falls back to the BM25 order (not to the lexical score)", async () => {
    expect((await rerank("בירת ישראל", docs, { mode: "model" })).map((d) => d.id)).toEqual(["a", "b", "c"]);
  });
});
