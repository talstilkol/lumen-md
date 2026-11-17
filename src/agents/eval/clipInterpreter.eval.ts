/**
 * Plan W2.14 — the clip interpreter against a real local model, on the 20
 * golden pages (src/__tests__/fixtures/clip-interpreter/pages.ts). Start it
 * with `npm run eval:clip-interpreter` (it sets LUMEN_EVAL_CLIP=1).
 *
 *   LUMEN_EVAL_OLLAMA_URL   default http://localhost:11434
 *   LUMEN_EVAL_MODEL        default qwen2.5:3b (the 3B model of the acceptance; must be pulled)
 *   LUMEN_EVAL_OUT          report directory, default eval/results
 *
 * The model is reached the way the app reaches it: localInterpreter() picks
 * Ollama at a local address and runs the clip-interpreter agent through the
 * agent runtime, forced to the local executor, with an AbortSignal.
 *
 * Gates (clipInterpreterScore.ts): ≥ 85 % of all fields and of the prompt
 * fields right, every clip < 10 s, 0 requests off the device. The report is
 * written either way; the test fails when a gate fails.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../billing/aiQuota", () => ({ chargeAiCommandDispatch: vi.fn(), consumeAiPrompt: vi.fn(() => true), aiQuotaStatus: () => ({ allowed: true, limit: Infinity }), AiQuotaExceededError: class extends Error {} }));

import { localInterpreter } from "../../research/clipInterpreter";
import { PAGES } from "../../__tests__/fixtures/clip-interpreter/pages";
import { runClipEval } from "../../../scripts/eval/lib/clipInterpreterRun";
import { clipEvalMarkdown, summarizeClipEval } from "../../../scripts/eval/lib/clipInterpreterScore";

const url = process.env.LUMEN_EVAL_OLLAMA_URL || "http://localhost:11434";
const model = process.env.LUMEN_EVAL_MODEL || "qwen2.5:3b";
const outDir = process.env.LUMEN_EVAL_OUT || "eval/results";

// skip-reason: an opt-in eval against a real local model (npm run eval:clip-interpreter), not a unit test | task: W2.14 | until: 2027-05-12
describe.skipIf(!process.env.LUMEN_EVAL_CLIP)(`clip interpreter eval — ${model} @ ${url}`, () => {
  it("clips the 20 golden pages with the local model and writes the report", async () => {
    // privacy-ledger: Ollama of the eval harness: runs in Node (npm run eval), where no ledger is installed
    const tags = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch((e: Error) => e);
    expect(tags instanceof Error ? `Ollama unreachable at ${url}: ${tags.message}` : "ok").toBe("ok");
    localStorage.setItem("lumen.ollama.baseUrl", url);
    localStorage.setItem("lumen.ollama.model", model);
    localStorage.setItem("lumen.ai.policy", "local-only");
    const ask = await localInterpreter();
    expect(ask ? "ok" : "localInterpreter() found no local model", "the app's own route to the model").toBe("ok");

    const ac = new AbortController();
    const run = await runClipEval(PAGES, ask!, { signal: ac.signal });
    const s = summarizeClipEval(run.results, run.requests);
    const date = new Date().toISOString().slice(0, 10);
    const slug = model.replace(/[^\w.-]+/g, "_");
    mkdirSync(outDir, { recursive: true });
    const md = clipEvalMarkdown(model, date, s) + (run.unanswered.length ? `\n\n## Not answered by the model\n\n${run.unanswered.map((u) => `- ${u}`).join("\n")}\n` : "\n");
    writeFileSync(join(outDir, `clip-interpreter-${date}-${slug}.md`), md);
    writeFileSync(join(outDir, `clip-interpreter-${date}-${slug}.json`), JSON.stringify({ model, url, date, ...s, unanswered: run.unanswered, results: run.results }, null, 2));
    // hygiene-allow: tells the person running the eval where the report is
    console.log(`\n${s.pass ? "PASS" : "FAIL"}: fields ${s.fieldsRight}/${s.fields}, prompt fields ${s.modelRight}/${s.modelFields}, max ${(s.msMax / 1000).toFixed(1)} s, off-device ${s.offDevice.length}. Report: ${join(outDir, `clip-interpreter-${date}-${slug}.md`)}`);
    expect(s.reasons).toEqual([]);
  }, 30 * 60 * 1000);
});
