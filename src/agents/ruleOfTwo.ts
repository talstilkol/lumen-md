/**
 * The Rule of Two in the agent runtime (plan 2.7, W11.I2) and the runtime
 * half of spotlighting and plan-then-execute (W11.I3). Moved out of
 * agents/runtime.ts so it stays under its max-lines baseline (W6.25);
 * runtime.ts calls these at the same points as before.
 *
 * A run that holds outside content ([A]) and the user's data ([B]) asks
 * the user, per call, before any write or network call ([C]). The privacy
 * log (`guardLog.ts`) records when a run first holds outside content and
 * every answer.
 */
import type { AgentTool, ExecutorMessage, NetworkConsentRequest, RunOptions, ToolCall } from "./types";

type Guard = typeof import("./untrusted");
let loaded: Guard | null = null;

// The injection guard (plan 2.7) loads with the first run: the runtime is on the startup path.
export const loadGuard = (): Promise<Guard> => import("./untrusted").then((g) => (loaded = g));

/** What the Rule of Two needs from a run's tool env (runtime.ts `ToolEnv`). */
export interface TaintEnv {
  taint: string[];
  consentUntrusted?: RunOptions["consentUntrusted"];
}

/** Ask the user about a write / network call in a run with untrusted content (plan 2.7). */
export async function approveUntrusted(env: TaintEnv, tool: AgentTool, args: Record<string, unknown>, network?: NetworkConsentRequest): Promise<boolean> {
  return (await loadGuard()).askUntrusted(env.consentUntrusted, { tool: tool.name, scope: tool.scope as "write" | "network", args, sources: [...env.taint], ...(network ? { network } : {}) });
}

/**
 * Plan 2.7: a change proposed while outside content is in the run waits
 * for the user's explicit yes before it is even staged. Plan W1.33: when
 * all of it comes from repositories the user trusts, the write is staged
 * without that question (still for review).
 */
export async function approveTaintedWrite(env: TaintEnv, tool: AgentTool, args: Record<string, unknown>): Promise<{ note: string; error?: undefined } | { error: string }> {
  const guard = await loadGuard();
  if (guard.taintIsTrusted(env.taint)) return { note: "no extra approval: the untrusted content comes only from repositories the user trusts" };
  if (!(await approveUntrusted(env, tool, args))) return { error: `denied: ${guard.UNTRUSTED_DENIED}` };
  return { note: "approved by the user (untrusted content in the run)" };
}

/**
 * W11.I3, plan-then-execute: the tools are fixed before the run reads anything. A copy, frozen,
 * so nothing the run reads (a page, a note, a tool that edits the definition) adds one.
 */
export function freezeTools<D extends { tools?: AgentTool[] }>(def: D): D {
  return { ...def, tools: def.tools ? (Object.freeze([...def.tools]) as AgentTool[]) : def.tools };
}

/** W11.I2: the privacy log shows when a run became tainted, and by what. */
export async function logTainted(guard: Guard, taint: string[]): Promise<void> {
  if (taint.length) await guard.logRuleOfTwo({ event: "tainted", sources: taint });
}

/** `guardToolResult` (outside content is cleaned, delimited, and taints the run); the first taint is logged (W11.I2). */
export async function guardUntrustedResult(guard: Guard, serialize: (v: unknown) => string, result: unknown, sources: string[], taint: string[], messages: ExecutorMessage[], signal?: AbortSignal): Promise<{ body: string; note: string }> {
  const wasClean = taint.length === 0;
  // W10.E66: the async guard, which also asks the injection classifier when one is registered.
  const out = await guard.guardToolResultAsync(serialize, result, sources, taint, messages, signal);
  if (wasClean) await logTainted(guard, taint);
  return out;
}

/** W11.I3: what streams to the user carries no data marks. */
export function unmarkDelta(taint: string[] | undefined, raw: string): string {
  return taint?.length && loaded ? loaded.unmarkData(raw) : raw;
}

/** W11.I3: the data marks of untrusted blocks never reach the user, a tool or the parsed output. */
export function unmarkReply<R extends { content: string; toolCalls?: ToolCall[] }>(guard: Guard, taint: string[], sent: R): R {
  return taint.length ? { ...sent, content: guard.unmarkData(sent.content), toolCalls: (sent.toolCalls ?? []).map((c) => ({ ...c, args: guard.unmarkValue(c.args) })) } : sent;
}
