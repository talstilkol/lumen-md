/**
 * Plan W7.14 — the live structured-output conformance run on a real local
 * model: the same 5 schemas × 50 Hebrew inputs as the offline suite
 * (src/ai/structured/conformance.ts), through the app's own Ollama engine
 * (format: JSON schema). Start it with `npm run eval:structured` (it sets
 * LUMEN_EVAL_STRUCTURED=1).
 *
 *   LUMEN_EVAL_OLLAMA_URL   default http://localhost:11434
 *   LUMEN_EVAL_MODEL        default qwen2.5:7b (must be pulled)
 *   LUMEN_EVAL_OUT          report directory, default eval/results
 *
 * Target (W7.14): ≥ 98 % of the answers valid for their schema. The report
 * also carries the short-task score that the zero-download gate compares the
 * built-in model against (≥ 90 % of this score; the built-in half runs in
 * Chrome 148: conformance.ts → runGateEvalInBrowser()).
 */
import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../billing/aiQuota", () => ({ chargeAiCommandDispatch: vi.fn(), consumeAiPrompt: vi.fn(() => true), aiQuotaStatus: () => ({ allowed: true, limit: Infinity }), AiQuotaExceededError: class extends Error {} }));

import { executorEngine } from "../../ai/structured";
import { runConformance, scoreShortTasks } from "../../ai/structured/conformance";

const url = process.env.LUMEN_EVAL_OLLAMA_URL || "http://localhost:11434";
const model = process.env.LUMEN_EVAL_MODEL || "qwen2.5:7b";
const outDir = process.env.LUMEN_EVAL_OUT || "eval/results";

// skip-reason: an opt-in eval against a real local model (npm run eval:structured), not a unit test | task: W7.14 | until: 2027-05-16
describe.skipIf(!process.env.LUMEN_EVAL_STRUCTURED)(`structured output conformance — ${model} @ ${url}`, () => {
  it("5 schemas × 50 inputs: ≥ 98 % valid for the schema, and the report written", async () => {
    // privacy-ledger: Ollama of the eval harness: runs in Node (npm run eval), where no ledger is installed
    const tags = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch((e: Error) => e);
    expect(tags instanceof Error ? `Ollama unreachable at ${url}: ${tags.message}` : "ok").toBe("ok");
    localStorage.setItem("lumen.ollama.baseUrl", url);
    localStorage.setItem("lumen.ollama.model", model);
    localStorage.setItem("lumen.ai.policy", "local-only");

    const engine = executorEngine("ollama", async () => (await import("../executors/ollama")).ollamaExecutor);
    expect(await engine.available()).toBe(true);
    const t0 = Date.now();
    const report = await runConformance(engine);
    const shortScore = await scoreShortTasks(engine);
    const date = new Date().toISOString().slice(0, 10);
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `structured-${model.replace(/[^\w.-]+/g, "_")}-${date}.json`);
    writeFileSync(file, `${JSON.stringify({ task: "W7.14", engine: "ollama", model, url, date, seconds: Math.round((Date.now() - t0) / 1000), ...report, shortScore }, null, 2)}\n`);
    // hygiene-allow: the result line of a CLI eval run
    console.log(`structured output on ${model}: ${report.valid}/${report.total} valid (${(report.rate * 100).toFixed(1)} %), short-task score ${(shortScore * 100).toFixed(1)} % → ${file}`);
    expect(report.total).toBe(250);
    expect(report.rate).toBeGreaterThanOrEqual(0.98);
  });
});
