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

/* ── One-shot overrides for the retry of a failed run ───────────────── */

/**
 * A patch picked in the panel applies once, to the run of the same agent
 * on the same input as the run that failed (`AgentRun.inputKey`): a
 * command that runs the agent several times (translation chunk by chunk)
 * re-runs the earlier inputs untouched — often from the cache — and the
 * patch waits for the input that failed. It expires after ten minutes.
 */
interface PendingPatch {
  patch: RetryPatch;
  inputKey?: string;
  expires: number;
}

const PATCH_TTL_MS = 10 * 60_000;
const nextPatch = new Map<string, PendingPatch>();

export function setNextRunPatch(agentId: string, patch: RetryPatch, inputKey?: string): void {
  const prev = nextPatch.get(agentId);
  const merged = prev && prev.inputKey === inputKey && prev.expires > Date.now() ? { ...prev.patch, ...patch } : patch;
  nextPatch.set(agentId, { patch: merged, inputKey, expires: Date.now() + PATCH_TTL_MS });
}

function pendingFor(agentId: string, inputKey?: string): PendingPatch | undefined {
  const p = nextPatch.get(agentId);
  if (!p) return undefined;
  if (p.expires <= Date.now()) {
    nextPatch.delete(agentId);
    return undefined;
  }
  return !p.inputKey || p.inputKey === inputKey ? p : undefined;
}

/** The executor a pending patch forces for this input, without consuming it. */
export function peekNextRunExecutor(agentId: string, inputKey?: string): ExecutorId | undefined {
  return pendingFor(agentId, inputKey)?.patch.executor;
}

/**
 * Consumed by the runtime once it has tried to pick an executor for the
 * matching input — also when that pick failed, so a forced executor that
 * is still offline does not stay forced.
 */
export function takeNextRunPatch(agentId: string, inputKey?: string): RetryPatch | undefined {
  const p = pendingFor(agentId, inputKey);
  if (!p) return undefined;
  nextPatch.delete(agentId);
  return p.patch;
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
  // T30: remember the choice; the re-run's outcome is recorded against it.
  const { noteSuggestionChosen } = await import("./outcomes");
  noteSuggestionChosen(s, run);
  switch (a.type) {
    case "retry":
      setNextRunPatch(run.agentId, a.patch, run.inputKey);
      return true;
    case "switch-executor":
      setNextRunPatch(run.agentId, { executor: a.executor as ExecutorId }, run.inputKey);
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
