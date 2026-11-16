/**
 * Pyodide through the analyst's run_python path (plan 6.15, 7.8, W10.E35):
 * analyse() with the app's sandboxed worker (runPython), two runs that must
 * agree. The programs are the set's hand-written reference programs
 * (scripts/golden/evals/data-analysis.reference.mjs), not a model's: this
 * measures the runtime and the sandbox (load, run, answer contract), not
 * the analyst agent.
 */
import { DEFAULT_PYTHON_TIMEOUT_MS } from "../../agents/python/limits";
import { runPython } from "../../agents/python/runner";
import type { BenchEngine } from "../types";

// agents/analyst.ts is loaded on use (its English is a lazy chunk, i18nLazyEnglish).
const analyst = () => import("../../agents/analyst");

const run = (code: string, inputs: Record<string, unknown>, signal?: AbortSignal) => runPython({ code, inputsJson: JSON.stringify(inputs), timeoutMs: DEFAULT_PYTHON_TIMEOUT_MS, signal });

export const engine: BenchEngine = {
  id: "pyodide",
  label: "Pyodide, the analyst's sandbox (reference programs)",
  set: "data-analysis",
  models: ["pyodide"],
  async load() {
    const r = await run("print(1 + 1)", {});
    if (!r.ok) throw new Error(`Pyodide did not start: ${r.error ?? "unknown"}`);
    return { device: "wasm", model: "pyodide" };
  },
  async run(item) {
    const { question, csv, code } = item.input as { question: string; csv: string; code: string };
    return (await (await analyst()).analyse(question, csv, { writeCode: async () => code, run })).answer.answer;
  },
};
