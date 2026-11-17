/**
 * Plan W10.B18 (audit 7.6): the reranker decision was taken on HeQ dev,
 * where BM25 alone already scores nDCG@10 1.0, so no reranker can show a
 * gain there (1.0 vs 1.0). Here the same comparison runs on the hard set
 * (eval/synthetic/retrieval-hard, plan W7.13: real HeQ test questions with
 * spelling, paraphrase and other changes, over 238 real HeQ paragraphs),
 * where BM25 is below 1.0.
 *
 * Measured: BM25 against the built-in lexical reranker. BM25 wins on both
 * splits, so the app's default is BM25 only ("off"), and this file pins the
 * default to the measured winner (coordinator decision, W10.B18). The model
 * reranker (bge-reranker-v2-m3) is NOT measured here; it needs the model
 * (Mac / `npm run eval:rerank`), and it may become the default only with a
 * Mac receipt that beats BM25 by ≥ 3 points on both splits.
 *
 * The set is synthetic (eval/origins.json; moved out of eval/golden by
 * #930, coordinator W7.13), so every eval card on it is `dev` only.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Bm25Index } from "../search/bm25";
import { DEFAULT_RERANK_MODE, RERANK_DEFAULT_EVIDENCE, getRerankMode, rerank, setRerankMode, type RerankMode } from "../ai/reranker";
// @ts-expect-error the harness is plain JavaScript
import { compareRerank, rerankDecision, modelDefaultAllowed, rerankCardInput, MODEL_DEFAULT_MIN_GAIN_POINTS, PUBLIC_MIN_GAIN_POINTS, PUBLIC_RERANK_SETS, RERANK_MAX_P95_MS } from "../../scripts/golden/evals/rerank.mjs";
// @ts-expect-error plain JavaScript
import { makeCard, validateCard } from "../../scripts/lib/evalCard.mjs";

// The model can't run in a unit test; this stands in for "no WebGPU / download refused / offline".
vi.mock("../ai/transformersEngine", () => ({
  rerankLocal: async () => {
    throw new Error("no WebGPU");
  },
}));

type Split = { items: Array<{ id: string; query: string; relevant: string[]; sameArticle?: string[] }>; corpus: Array<{ id: string; title: string; text: string }> };
type Res = { items: number; bm25: number; reranked: number; gain: number; perItem: { bm25: number[]; reranked: number[] } };
const HARD = "eval/synthetic/retrieval-hard";
const load = (f: string) => JSON.parse(readFileSync(join(__dirname, "../../eval/synthetic/retrieval-hard", f), "utf8")) as Split;
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
    const row = (part: string, bm25: number, reranked: number, p95Ms = 80) => ({ split: "eval/synthetic/retrieval-hard", part, items: 90, bm25, reranked, gain: Math.round((reranked - bm25) * 10000) / 100, p95Ms });
    const pub = (name: string, bm25: number, reranked: number, p95Ms = 90) => ({ split: `public/${name}`, part: name, items: 500, bm25, reranked, gain: Math.round((reranked - bm25) * 10000) / 100, p95Ms });
    const mac = { platform: "darwin", arch: "arm64", cpu: "Apple M1" };
    const publicRows = [pub("webfaq-heb", 0.61, 0.66), pub("belebele-heb", 0.7, 0.75)];
    const ok = { model: "onnx-community/bge-reranker-v2-m3-ONNX", machine: mac, rows: [row("dev", 0.9479, 0.98), row("heldout", 0.9521, 0.99), ...publicRows] };
    expect(modelDefaultAllowed(ok)).toEqual({ ok: true, why: "" });
    expect(modelDefaultAllowed(null).ok).toBe(false);
    expect(modelDefaultAllowed({ ...ok, machine: { ...mac, platform: "linux" } }).why).toMatch(/Mac/);
    expect(modelDefaultAllowed({ ...ok, rows: [row("dev", 0.9479, 0.98), row("heldout", 0.9521, 0.98), ...publicRows] }).why).toMatch(/heldout: gain 2\.79 < 3/);
    expect(modelDefaultAllowed({ ...ok, rows: [row("dev", 0.9479, 0.98)] }).why).toMatch(/no retrieval-hard heldout/);
    expect(modelDefaultAllowed({ ...ok, model: "some-other-model" }).ok).toBe(false);
  });

  it("W10.B18: and by ≥ 2 points on WebFAQ-heb and on Belebele, with a top-20 rerank p95 ≤ 150 ms on every row", () => {
    expect([PUBLIC_MIN_GAIN_POINTS, RERANK_MAX_P95_MS]).toEqual([2, 150]);
    expect(Object.keys(PUBLIC_RERANK_SETS)).toEqual(["webfaq-heb", "belebele-heb"]);
    const row = (part: string, p95Ms = 80) => ({ split: "eval/synthetic/retrieval-hard", part, items: 90, bm25: 0.95, reranked: 0.99, p95Ms });
    const pub = (name: string, bm25: number, reranked: number, p95Ms = 90) => ({ split: `public/${name}`, part: name, items: 500, bm25, reranked, p95Ms });
    const base = { model: "onnx-community/bge-reranker-v2-m3-ONNX", machine: { platform: "darwin" } };
    const hard = [row("dev"), row("heldout")];
    expect(modelDefaultAllowed({ ...base, rows: hard }).why).toBe("no public/webfaq-heb row (W10.B18: WebFAQ-heb and Belebele)");
    expect(modelDefaultAllowed({ ...base, rows: [...hard, pub("webfaq-heb", 0.6, 0.63)] }).why).toBe("no public/belebele-heb row (W10.B18: WebFAQ-heb and Belebele)");
    expect(modelDefaultAllowed({ ...base, rows: [...hard, pub("webfaq-heb", 0.6, 0.619), pub("belebele-heb", 0.7, 0.75)] }).why).toBe("public/webfaq-heb: gain 1.9 < 2 points");
    expect(modelDefaultAllowed({ ...base, rows: [...hard, pub("webfaq-heb", 0.6, 0.62), pub("belebele-heb", 0.7, 0.75, 151)] }).why).toBe("public/belebele-heb belebele-heb: top-20 rerank p95 151 ms > 150 ms");
    expect(modelDefaultAllowed({ ...base, rows: [row("dev"), { ...row("heldout"), p95Ms: undefined }, pub("webfaq-heb", 0.6, 0.62), pub("belebele-heb", 0.7, 0.75)] }).why).toBe("eval/synthetic/retrieval-hard heldout: no p95 latency");
    expect(modelDefaultAllowed({ ...base, rows: [...hard, pub("webfaq-heb", 0.6, 0.62), pub("belebele-heb", 0.7, 0.75, 150)] })).toEqual({ ok: true, why: "" });
  });

  it("compareRerank times every top-20 rerank and reports its p95", async () => {
    // Start and end stamps of the five reranks: 10, 20, 30, 40 and 200 ms.
    const stamps = [0, 10, 0, 20, 0, 30, 0, 40, 0, 200];
    let k = 0;
    const set = load("dev.json");
    const res = (await compareRerank(Bm25Index, async (_q: string, docs: Array<{ id: string; text: string }>) => docs, { items: set.items.slice(0, 5), documents: set.corpus, candidates: 20, now: () => stamps[k++] })) as Res & { p95Ms: number };
    expect(res.p95Ms).toBe(200);
    expect(res.gain).toBe(0);
  });
});

describe("a rerank card on the hard set is dev only: the set is synthetic (W7.13)", () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "../..", HARD, "manifest.json"), "utf8")) as { version: number; origin: string; license: string };
  it("the set's manifest says synthetic, and rerankCardInput tags its cards dev with origin synthetic", () => {
    expect(manifest.origin).toBe("synthetic");
    for (const split of SPLITS) {
      const res = measured[split];
      expect(res.perItem.bm25).toHaveLength(res.items);
      expect(res.perItem.reranked).toHaveLength(res.items);
      const input = rerankCardInput({ dir: HARD, part: split, manifest, model: { name: "lexical (lumen reranker)", digest: "none:lexical" }, result: res });
      expect(input).toMatchObject({ tag: "dev", dataset: { name: `synthetic/retrieval-hard/${split}`, origin: "synthetic", version: String(manifest.version) } });
      const card = makeCard(input);
      expect(validateCard(card)).toEqual([]);
      expect(card.n).toBe(res.items);
      expect(card.metrics.ndcg_at_10_reranked.value).toBeCloseTo(res.reranked, 3);
      expect(card.metrics.ndcg_at_10_bm25.value).toBeCloseTo(res.bm25, 3);
      // Claiming held-out on it is refused (validateCard's synthetic rule).
      expect(() => makeCard({ ...input, tag: "heldout" })).toThrow(/synthetic set is dev only/);
    }
  });

  it("a set under eval/synthetic is synthetic even when its manifest does not say so", () => {
    const res = measured.dev;
    expect(rerankCardInput({ dir: HARD, part: "dev", manifest: { version: 2 }, model: { name: "m", digest: "x" }, result: res }).dataset.origin).toBe("synthetic");
    expect(rerankCardInput({ dir: "eval/golden/retrieval/dev", part: "heq", manifest: { version: 3, license: "CC-BY-4.0" }, model: { name: "m", digest: "x" }, result: res })).toMatchObject({ tag: "dev", dataset: { name: "eval/golden/retrieval/dev/heq" } });
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
