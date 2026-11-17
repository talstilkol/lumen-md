/**
 * Plan 6.11 — grounded local summaries against a real local model: the share
 * of the model's summary sentences that pass the automatic grounding check
 * (`quoteContained`) in their document, counted BEFORE anything is dropped.
 * Start it with `npm run eval:summarize` (it sets LUMEN_EVAL_SUMMARY=1).
 *
 *   LUMEN_EVAL_OLLAMA_URL      default http://localhost:11434
 *   LUMEN_EVAL_MODEL           default qwen2.5:7b (must be pulled); for Hebrew, DictaLM is used when installed
 *   LUMEN_EVAL_SUMMARY_DIRS    comma-separated split folders holding sotu.json
 *                              (default: the committed dev split; add the test
 *                              split built with the golden seed for all 20)
 *   LUMEN_EVAL_OUT             report directory, default eval/results
 *
 * Target (plan 6.11): ≥ 95 % of the sentences grounded. Key-word coverage and
 * ROUGE-L / ROUGE-Lsum F1 against each item's reference (W10.C9, rouge.ts)
 * are reported as further signals.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../billing/aiQuota", () => ({ chargeAiCommandDispatch: vi.fn(), consumeAiPrompt: vi.fn(() => true), aiQuotaStatus: () => ({ allowed: true, limit: Infinity }), AiQuotaExceededError: class extends Error {} }));

import { summarize } from "../../ai/summarize";
import { loadSplit, scoreSummary, summaryMarkdown, summaryTotals, type SummaryRow } from "../../../scripts/eval/lib/summaryReport";

const url = process.env.LUMEN_EVAL_OLLAMA_URL || "http://localhost:11434";
const model = process.env.LUMEN_EVAL_MODEL || "qwen2.5:7b";
const dirs = (process.env.LUMEN_EVAL_SUMMARY_DIRS || "eval/golden/summarize/dev").split(",").map((s) => s.trim()).filter(Boolean);
const outDir = process.env.LUMEN_EVAL_OUT || "eval/results";

// skip-reason: an opt-in eval against a real local model (npm run eval:summarize), not a unit test | task: 7.3 | until: 2027-05-12
describe.skipIf(!process.env.LUMEN_EVAL_SUMMARY)(`summary eval — ${model} @ ${url}`, () => {
  it("summarises every document and writes the report", async () => {
    // privacy-ledger: Ollama/SearXNG of the eval harness: runs in Node (npm run eval), where no ledger is installed
    const tags = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch((e: Error) => e);
    expect(tags instanceof Error ? `Ollama unreachable at ${url}: ${tags.message}` : "ok").toBe("ok");
    localStorage.setItem("lumen.ollama.baseUrl", url);
    localStorage.setItem("lumen.ollama.model", model);
    localStorage.setItem("lumen.ai.policy", "local-only");

    const rows: SummaryRow[] = [];
    for (const dir of dirs) {
      for (const item of loadSplit(dir)) {
        const t0 = Date.now();
        const r = await summarize(item.document, { noChrome: true, sentences: 3 });
        const sc = scoreSummary(item, r.sentences.join(" "));
        rows.push({ id: item.id, engine: r.engine, produced: r.sentences.length + r.dropped, grounded: r.sentences.length, ...sc, ms: Date.now() - t0 });
        const x = rows[rows.length - 1];
        // hygiene-allow: progress output of a CLI eval run
        console.log(`${x.id}  ${x.engine}  grounded ${x.grounded}/${x.produced}  key words ${x.keywords}  ROUGE-L ${x.rougeL?.toFixed(3) ?? "—"}  ${(x.ms / 1000).toFixed(1)} s`);
      }
    }
    const totals = summaryTotals(rows);
    const { grounded, produced, groundedShare: share } = totals;
    const date = new Date().toISOString().slice(0, 10);
    const slug = model.replace(/[^\w.-]+/g, "_");
    mkdirSync(outDir, { recursive: true });
    const md = summaryMarkdown(model, date, rows);
    writeFileSync(join(outDir, `summary-${date}-${slug}.md`), md + "\n");
    writeFileSync(join(outDir, `summary-${date}-${slug}.json`), JSON.stringify({ model, url, date, grounded, produced, rougeL: totals.rougeL, rougeLsum: totals.rougeLsum, rows }, null, 2));
    // hygiene-allow: tells the person running the eval where the report is
    console.log(`\nGrounded ${grounded}/${produced} (${(share * 100).toFixed(1)} %), ROUGE-L ${totals.rougeL?.toFixed(3) ?? "—"}. Report: ${join(outDir, `summary-${date}-${slug}.md`)}`);
  }, 60 * 60 * 1000);
});
