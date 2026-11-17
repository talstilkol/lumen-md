/**
 * Plan 7.6 — the model reranker (bge-reranker-v2-m3) measured on the
 * retrieval golden set: nDCG@10 of BM25 alone against BM25 + the model over
 * the same 20 candidates, and the plan's decision from the gain. Not part of
 * the normal test run; start it with `npm run eval:rerank` (it sets
 * LUMEN_EVAL_RERANK=1). The first run downloads the model (~570 MB, q8) from
 * Hugging Face into the transformers.js cache.
 *
 *   LUMEN_EVAL_RERANK_DIRS   comma-separated split folders with heq.json (and
 *                            belebele.json when built — the cross-lingual part,
 *                            plan 15.9), or dev.json / heldout.json (the hard
 *                            set, eval/synthetic/retrieval-hard); default: the
 *                            committed dev split
 *
 * Every row gets an eval card (makeCard via rerankCardInput), tagged `dev`:
 * committed splits are dev numbers, and the hard set is synthetic, so its
 * cards carry dataset.origin "synthetic" and can never back a ✅ (W7.13).
 *
 *   LUMEN_EVAL_RETRIEVAL_DIR the public sets fetched by scripts/retrieval/fetch.py
 *                            (default eval/public-data/retrieval): WebFAQ-heb and
 *                            Belebele heb_Hebr are measured too (W10.B18), each only
 *                            when its source.json shows the licence the plan accepts
 *                            and its files match the sha256 recorded at fetch
 *   LUMEN_EVAL_RERANK_MODEL  the cross-encoder to measure (the seam, crossEncoder.ts);
 *                            default the app's RERANK_MODEL
 *
 * Every row records the p95 time of one top-20 rerank. The JSON report
 * records the machine (platform, arch, CPU): it is the eval receipt
 * `modelDefaultAllowed` (scripts/golden/evals/rerank.mjs) reads before the
 * model may become the app's default (W10.B18): ≥ +3 points on both hard
 * splits, ≥ +2 on WebFAQ-heb and on Belebele, ≤ 150 ms p95.
 *   LUMEN_EVAL_OUT           report directory, default eval/results
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arch, cpus, platform } from "node:os";

import { Bm25Index } from "../../search/bm25";
import { RERANK_MODEL } from "../../ai/transformersEngine";
// @ts-expect-error the harness is plain JavaScript
import { PUBLIC_RERANK_SETS, beirToRerankSet, compareRerank, modelDefaultAllowed, publicSourceProblem, rerankCardInput, rerankDecision } from "../../../scripts/golden/evals/rerank.mjs";
// @ts-expect-error plain JavaScript
import { makeCard } from "../../../scripts/lib/evalCard.mjs";
import { rerankModelId, rerankWith, transformersCrossEncoder } from "../../../scripts/eval/lib/crossEncoder";
import { parseBeir } from "./retrievalPublic";

const dirs = (process.env.LUMEN_EVAL_RERANK_DIRS || "eval/golden/retrieval/dev").split(",").map((s) => s.trim()).filter(Boolean);
const outDir = process.env.LUMEN_EVAL_OUT || "eval/results";
const publicDir = process.env.LUMEN_EVAL_RETRIEVAL_DIR || "eval/public-data/retrieval";
const modelId = rerankModelId(process.env, RERANK_MODEL);

// skip-reason: an opt-in eval against a real reranker model (npm run eval:rerank), not a unit test | task: 7.3 | until: 2027-05-12
describe.skipIf(!process.env.LUMEN_EVAL_RERANK)(`reranker eval — ${modelId}`, () => {
  it("measures BM25 against BM25 + the model and writes the decision", async () => {
    const modelRerank = rerankWith(await transformersCrossEncoder(modelId));

    const rows: Array<{ split: string; part: string; items: number; bm25: number; reranked: number; gain: number; p95Ms: number; card: unknown }> = [];
    const manifestOf = (dir: string) => {
      for (const f of [join(dir, "manifest.json"), join(dir, "..", "manifest.json")]) if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")) as { version?: number; license?: string; origin?: string };
      return {};
    };
    // The weights are not pinned by sha256 here yet; the card says so instead of inventing a digest.
    const cardModel = { name: modelId, digest: `unpinned:hf:${modelId}@q8` };
    for (const dir of dirs) {
      for (const part of ["heq", "belebele", "dev", "heldout"]) {
        const file = join(dir, `${part}.json`);
        if (!existsSync(file)) continue;
        const set = JSON.parse(readFileSync(file, "utf8")) as { items: Array<{ query: string; relevant: string[]; sameArticle?: string[] }>; corpus: Array<{ id: string; title?: string; text: string }> };
        const { perItem, ...res } = await compareRerank(Bm25Index, modelRerank, { items: set.items, documents: set.corpus, candidates: 20 });
        const card = makeCard(rerankCardInput({ dir, part, manifest: manifestOf(dir), model: cardModel, result: { perItem } }));
        rows.push({ split: dir, part, ...res, card });
        // hygiene-allow: progress output of a CLI eval run
        console.log(`${dir} ${part}: ${res.items} queries — BM25 ${res.bm25}, + reranker ${res.reranked}, gain ${res.gain} points, p95 ${res.p95Ms} ms`);
      }
    }
    // W10.B18: the public sets, each only with an accepted licence and its fetch-time sha256.
    const skipped: string[] = [];
    for (const name of Object.keys(PUBLIC_RERANK_SETS)) {
      const d = join(publicDir, name);
      const read = (f: string) => readFileSync(join(d, f));
      const source = existsSync(join(d, "source.json")) ? (JSON.parse(read("source.json").toString("utf8")) as Record<string, unknown>) : null;
      const why = publicSourceProblem(name, source, (f: string) => (existsSync(join(d, f)) ? createHash("sha256").update(read(f)).digest("hex") : null));
      if (why) {
        skipped.push(why);
        continue;
      }
      const set = beirToRerankSet(parseBeir(name, { corpus: read("corpus.jsonl").toString("utf8"), queries: read("queries.jsonl").toString("utf8"), qrels: read("qrels.tsv").toString("utf8") }));
      const { perItem, ...res } = await compareRerank(Bm25Index, modelRerank, { items: set.items, documents: set.documents, candidates: 20 });
      const manifest = { version: source!.revision, license: String(source!.cardLicense).toUpperCase() };
      const card = makeCard(rerankCardInput({ dir: d, part: name, manifest, model: cardModel, result: { perItem } }));
      rows.push({ split: `public/${name}`, part: name, ...res, card });
      // hygiene-allow: progress output of a CLI eval run
      console.log(`public/${name}: ${res.items} queries — BM25 ${res.bm25}, + reranker ${res.reranked}, gain ${res.gain} points, p95 ${res.p95Ms} ms`);
    }
    expect(rows.length).toBeGreaterThan(0);
    const n = rows.reduce((a, r) => a + r.items, 0);
    const gain = rows.reduce((a, r) => a + r.gain * r.items, 0) / n;
    const decision = rerankDecision(gain);
    const date = new Date().toISOString().slice(0, 10);
    const machine = { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? "" };
    const allowed = modelDefaultAllowed({ model: modelId, machine, rows }) as { ok: boolean; why: string };
    mkdirSync(outDir, { recursive: true });
    const md = [
      `# Reranker eval — ${modelId}, ${date}`,
      "",
      `Gain over BM25 (nDCG@10, weighted by queries): **${gain.toFixed(2)} points** → decision: **${decision}** (plan 7.6: < 5 points → off by default or removed).`,
      `May become the app's default (W10.B18 rule, modelDefaultAllowed): **${allowed.ok ? "yes" : `no — ${allowed.why}`}**.`,
      ...(skipped.length ? ["", "Public sets not measured:", ...skipped.map((w) => `- ${w}`)] : []),
      "",
      "| split | part | queries | BM25 | + reranker | gain (points) | p95 top-20 (ms) |",
      "|---|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.split} | ${r.part} | ${r.items} | ${r.bm25} | ${r.reranked} | ${r.gain} | ${r.p95Ms} |`),
    ].join("\n");
    writeFileSync(join(outDir, `rerank-${date}.md`), md + "\n");
    writeFileSync(join(outDir, `rerank-${date}.json`), JSON.stringify({ card: (rows.find((r) => r.part === "heldout") ?? rows[0]).card, model: modelId, date, machine, gain, decision, defaultAllowed: allowed, skipped, rows }, null, 2));
    // hygiene-allow: tells the person running the eval where the report is
    console.log(`\nGain ${gain.toFixed(2)} points → ${decision}. Report: ${join(outDir, `rerank-${date}.md`)}`);
  }, 60 * 60 * 1000);
});
