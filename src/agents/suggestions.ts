/**
 * The improvement agent's hand-off to the user: when a command's agent run
 * ends without a usable answer, its suggestions are shown in the
 * suggestions panel (src/ui/AiSuggestionsPanel.tsx), and each suggestion
 * is an action that really runs — set the policy, pull a model, switch
 * executor, retry with a patch — after which the failed palette command
 * is run again.
 */

import type { AgentRun, ExecutorId, RetryPatch, Suggestion } from "./types";
import { AgentRunError } from "./runtime";

export interface SuggestionsEvent {
  run: AgentRun;
  /** Palette command to re-run after an action (the agent's command by default). */
  commandId?: string;
}

const listeners = new Set<(e: SuggestionsEvent) => void>();

export function onAgentSuggestions(fn: (e: SuggestionsEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function showAgentSuggestions(e: SuggestionsEvent): void {
  for (const l of listeners) l(e);
}

/**
 * For a command's catch block: an AgentRunError with suggestions opens the
 * panel (returns true, the caller stops); anything else returns false so
 * the caller shows its usual error.
 */
export function reportAgentFailure(e: unknown, commandId?: string): boolean {
  if (!(e instanceof AgentRunError) || !e.run) return false;
  if (e.run.status === "aborted") return true;
  if (!e.run.suggestions?.length && !listeners.size) return false;
  showAgentSuggestions({ run: e.run, commandId: commandId ?? e.run.commandId });
  return listeners.size > 0;
}

/* ── One-shot overrides for the next run of an agent ─────────────────── */

const nextPatch = new Map<string, RetryPatch>();

export function setNextRunPatch(agentId: string, patch: RetryPatch): void {
  nextPatch.set(agentId, { ...(nextPatch.get(agentId) ?? {}), ...patch });
}

/** The executor a pending patch forces, without consuming the patch. */
export function peekNextRunExecutor(agentId: string): ExecutorId | undefined {
  return nextPatch.get(agentId)?.executor;
}

/** Consumed by the runtime at the start of a run. */
export function takeNextRunPatch(agentId: string): RetryPatch | undefined {
  const p = nextPatch.get(agentId);
  nextPatch.delete(agentId);
  return p;
}

/** Ask the app to run a palette command again (App listens for this event). */
export function rerunCommand(commandId: string | undefined): void {
  if (!commandId || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: commandId } }));
}

export interface ActionContext {
  onProgress?: (text: string) => void;
}

/**
 * Carry out one suggestion. Returns whether the failed command should be
 * run again afterwards.
 */
export async function runSuggestion(s: Suggestion, run: AgentRun, ctx: ActionContext = {}): Promise<boolean> {
  const a = s.action;
  if (!a) return false;
  switch (a.type) {
    case "retry":
      setNextRunPatch(run.agentId, a.patch);
      return true;
    case "switch-executor":
      setNextRunPatch(run.agentId, { executor: a.executor as ExecutorId });
      return true;
    case "set-policy": {
      const { setAiPolicy } = await import("../ai/policy");
      setAiPolicy(a.policy);
      return true;
    }
    case "pull-model": {
      if (a.executor === "ollama") {
        const { pullOllamaModel } = await import("../ai/ollamaProvider");
        for await (const ev of pullOllamaModel(a.model)) {
          const pct = ev.total ? Math.round(((ev.completed ?? 0) / ev.total) * 100) : null;
          ctx.onProgress?.(pct === null ? ev.status : `${ev.status} ${pct}%`);
        }
        const { refreshOllama } = await import("./executors/ollama");
        await refreshOllama(true).catch(() => undefined);
        return true;
      }
      if (a.executor === "webllm") {
        const { loadWebLlmModel, onWebLlmProgress } = await import("../ai/webllmEngine");
        const off = onWebLlmProgress((p) => ctx.onProgress?.(`${Math.round(p.progress * 100)}% ${p.text}`));
        try {
          await loadWebLlmModel(a.model);
        } finally {
          off();
        }
        return true;
      }
      return false;
    }
    case "open-docs": {
      const { docsUrl } = await import("../lib/docsLinks");
      const key = a.key === "localAgents" || a.key === "localLlm" ? a.key : "localLlm";
      window.open(docsUrl(key), "_blank", "noopener");
      return false;
    }
    case "split-input":
      // The user picks a part: the commands work on the selection when there is one.
      return false;
  }
  return false;
}
