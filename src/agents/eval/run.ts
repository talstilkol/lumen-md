/** Run eval cases through the real agent runtime (MASTER_PLAN v2, E1). */

import "../defs";
import { getAgent } from "../registry";
import { runAgent } from "../runtime";
import type { ExecutorId } from "../types";
import type { EvalCase } from "./fixtures";
import { scoreCases, type CaseResult } from "./score";

export async function runEvalCase(c: EvalCase, opts: { executor?: ExecutorId; signal?: AbortSignal } = {}): Promise<CaseResult> {
  const def = getAgent(c.agent);
  if (!def) return { id: c.id, agent: c.agent, status: "failed", executor: null, model: null, attempts: 0, ms: 0, checks: [], error: `unknown agent ${c.agent}` };
  try {
    // Answers must come from the model, not from an earlier run's cache.
    localStorage.setItem("lumen.ai.cache", "off");
  } catch {
    /* storage denied */
  }
  const started = Date.now();
  const run = await runAgent(def, c.input, { executor: opts.executor, signal: opts.signal, document: c.input.text });
  const ms = Date.now() - started;
  const base = { id: c.id, agent: c.agent, executor: run.executor, model: run.model, attempts: run.attempts, ms };
  if (run.status !== "ok") return { ...base, status: "failed", checks: [], error: `${run.errorCode ?? "error"}: ${run.error ?? ""}`.trim() };
  return { ...base, status: "ok", checks: scoreCases(run.output, c.checks) };
}
