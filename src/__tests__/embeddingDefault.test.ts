/**
 * Plan W7.13 (W10.E53): the embeddings competition changes the app's search
 * model, only through an ingested run.
 *
 * The competition reports here are SYNTHETIC: built in the shape
 * src/agents/eval/embedCompete.eval.ts writes ({ rows, decision }), with
 * made-up numbers; the real run is the Mac's. The ingest rules
 * (scripts/lib/embedIngest.mjs) and the provider (src/ai/embeddingProvider.ts)
 * are the shipped code; the transformers.js worker is the stand-in (the
 * model is the boundary).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = { aiKey: null as string | null };
vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => state } }));
vi.mock("../ai/ollamaProvider", () => ({ getBaseUrl: () => "http://localhost:11434", isOllamaAvailable: async () => false, listOllamaModels: async () => [] }));
const embedTextsLocal = vi.fn(async (texts: string[], _o?: { model?: string }) => ({ vectors: texts.map(() => Array.from({ length: 768 }, (_, i) => (i < 256 ? 1 : 5))), dims: 768 }));
vi.mock("../ai/transformersEngine", () => ({ embedTextsLocal: (t: string[], o?: { model?: string }) => embedTextsLocal(t, o) }));

// @ts-expect-error — plain .mjs module without type declarations
import { acceptEmbedRun, embedDefault, parseRowId, withMeasured } from "../../scripts/lib/embedIngest.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { makeCard } from "../../scripts/lib/evalCard.mjs";
import { measuredEmbedding, measuredProvider, pickEmbeddingProvider, truncateMatryoshka } from "../ai/embeddingProvider";

const manifest = JSON.parse(readFileSync("eval/models/embedding-candidates.json", "utf8"));
const verified = { ...manifest, candidates: manifest.candidates.map((c: { id: string }) => (c.id === "embeddinggemma-2" ? { ...c, licenseVerified: true, sha256: "a".repeat(64) } : c)) };
const row = (id: string, held: number) => ({ id, dev: { ndcg10: held - 0.01, recall20: 0.9, msPerQuery: 20, dims: 256, indexBytes: 1, items: 60 }, heldout: { ndcg10: held, recall20: 0.9, msPerQuery: 25, dims: 256, indexBytes: 1, items: 40 } });
// Review Z6-M5: only a run whose card is heldout or public (and not synthetic) changes the default. These reports
// carry a heldout card on a W6.17 sealed set (a synthetic stand-in); z6/embedIngestCard.test.ts covers dev cards.
const card = makeCard({ tag: "heldout", model: { name: "embeddinggemma-2", digest: "sha256:test" }, seed: 1, temperature: 0, dataset: { name: "heldout-retrieval-he", version: "1", license: "CC-BY-4.0" }, scores: { ndcg_at_10: [1, 0, 1] } });
const report = (winner: string, discriminates = true) => ({
  card,
  rows: [row("multilingual-e5-small", 0.61), row("embeddinggemma-2", 0.7), row("embeddinggemma-2@256", 0.69), row("qwen3-embedding-0.6b", 0.66)],
  decision: { discriminates, default: { id: winner, reason: "+8 nDCG@10 points on the held-out part, 25 ms per query at 10000 notes" }, reranker: null },
});

describe("taking a run (scripts/lib/embedIngest.mjs)", () => {
  it("row ids: a model, or a model at a Matryoshka size", () => {
    expect(parseRowId("embeddinggemma-2@256")).toEqual({ id: "embeddinggemma-2", dims: 256 });
    expect(parseRowId("multilingual-e5-small")).toEqual({ id: "multilingual-e5-small", dims: null });
  });

  it("refuses an incomplete or foreign run, with the reasons", () => {
    expect(acceptEmbedRun(null, manifest)).toEqual({ ok: false, reasons: ["not a JSON object"] });
    const bad = acceptEmbedRun({ rows: [{ id: "bge-m3", dev: {}, heldout: {} }, { ...row("multilingual-e5-small@64", 0.5) }], decision: {} }, manifest);
    expect(bad.ok).toBe(false);
    expect(bad.reasons).toEqual([
      "row 0: bge-m3 is not an embedding candidate in eval/models/embedding-candidates.json",
      "row 0: bge-m3 is not measured on both dev and held-out",
      "row 1: multilingual-e5-small has no Matryoshka size 64",
      "no decision.discriminates",
      "no decision.default with an id and a reason",
    ]);
    expect(acceptEmbedRun(report("embeddinggemma-2@256"), manifest)).toEqual({ ok: true, reasons: [] });
  });

  it("the winner becomes the app's model only when verified and hashed; otherwise the built-in model stays", () => {
    // Today's candidates file: no licence verified, no sha256 → nothing changes.
    expect(embedDefault(report("embeddinggemma-2@256"), manifest).entry).toBeNull();
    expect(embedDefault(report("embeddinggemma-2@256"), manifest).why).toContain("licence is not verified");
    const hashless = { ...verified, candidates: verified.candidates.map((c: { id: string }) => (c.id === "embeddinggemma-2" ? { ...c, sha256: null } : c)) };
    expect(embedDefault(report("embeddinggemma-2@256"), hashless).why).toContain("no sha256");
    // A set that does not separate the models changes nothing, whoever "won".
    expect(embedDefault(report("embeddinggemma-2@256", false), verified).entry).toBeNull();
    // The run kept the current model.
    expect(embedDefault(report("multilingual-e5-small"), verified).entry).toBeNull();
    // Verified, hashed, discriminating: the 256-dimension index of EmbeddingGemma.
    const { entry } = embedDefault(report("embeddinggemma-2@256"), verified, { file: "eval/results/embed-compete-2026-11-20.json", date: "2026-11-20" });
    expect(entry).toEqual({
      id: "embeddinggemma-2",
      hf: "onnx-community/embeddinggemma-2-ONNX",
      dtype: "q4",
      sha256: "a".repeat(64),
      dims: 256,
      prefix: { query: "task: search result | query: ", document: "title: none | text: " },
      measured: { file: "eval/results/embed-compete-2026-11-20.json", date: "2026-11-20", heldoutNdcg10: 0.69, msPerQuery: 25, reason: "+8 nDCG@10 points on the held-out part, 25 ms per query at 10000 notes" },
    });
    expect(Object.keys(withMeasured(manifest, report("x")).measured)).toEqual(["multilingual-e5-small", "embeddinggemma-2", "embeddinggemma-2@256", "qwen3-embedding-0.6b"]);
  });

  it("the CLI refuses a run that is not taken (exit 1) and only judges with --check", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-embed-ingest-"));
    try {
      const bad = join(dir, "embed-compete-2026-11-20.json");
      writeFileSync(bad, JSON.stringify({ rows: [] }));
      const r = spawnSync(process.execPath, ["scripts/eval/embed-ingest.mjs", "--file", bad, "--check"], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("is not taken");
      const good = join(dir, "embed-compete-2026-11-21.json");
      writeFileSync(good, JSON.stringify(report("embeddinggemma-2@256")));
      const ok = spawnSync(process.execPath, ["scripts/eval/embed-ingest.mjs", "--file", good, "--check"], { encoding: "utf8" });
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout).toContain("the built-in model stays (embeddinggemma-2 won, but its licence is not verified");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the app's provider (src/ai/embeddingProvider.ts)", () => {
  beforeEach(() => {
    localStorage.clear();
    embedTextsLocal.mockClear();
  });

  it("the committed embeddingDefault.json holds no winner yet: search stays on multilingual-e5-small", async () => {
    expect(JSON.parse(readFileSync("src/ai/embeddingDefault.json", "utf8")).default).toBeNull();
    expect(measuredEmbedding()).toBeNull();
    expect((await pickEmbeddingProvider()).id).toBe("transformers:Xenova/multilingual-e5-small");
  });

  it("Matryoshka: the first 256 values, renormalised to unit length", () => {
    const v = truncateMatryoshka([3, 4, 100, 100], 2);
    expect(Array.from(v).map((x) => Math.round(x * 100) / 100)).toEqual([0.6, 0.8]);
  });

  it("an ingested winner: its own model and prefixes, 256-dimension vectors, and an id that forces a rebuild", async () => {
    const m = measuredEmbedding(embedDefault(report("embeddinggemma-2@256"), verified).entry);
    expect(m).not.toBeNull();
    const p = measuredProvider(m!);
    expect(p.id).toBe("transformers:onnx-community/embeddinggemma-2-ONNX@256");
    expect(p.dims).toBe(256);
    const [q] = await p.embed(["מה זה?"], "query");
    expect(embedTextsLocal).toHaveBeenCalledWith(["task: search result | query: מה זה?"], { model: "onnx-community/embeddinggemma-2-ONNX" });
    expect(q.length).toBe(256);
    expect(Math.abs(q.reduce((s, x) => s + x * x, 0) - 1)).toBeLessThan(1e-5);
    await p.embed(["פסקה"], "passage");
    expect(embedTextsLocal).toHaveBeenLastCalledWith(["title: none | text: פסקה"], { model: "onnx-community/embeddinggemma-2-ONNX" });
    // A half-written entry is no winner.
    expect(measuredEmbedding({ hf: "x", dims: 256 })).toBeNull();
  });

  it("with a winner in embeddingDefault.json, search picks it (the transformers.js slot; Ollama and the cloud policy keep theirs)", async () => {
    const entry = embedDefault(report("embeddinggemma-2@256"), verified).entry;
    vi.resetModules();
    vi.doMock("../ai/embeddingDefault.json", () => ({ default: { about: "test", default: entry } }));
    const fresh = await import("../ai/embeddingProvider");
    expect((await fresh.pickEmbeddingProvider()).id).toBe("transformers:onnx-community/embeddinggemma-2-ONNX@256");
    vi.doUnmock("../ai/embeddingDefault.json");
  });
});
