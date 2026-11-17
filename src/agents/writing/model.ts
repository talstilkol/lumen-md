/**
 * The writing agents' only door to a model (plan W13.W1): a call through
 * the agent runtime (src/agents/runtime, which owns cancellation, the
 * guard, tracing and the AI-answer record) with
 *  - executors on this device only (Ollama, LM Studio, WebLLM) — the
 *    cloud executor is never in the list, so the runtime cannot fall back
 *    to it;
 *  - no tools at all ("no external tools"): the model reads the text in
 *    the prompt and answers, nothing else;
 *  - the caller's AbortSignal on every call.
 */
import type { AgentDefinition, AgentInput, ExecutorId, ModelTier } from "../types";

export const LOCAL_EXECUTORS: readonly ExecutorId[] = ["ollama", "lmstudio", "webllm"];

export interface ModelRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  tier?: ModelTier;
}

export interface ModelAnswer {
  text: string;
  /** The model that answered (for the suggestion's `model` field). */
  model: string;
}

/** A local model call. Tests pass a fake; the app passes `runtimeModel(agentId)`. */
export type LocalModel = (req: ModelRequest, signal: AbortSignal) => Promise<ModelAnswer>;

interface PromptInput extends AgentInput {
  system: string;
  user: string;
}

/** The runtime definition a writing agent's call runs as: local executors, no tools. */
export function writingDefinition(agentId: string, req: ModelRequest): AgentDefinition<PromptInput, string> {
  return {
    id: `writing.${agentId}`,
    description: `Writing agent ${agentId} (local, no tools)`,
    system: (i) => i.system,
    user: (i) => i.user,
    tools: [],
    executorPreference: [...LOCAL_EXECUTORS],
    // Audit r4 A2.13: a writing agent's text never leaves this computer, whatever the AI policy says.
    loopbackOnly: true,
    tier: req.tier ?? "small",
    temperature: req.temperature ?? 0.3,
    maxTokens: req.maxTokens ?? 700,
    maxSteps: 1,
    maxRetries: 1,
    cache: false,
    language: "input",
  };
}

/** The app's model door for one writing agent. */
export function runtimeModel(agentId: string): LocalModel {
  return async (req, signal) => {
    const { runAgent, AgentRunError } = await import("../runtime");
    const run = await runAgent(writingDefinition(agentId, req), { system: req.system, user: req.user, text: req.user }, { signal });
    if (run.status !== "ok" || typeof run.output !== "string") throw new AgentRunError(run, run.error ?? run.status);
    return { text: run.output, model: run.model ?? run.executor ?? "local" };
  };
}

/** `signal` that also aborts after `ms` (a ranking step must not hold the card back). */
export function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any && typeof AbortSignal.timeout === "function") return any([signal, AbortSignal.timeout(ms)]);
  const c = new AbortController();
  const t = setTimeout(() => c.abort(new DOMException("Timeout", "TimeoutError")), ms);
  signal.addEventListener("abort", () => (clearTimeout(t), c.abort(signal.reason)), { once: true });
  return c.signal;
}

/** The first JSON value in a model's answer (fenced or bare), or null. */
export function jsonIn<T = unknown>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  for (let end = body.length; end > start; end--) {
    const ch = body[end - 1];
    if (ch !== "}" && ch !== "]") continue;
    try {
      return JSON.parse(body.slice(start, end)) as T;
    } catch {
      /* why: not JSON up to here — try a shorter span */
    }
  }
  return null;
}
