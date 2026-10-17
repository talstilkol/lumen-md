/**
 * Executor registry. Executors register themselves at import time; the
 * runtime asks for the first available one in the agent's preference
 * order. Default order: native Ollama, in-browser web-llm, then the
 * `chat()` adapter (which itself honours the AI policy).
 */

import type { Availability, Executor, ExecutorId } from "../types";
import { chatExecutor } from "./chatExecutor";
import { ollamaExecutor } from "./ollama";

const registry = new Map<ExecutorId, Executor>();

export const DEFAULT_EXECUTOR_ORDER: ExecutorId[] = ["ollama", "webllm", "chat"];

export function registerExecutor(executor: Executor): void {
  registry.set(executor.id, executor);
}

export function getExecutor(id: ExecutorId): Executor | undefined {
  return registry.get(id);
}

export function listExecutors(): Executor[] {
  return [...registry.values()];
}

/** Reset to the built-in set (tests). */
export function resetExecutors(): void {
  registry.clear();
  registerExecutor(ollamaExecutor);
  registerExecutor(chatExecutor);
}

export interface ExecutorPick {
  executor: Executor | null;
  /** Why each candidate was skipped, in order. */
  skipped: Array<{ id: ExecutorId; availability: Availability }>;
}

export async function pickExecutor(preference: ExecutorId[] = DEFAULT_EXECUTOR_ORDER, forced?: ExecutorId): Promise<ExecutorPick> {
  const order = forced ? [forced] : preference;
  const skipped: ExecutorPick["skipped"] = [];
  for (const id of order) {
    const ex = registry.get(id);
    if (!ex) {
      skipped.push({ id, availability: { available: false, reason: "not-registered" } });
      continue;
    }
    let a: Availability;
    try {
      a = await ex.available();
    } catch (e) {
      a = { available: false, reason: "error", detail: (e as Error)?.message };
    }
    if (a.available) return { executor: ex, skipped };
    skipped.push({ id, availability: a });
  }
  return { executor: null, skipped };
}

resetExecutors();
