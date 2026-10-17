/**
 * Agent runtime — runs an agent definition against the first available
 * executor, loops over tool calls, parses and validates the answer, and
 * when there is no usable answer asks the critic for a retry patch or
 * suggestions. Every run is recorded in the trace.
 *
 *   runAgent(def, input, opts) → AgentRun  (never throws for model/tool
 *   failures; `status` + `suggestions` say what happened)
 *   runAgentOrThrow(...)       → the output, or AgentRunError carrying the run
 */

import type {
  AgentDefinition,
  AgentInput,
  AgentRun,
  AgentStep,
  AgentTool,
  ExecutorMessage,
  ExecutorId,
  ModelTier,
  RetryPatch,
  RunOptions,
  ToolCall,
  ToolContext,
  ToolScope,
} from "./types";
import { DEFAULT_EXECUTOR_ORDER, getExecutor, listExecutors, pickExecutor } from "./executors";
import { parseProtocolTurn, toolProtocolPrompt, toolResultMessage } from "./protocol";
import { checkJson } from "./tools/validate";
import { ToolError } from "./tools/define";
import { review, type Failure } from "./critic";
import { recordRun } from "./trace";
import { AiQuotaExceededError, chargeAiCommandDispatch } from "../billing/aiQuota";

export const DEFAULT_MAX_STEPS = 8;
export const DEFAULT_MAX_RETRIES = 2;
const TOOL_RESULT_LIMIT = 16_000;

export class AgentRunError extends Error {
  constructor(
    public run: AgentRun,
    message: string,
  ) {
    super(message);
    this.name = "AgentRunError";
  }
}

let runSeq = 0;
const newRunId = () => `run_${Date.now().toString(36)}_${(++runSeq).toString(36)}`;

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (e instanceof DOMException && e.name === "AbortError") || (e as Error)?.name === "AbortError";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `… [${s.length - n} more chars]` : s;
}

async function execTool(tools: AgentTool[], call: ToolCall, ctx: ToolContext): Promise<{ result?: unknown; error?: string }> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { error: `Unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(", ")}` };
  if (tool.scope !== "read" && !ctx.grants.has(tool.scope)) return { error: `Tool "${call.name}" needs the "${tool.scope}" permission, which was not granted for this run` };
  try {
    return { result: await tool.run(call.args, ctx) };
  } catch (e) {
    if (e instanceof ToolError) return { error: `${e.code}: ${e.message}` };
    return { error: (e as Error)?.message ?? String(e) };
  }
}

function systemPrompt<I extends AgentInput, O>(def: AgentDefinition<I, O>, input: I, nativeTools: boolean, nativeSchema: boolean, patch: RetryPatch): string {
  const base = patch.systemOverride ?? (typeof def.system === "function" ? def.system(input) : def.system);
  const parts = [base];
  if (def.tools?.length && !nativeTools) parts.push(toolProtocolPrompt(def.tools, def.outputSchema));
  else if (def.outputSchema && !nativeSchema) parts.push("Reply with JSON only (no prose, no code fences) matching this schema: " + JSON.stringify(def.outputSchema));
  return parts.join("\n\n");
}

export async function runAgent<I extends AgentInput, O = string>(def: AgentDefinition<I, O>, input: I, opts: RunOptions = {}): Promise<AgentRun<O>> {
  const run: AgentRun<O> = {
    id: newRunId(),
    agentId: def.id,
    commandId: def.commandId,
    executor: null,
    model: null,
    startedAt: Date.now(),
    endedAt: 0,
    status: "failed",
    attempts: 0,
    steps: [],
    suggestions: [],
    tokens: { input: 0, output: 0, estimated: false },
  };
  const step = (st: Omit<AgentStep, "at">): void => {
    const full = { at: Date.now(), ...st };
    run.steps.push(full);
    opts.onStep?.(full);
  };
  const finish = async (status: AgentRun["status"], extra: Partial<AgentRun<O>> = {}): Promise<AgentRun<O>> => {
    Object.assign(run, extra, { status, endedAt: Date.now() });
    await recordRun(run as AgentRun);
    return run;
  };

  const grants = new Set<ToolScope>(["read", ...(opts.grants ?? [])]);
  const missing = (def.requires ?? []).filter((g) => !grants.has(g));
  if (missing.length) {
    return finish("failed", { errorCode: "denied", error: `Agent "${def.id}" needs permissions: ${missing.join(", ")}` });
  }
  const ctx: ToolContext = { signal: opts.signal, path: opts.path ?? input.path ?? null, document: opts.document ?? input.text, selection: opts.selection ?? input.selection, grants };
  const inputChars = (input.text ?? "").length + (input.selection ?? "").length;
  const maxRetries = def.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxSteps = def.maxSteps ?? DEFAULT_MAX_STEPS;
  const preference = def.executorPreference ?? DEFAULT_EXECUTOR_ORDER;

  let pick = await pickExecutor(preference, opts.executor);
  if (!pick.executor) {
    const verdict = await review({ kind: "no-executor", attempt: 1, maxRetries, tier: def.tier ?? "small", executor: null, skipped: pick.skipped, inputChars });
    step({ kind: "critic", ms: 0, label: verdict.diagnosis, ok: false, detail: pick.skipped.map((x) => `${x.id}: ${x.availability.reason ?? "unavailable"}`).join("; ") });
    return finish("failed", { errorCode: "no-executor", error: `No AI executor is available (${verdict.diagnosis})`, suggestions: verdict.suggestions });
  }
  let executor = pick.executor;
  let patch: RetryPatch = { ...(opts.patch ?? {}) };

  // One user action = one prompt against the monthly quota, however many
  // model calls, tools and retries the run takes. Executors run prepaid.
  try {
    chargeAiCommandDispatch();
  } catch (e) {
    if (e instanceof AiQuotaExceededError) return finish("failed", { errorCode: "quota", error: e.message });
    throw e;
  }

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    run.attempts = attempt;
    if (patch.executor && patch.executor !== executor.id) {
      const forced = getExecutor(patch.executor);
      if (forced && (await forced.available()).available) executor = forced;
    }
    run.executor = executor.id;
    const tier: ModelTier = patch.tier ?? def.tier ?? "small";
    const nativeTools = !!def.tools?.length && executor.supportsTools(patch.model);
    const nativeSchema = !!def.outputSchema && !def.tools?.length && executor.supportsSchema(patch.model);
    const messages: ExecutorMessage[] = [
      { role: "system", content: systemPrompt(def, input, nativeTools, nativeSchema, patch) },
      { role: "user", content: def.user(input) + (patch.promptSuffix ? `\n\n${patch.promptSuffix}` : "") },
    ];
    run.model = patch.model ?? executor.modelFor(tier);

    let failure: Failure | null = null;
    let finalText: string | null = null;

    try {
      for (let i = 0; i < maxSteps && finalText === null; i++) {
        if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
        const t0 = Date.now();
        const res = await executor.chat({
          messages,
          tools: nativeTools ? def.tools : undefined,
          schema: nativeSchema ? def.outputSchema : undefined,
          model: patch.model,
          tier,
          maxTokens: def.maxTokens,
          temperature: patch.temperature ?? def.temperature,
          signal: opts.signal,
          onDelta: def.streaming && !def.tools?.length ? opts.onDelta : undefined,
        });
        run.model = res.model || run.model;
        if (res.usage) {
          run.tokens.input += res.usage.inputTokens;
          run.tokens.output += res.usage.outputTokens;
          run.tokens.estimated ||= res.usage.estimated;
        }
        step({ kind: "model", ms: Date.now() - t0, label: res.model, ok: true, detail: res.toolCalls.length ? `${res.toolCalls.length} tool call(s)` : truncate(res.content, 200) });

        let calls: ToolCall[] = res.toolCalls;
        let assistantContent = res.content;
        if (!calls.length && def.tools?.length && !nativeTools) {
          const turn = parseProtocolTurn(res.content);
          if (turn.kind === "tool") {
            calls = [turn.call];
            assistantContent = "";
          } else {
            finalText = turn.content;
            break;
          }
        }
        if (!calls.length) {
          finalText = res.content;
          break;
        }
        messages.push({ role: "assistant", content: assistantContent, toolCalls: calls });
        for (const call of calls) {
          const t1 = Date.now();
          const r = await execTool(def.tools ?? [], call, ctx);
          const body = r.error !== undefined ? toolResultMessage(call, undefined, r.error) : truncate(toolResultMessage(call, r.result), TOOL_RESULT_LIMIT);
          step({ kind: "tool", ms: Date.now() - t1, label: call.name, ok: r.error === undefined, detail: r.error ?? truncate(JSON.stringify(call.args), 200) });
          messages.push({ role: "tool", content: body, toolCallId: call.id, name: call.name });
        }
      }
      if (finalText === null) {
        failure = { kind: "empty", attempt, maxRetries, tier, executor: executor.id, reason: `no final answer after ${maxSteps} steps`, inputChars };
      }
    } catch (e) {
      if (isAbort(e, opts.signal)) return finish("aborted", { errorCode: "aborted", error: "aborted" });
      const msg = (e as Error)?.message ?? String(e);
      step({ kind: "model", ms: 0, label: executor.id, ok: false, detail: truncate(msg, 300) });
      failure = { kind: "error", attempt, maxRetries, tier, executor: executor.id, reason: msg, inputChars };
    }

    if (!failure && finalText !== null) {
      let output: O | undefined;
      const text = finalText.trim();
      if (!text) {
        failure = { kind: "empty", attempt, maxRetries, tier, executor: executor.id, reason: "empty answer", inputChars };
      } else {
        try {
          if (def.parse) output = def.parse(text, input);
          else if (def.outputSchema) {
            const j = checkJson(text);
            if (!j.ok) throw new Error(j.error);
            output = j.value as O;
          } else output = text as unknown as O;
        } catch (e) {
          failure = { kind: "parse", attempt, maxRetries, tier, executor: executor.id, reason: (e as Error)?.message ?? "parse failed", hint: def.outputSchema ? "Reply with JSON only." : undefined, inputChars };
          step({ kind: "validate", ms: 0, label: "parse", ok: false, detail: failure.reason });
        }
      }
      if (!failure && output !== undefined) {
        for (const v of def.validators ?? []) {
          const t2 = Date.now();
          const r = await v.check(output, input);
          step({ kind: "validate", ms: Date.now() - t2, label: v.name, ok: r.ok, detail: r.ok ? undefined : r.reason });
          if (!r.ok) {
            failure = { kind: "validation", attempt, maxRetries, tier, executor: executor.id, label: v.name, reason: r.reason, hint: r.hint, inputChars };
            break;
          }
        }
      }
      if (!failure) return finish("ok", { output });
    }

    // No usable answer: ask the critic.
    const alternatives: ExecutorId[] = [];
    for (const ex of listExecutors()) {
      if (ex.id !== executor.id && preference.includes(ex.id) && (await ex.available()).available) alternatives.push(ex.id);
    }
    const verdict = await review({ ...failure!, alternatives });
    step({ kind: "critic", ms: 0, label: verdict.diagnosis, ok: !!verdict.retry, detail: failure!.reason });
    if (verdict.retry && attempt <= maxRetries) {
      patch = { ...patch, ...verdict.retry };
      step({ kind: "retry", ms: 0, label: `attempt ${attempt + 1}`, ok: true, detail: JSON.stringify({ tier: patch.tier, temperature: patch.temperature, executor: patch.executor }) });
      continue;
    }
    return finish("failed", { errorCode: failure!.kind, error: failure!.reason ?? failure!.kind, suggestions: verdict.suggestions });
  }
  return finish("failed", { errorCode: "error", error: "exhausted" });
}

/** The agent's output, or an `AgentRunError` that carries the run (status, error, suggestions). */
export async function runAgentOrThrow<I extends AgentInput, O = string>(def: AgentDefinition<I, O>, input: I, opts: RunOptions = {}): Promise<O> {
  const run = await runAgent(def, input, opts);
  if (run.status === "ok" && run.output !== undefined) return run.output;
  throw new AgentRunError(run as AgentRun, run.error ?? run.status);
}
