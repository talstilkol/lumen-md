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

import type { AgentDefinition, AgentInput, AgentRun, AgentStep, Executor, ExecutorMessage, ExecutorId, ExecutorRequest, ExecutorResponse, ModelTier, RetryPatch, RunOptions, ToolCall, ToolContext, ToolScope } from "./types";
import { DEFAULT_EXECUTOR_ORDER, getExecutor, listExecutors, measuredModel, pickExecutor } from "./executors";
import { parseProtocolTurn, protocolSchema, toolResultMessage } from "./protocol";
import { repairCall, retryMessage } from "./toolRepair";
import { checkJson } from "./tools/validate";
import { formatSchemaErrors, validateSchema } from "./schema";
import { ToolError } from "./tools/define";
import { review, type Failure } from "./critic";
import { recordRun } from "./trace";
import { currentDocumentKey } from "./docKey";
import { noteAiOutput } from "../ai/authorship";
import { AiQuotaExceededError, aiQuotaStatus, chargeAiCommandDispatch, consumeAiPrompt } from "../billing/aiQuota";
import { mergeOutputs, splitText } from "./runtimeText";
import { freezeTools, guardUntrustedResult, loadGuard, logTainted, unmarkDelta, unmarkReply } from "./ruleOfTwo";
import { createRunGuard, stops, type GuardVerdict } from "./runGuard";
import { safeModeBlocks } from "../boot/bootSentinel";
import { isAbort, truncate, type ToolEnv, execTool, modelTools, systemPrompt, inputTextOf, languageMode, sameLanguage, inputKeyOf } from "./runtimeSteps";
export { sameScript, sameLanguage, inputKeyOf } from "./runtimeSteps";
export { mergeOutputs, splitText } from "./runtimeText";

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


export async function runAgent<I extends AgentInput, O = string>(def: AgentDefinition<I, O>, input: I, opts: RunOptions = {}): Promise<AgentRun<O>> {
  def = freezeTools(def); // W11.I3, plan-then-execute: the run's tools are fixed before it reads anything.
  // Before anything awaits: the document the caller just read is the active one now.
  const docKey = opts.docKey ?? currentDocumentKey();
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
    inputKey: inputKeyOf(def, input),
  };
  const step = (st: Omit<AgentStep, "at">): void => {
    const full = { at: Date.now(), ...st };
    run.steps.push(full);
    opts.onStep?.(full);
  };
  const staged: string[] = [];
  // A streamed answer is marked as it arrives, piece by piece (plan 5.9).
  let streamed = "";
  const onDelta = opts.onDelta
    ? (raw: string) => {
        const d = unmarkDelta(toolEnvRef.current?.taint, raw); // W11.I3: no data marks reach the user.
        streamed += d;
        noteAiOutput(run.id, streamed);
        opts.onDelta?.(d);
      }
    : undefined;
  const toolEnvRef: { current: ToolEnv | null } = { current: null };
  const finish = async (status: AgentRun["status"], extra: Partial<AgentRun<O>> = {}): Promise<AgentRun<O>> => {
    Object.assign(run, extra, { status, endedAt: Date.now() });
    // Plan 5.9: the editor marks this answer where it lands in a note.
    if (status === "ok") noteAiOutput(run.id, run.output);
    if (toolEnvRef.current?.taint.length) run.untrusted = [...toolEnvRef.current.taint];
    if (staged.length) {
      run.staged = [...staged];
      // A cancelled run withdraws what it proposed; any other run leaves its proposals for review.
      if (status === "aborted") await import("./staging").then((m) => m.discardRunChanges(run.id)).catch(() => 0);
    }
    await recordRun(run as AgentRun);
    // 5.6.3: the answer can be marked "not good"; a re-done run closes its loop.
    if (!opts.part) {
      const sug = await import("./suggestions");
      if (run.retryOf) sug.noteRetried(run.retryOf, run.id);
      if (status === "ok") sug.announceAnswer({ run: run as AgentRun, commandId: run.commandId });
    }
    // T30: if this run follows a suggestion the user picked, learn from it.
    await import("./outcomes").then((m) => m.noteRunOutcome(run as AgentRun)).catch(() => undefined);
    return run;
  };

  // W13.T5: safe mode runs no agent (and none after leaving it with agents kept off).
  if (safeModeBlocks("agent")) return finish("failed", { errorCode: "safe-mode", error: "safe mode: AI agents are off" });
  const grants = new Set<ToolScope>(["read", ...(opts.grants ?? [])]);
  const missing = (def.requires ?? []).filter((g) => !grants.has(g));
  if (missing.length) {
    return finish("failed", { errorCode: "denied", error: `Agent "${def.id}" needs permissions: ${missing.join(", ")}` });
  }
  const ctx: ToolContext = {
    signal: opts.signal,
    path: opts.path ?? input.path ?? null,
    document: opts.document ?? input.text,
    selection: opts.selection ?? input.selection,
    grants,
    pages: opts.pages ?? new Map(),
  };
  // Plan 2.7: outside content in the input (a clipped page, an imported or
  // pulled note, or what the caller says is untrusted) is cleaned and
  // delimited before the model sees it, and taints the run from the start.
  const guard = await loadGuard();
  const inputUntrusted = await guard.inputSources({ path: ctx.path, document: ctx.document, text: input.text, selection: input.selection, untrusted: opts.untrusted });
  if (inputUntrusted.length) ctx.documentUntrusted = inputUntrusted;
  const toolEnv: ToolEnv = {
    ctx,
    runId: run.id,
    agentId: def.id,
    docKey,
    consent: opts.consentNetwork,
    staged,
    // Outside tools (MCP servers, review 21 C1): offering them already puts outside text in the context.
    taint: [...inputUntrusted, ...new Set((def.tools ?? []).flatMap((t) => t.offeredBy ?? []))],
    // What the run was given is the user's own, unless the user asked for it to go out (a research question).
    private: !opts.inputMayLeave && !!(ctx.document || ctx.selection || input.text),
    consentUntrusted: opts.consentUntrusted,
  };
  const modelInput: I = await guard.guardInputAsync(input, inputUntrusted, ctx.document, opts.signal);
  toolEnvRef.current = toolEnv;
  await logTainted(guard, toolEnv.taint); // W11.I2: the privacy log shows when a run became tainted.
  const inputChars = (input.text ?? "").length + (input.selection ?? "").length;
  const maxRetries = def.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxSteps = def.maxSteps ?? DEFAULT_MAX_STEPS;
  const preference = def.executorPreference ?? DEFAULT_EXECUTOR_ORDER;

  // A suggestion the user picked for this agent and this input (suggestions panel) applies once.
  const { peekNextRunExecutor, takeNextRunPatch, retryOfPending } = await import("./suggestions");
  const pendingExecutor = peekNextRunExecutor(def.id, run.inputKey);
  // An agent that names its executors runs only on those: a forced one (option,
  // suggestion or critic patch) outside the list is ignored (W2.18: the canvas
  // "draw me" stays on this device's models).
  const allowedExecutor = (id: ExecutorId | undefined) => (id && (!def.executorPreference || def.executorPreference.includes(id)) ? id : undefined);
  let pick = await pickExecutor(preference, allowedExecutor(opts.executor ?? pendingExecutor));
  // "Not good" (5.6.3): this run re-does one the user rejected; the trace links them.
  const redo = retryOfPending(def.id, run.inputKey);
  if (redo) run.retryOf = redo;
  const pending = takeNextRunPatch(def.id, run.inputKey);
  if (!pick.executor) {
    const verdict = await review({ kind: "no-executor", attempt: 1, maxRetries, tier: def.tier ?? "small", executor: null, skipped: pick.skipped, inputChars, splittable: !!def.splittable });
    step({ kind: "critic", ms: 0, label: verdict.diagnosis, ok: false, detail: pick.skipped.map((x) => `${x.id}: ${x.availability.reason ?? "unavailable"}`).join("; ") });
    return finish("failed", { errorCode: "no-executor", error: `No AI executor is available (${verdict.diagnosis})`, suggestions: verdict.suggestions });
  }
  let executor = pick.executor;
  let patch: RetryPatch = { ...(pending ?? {}), ...(opts.patch ?? {}) };
  // The AI mode is read once per run (plan 5.7): switching it in the
  // settings changes the local model of the next run, never of one under
  // way. A retry patch's tier is explicit and is not shifted again.
  const { getAiMode, tierForMode } = await import("../ai/aiMode");
  const mode = getAiMode();
  const tierOf = (id: ExecutorId): ModelTier => (id === "chat" ? def.tier ?? "small" : tierForMode(def.tier ?? "small", mode));

  // "Split the document" (5.6.2): the agent runs on each part, and the answers are merged.
  if (patch.split && def.splittable && (input.text ?? "").length > patch.split) {
    const { split, ...rest } = patch;
    const parts = splitText(input.text ?? "", split);
    const outputs: O[] = [];
    for (const [i, part] of parts.entries()) {
      if (opts.signal?.aborted) return finish("aborted", { errorCode: "aborted", error: "aborted" });
      const sub = await runAgent(def, { ...input, text: part } as I, { ...opts, signal: opts.signal, patch: rest, document: part, selection: undefined, executor: executor.id, part: true });
      run.tokens.input += sub.tokens.input;
      run.tokens.output += sub.tokens.output;
      run.attempts = Math.max(run.attempts, sub.attempts);
      run.executor = sub.executor;
      run.model = sub.model;
      step({ kind: "model", ms: sub.endedAt - sub.startedAt, label: `part ${i + 1}/${parts.length}`, ok: sub.status === "ok", detail: sub.status === "ok" ? `${part.length} chars` : sub.error });
      if (sub.status !== "ok" || sub.output === undefined) return finish(sub.status === "aborted" ? "aborted" : "failed", { errorCode: sub.errorCode ?? "error", error: `part ${i + 1}/${parts.length}: ${sub.error ?? sub.status}`, suggestions: sub.suggestions });
      outputs.push(sub.output);
    }
    return finish("ok", { output: mergeOutputs(outputs) });
  }

  // The context the agent always needs, fetched once through the tool path
  // (plan 5.3); every attempt starts from it. Before the cache lookup: an
  // answer is only reused for the same context (the same tags, the same
  // note list), not just the same prompt.
  const context: ExecutorMessage[] = [];
  for (const [i, c] of (def.context?.(input) ?? []).entries()) {
    if (opts.signal?.aborted) return finish("aborted", { errorCode: "aborted", error: "aborted" });
    const call: ToolCall = { id: `ctx_${run.id}_${i}`, name: c.tool, args: c.args ?? {} };
    const t1 = Date.now();
    let r: Awaited<ReturnType<typeof execTool>>;
    try {
      r = await execTool(def.tools ?? [], call, toolEnv);
    } catch (e) {
      if (isAbort(e, opts.signal)) return finish("aborted", { errorCode: "aborted", error: "aborted" });
      throw e;
    }
    let body: string;
    let guardNote = "";
    if (r.error !== undefined) body = toolResultMessage(call, undefined, r.error);
    else if (r.untrusted?.length) {
      // Plan 2.7: context from outside notes is cleaned and delimited, and taints the run
      // (the system prompt, built after this loop, then carries the rule).
      ({ body, note: guardNote } = await guardUntrustedResult(guard, (v) => truncate(toolResultMessage(call, v), TOOL_RESULT_LIMIT), r.result, r.untrusted, toolEnv.taint, [], opts.signal));
    } else body = truncate(toolResultMessage(call, r.result), TOOL_RESULT_LIMIT);
    step({ kind: "tool", ms: Date.now() - t1, label: call.name, ok: r.error === undefined, detail: ["context", guardNote, r.error ?? truncate(JSON.stringify(call.args), 200)].filter(Boolean).join(" · ") });
    context.push({ role: "assistant", content: "", toolCalls: [call] }, { role: "tool", content: body, toolCallId: call.id, name: call.name });
  }


  // A cached, already-validated answer costs nothing: no prompt, no model.
  const cacheKeyOf = async (): Promise<string | null> => {
    if (!def.cache) return null;
    const { aiCacheEnabled, cacheKey } = await import("../ai/responseCache");
    if (!aiCacheEnabled()) return null;
    const sys = typeof def.system === "function" ? def.system(input) : def.system;
    // v3: answers cached before the language check (T27) are not reused.
    const ctx = context.filter((m) => m.role === "tool").map((m) => m.content);
    return cacheKey({ v: 3, agent: def.id, executor: executor.id, model: executor.modelFor(patch.tier ?? tierOf(executor.id)), sys, user: def.user(input), patch, ...(ctx.length ? { context: ctx } : {}) }).catch(() => null);
  };
  // A run with outside content in its input or context is never cached (nor answered from the cache).
  const key = toolEnv.taint.length ? null : await cacheKeyOf();
  if (key) {
    const { getCached } = await import("../ai/responseCache");
    const hit = await getCached(key);
    if (hit) {
      let output: O | undefined;
      try {
        output = (def.outputSchema || !def.parse ? JSON.parse(hit.text) : def.parse(hit.text, input)) as O;
      } catch {
        output = undefined;
      }
      // A cached answer passes the same language check as a fresh one.
      if (output !== undefined && languageMode(def, input) === "input" && !(await sameLanguage(inputTextOf(def, input), output)).ok) output = undefined;
      if (output !== undefined) {
        step({ kind: "cache", ms: 0, label: "hit", ok: true });
        return finish("ok", { output, model: hit.model, executor: executor.id });
      }
    }
  }

  // One user action = one prompt against the monthly quota, however many
  // model calls, tools and retries the run takes. It is charged right before
  // the first request actually goes out — the chat adapter defers it past
  // its own key / rate-limit checks — so a run that fails locally (or is
  // cancelled first) spends nothing. At the limit nothing goes out at all.
  // A batch job paid for the whole job when it was submitted (`prepaid`).
  let charged = !!opts.prepaid;
  const chargeOnce = (): void => {
    if (charged) return;
    if (opts.ownPrompt) {
      if (!consumeAiPrompt(new Date(), { silent: opts.ownPrompt === "silent" })) throw new AiQuotaExceededError(aiQuotaStatus(new Date()).limit);
    } else chargeAiCommandDispatch();
    charged = true;
  };
  if (!charged && !aiQuotaStatus(new Date()).allowed) {
    try {
      chargeOnce();
    } catch (e) {
      if (e instanceof AiQuotaExceededError) return finish("failed", { errorCode: "quota", error: e.message });
      throw e;
    }
  }

  // One more attempt when the model critic diagnosed the failure and proposed its own retry (5.6.1).
  let modelRetryUsed = false;
  for (let attempt = 1; attempt <= maxRetries + 1 + (modelRetryUsed ? 1 : 0); attempt++) {
    run.attempts = attempt;
    if (patch.executor && patch.executor !== executor.id && allowedExecutor(patch.executor)) {
      const forced = getExecutor(patch.executor);
      if (forced && (await forced.available()).available) executor = forced;
    }
    run.executor = executor.id;
    const tier: ModelTier = patch.tier ?? tierOf(executor.id);
    // The model (an agent's measured default first, plan 7.9) is resolved once here and pinned on the
    // request, so the capability decision (native tools / schema) and the call agree.
    const offered = modelTools(def);
    const model = patch.model ?? measuredModel(def.id, executor.id) ?? executor.modelFor(tier, { tools: offered.length > 0 });
    // Small models get every turn held to a JSON Schema where the executor can
    // (5.3.5): JSON-ReAct under the protocol's schema is more reliable for
    // them than free-form native tool calls, whose arguments and final answer
    // are not constrained. Every local model is small next to a cloud one, so
    // a local executor constrains at every tier (plan W4.31: Ollama's
    // structured outputs on every tool call); cloud models above "small" use
    // native tools when they have them.
    const constrain = (executor.id !== "chat" || tier === "tiny" || tier === "small") && executor.supportsSchema(model);
    const nativeTools = offered.length > 0 && !constrain && executor.supportsTools(model);
    const nativeSchema = !!def.outputSchema && !offered.length && executor.supportsSchema(model);
    // A model without native tools speaks JSON-ReAct; where the executor can
    // constrain output, every turn is held to the protocol's schema (5.3.5).
    const turnSchema = offered.length && !nativeTools && executor.supportsSchema(model) ? protocolSchema(offered, def.outputSchema) : undefined;
    const messages: ExecutorMessage[] = [
      { role: "system", content: systemPrompt(def, modelInput, nativeTools, patch) + (toolEnv.taint.length ? `\n\n${guard.UNTRUSTED_NOTICE}` : "") },
      { role: "user", content: def.user(modelInput) + (patch.promptSuffix ? `\n\n${patch.promptSuffix}` : "") },
      ...context,
    ];
    run.model = model;

    let failure: Failure | null = null;
    let finalText: string | null = null;
    // Plan W4.31: an invalid tool call gets one retry with the schema error;
    // a second invalid turn in a row stops the run and asks the user.
    let invalidTurns = 0;
    let askUser: { tool: string; problem: string } | null = null;
    // R12.18: the same call or error over and over stops the run.
    const rg = createRunGuard();
    let runaway: GuardVerdict | null = null;

    try {
      for (let i = 0; i < maxSteps && finalText === null && !askUser && !runaway; i++) {
        if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
        // The chat adapter charges at dispatch, after its own checks.
        if (executor.id !== "chat") chargeOnce();
        const t0 = Date.now();
        const sent = await executor.chat({
          charge: chargeOnce,
          messages,
          tools: nativeTools ? offered : undefined,
          schema: nativeSchema ? def.outputSchema : turnSchema,
          model,
          tier,
          maxTokens: typeof def.maxTokens === "function" ? def.maxTokens(input) : def.maxTokens,
          temperature: patch.temperature ?? def.temperature,
          signal: opts.signal,
          onDelta: def.streaming && !offered.length ? onDelta : undefined,
        });
        const res = unmarkReply(guard, toolEnv.taint, sent); // W11.I3: data marks never reach the user, a tool or the parser.
        run.model = res.model || run.model;
        if (res.usage) {
          run.tokens.input += res.usage.inputTokens;
          run.tokens.output += res.usage.outputTokens;
          run.tokens.estimated ||= res.usage.estimated;
        }
        step({ kind: "model", ms: Date.now() - t0, label: res.model, ok: true, detail: res.toolCalls.length ? `${res.toolCalls.length} tool call(s)` : truncate(res.content, 200) });

        let calls: ToolCall[] = res.toolCalls;
        let assistantContent = res.content;
        if (!calls.length && offered.length && !nativeTools) {
          const turn = parseProtocolTurn(res.content, offered);
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
        // Plan W4.31: the slips small models make (shape, name case, string
        // numbers, a wrapper object…) are fixed before the call is checked.
        const repaired = calls.map((c) => repairCall(c, offered));
        calls = repaired.map((r) => r.call);
        messages.push({ role: "assistant", content: assistantContent, toolCalls: calls });
        const priorInvalid = invalidTurns > 0;
        let turnInvalid = false;
        for (const [ci, call] of calls.entries()) {
          const t1 = Date.now();
          const r = await execTool(offered, call, toolEnv);
          let body: string;
          let guardNote = "";
          const repairNote = repaired[ci].repairs.length ? `repaired: ${repaired[ci].repairs.join(", ")}` : "";
          const invalid = r.error !== undefined && (r.error.startsWith("bad-args:") || r.error.startsWith("Unknown tool"));
          turnInvalid ||= invalid;
          if (invalid && priorInvalid) {
            // The one retry was spent: ask the user instead of guessing (plan W4.31).
            step({ kind: "tool", ms: Date.now() - t1, label: call.name, ok: false, detail: r.error });
            askUser = { tool: call.name, problem: r.error!.replace(/^bad-args:\s*/, "") };
            break;
          }
          if (invalid) body = toolResultMessage(call, undefined, retryMessage(call, offered, r.error!));
          else if (r.error !== undefined) body = toolResultMessage(call, undefined, r.error);
          else if (r.untrusted?.length) {
            // Outside content: cleaned, then delimited (after truncation, so the closing marker stays).
            ({ body, note: guardNote } = await guardUntrustedResult(guard, (v) => truncate(toolResultMessage(call, v), TOOL_RESULT_LIMIT), r.result, r.untrusted, toolEnv.taint, messages, opts.signal));
          } else body = truncate(toolResultMessage(call, r.result), TOOL_RESULT_LIMIT);
          const argsText = truncate(JSON.stringify(call.args), 200);
          const detail = [r.note, guardNote, repairNote, argsText].filter(Boolean).join(" · ");
          step({ kind: "tool", ms: Date.now() - t1, label: call.name, ok: r.error === undefined, detail: r.error ?? detail });
          messages.push({ role: "tool", content: body, toolCallId: call.id, name: call.name });
          // A call the user declined (plan 2.7) is the user's answer, not the model failing in a loop: the
          // same declined error is not counted (the same call still is). R12.18 with the injection set.
          const declined = typeof r.error === "string" && r.error.includes(guard.UNTRUSTED_DENIED);
          const v = rg.observe({ error: declined ? null : r.error, call });
          if (v.action !== "ok") step({ kind: "validate", ms: 0, label: "runaway", ok: !stops(v), detail: `${v.action}: ${v.reason}` });
          if (stops(v)) {
            runaway = v;
            break;
          }
        }
        invalidTurns = turnInvalid ? invalidTurns + 1 : 0;
      }
      if (finalText === null && !askUser && !runaway) {
        failure = { kind: "empty", attempt, maxRetries, tier, executor: executor.id, reason: `no final answer after ${maxSteps} steps`, inputChars, splittable: !!def.splittable };
      }
    } catch (e) {
      if (isAbort(e, opts.signal)) return finish("aborted", { errorCode: "aborted", error: "aborted" });
      if (e instanceof AiQuotaExceededError) return finish("failed", { errorCode: "quota", error: e.message });
      const msg = (e as Error)?.message ?? String(e);
      step({ kind: "model", ms: 0, label: executor.id, ok: false, detail: truncate(msg, 300) });
      failure = { kind: "error", attempt, maxRetries, tier, executor: executor.id, reason: msg, inputChars, splittable: !!def.splittable };
    }

    // The log keeps the prompt's hash and size, never its text (R12.18).
    run.guard = rg.log(messages.slice(0, 2).map((m) => m.content).join("\n"));
    if (runaway) return finish("failed", { errorCode: "runaway", error: `Stopped a runaway run: ${runaway.reason} (${runaway.action}). Change the request and run it again.` });
    if (askUser) {
      const ask: { tool: string; problem: string } = askUser;
      return finish("failed", {
        errorCode: "tool-args",
        error: `The model could not make a valid call to ${ask.tool} (${ask.problem}). Say exactly what it needs and run the command again.`,
        suggestions: [{ id: "clarify-tool", title: "agent.suggest.clarifyTool", params: { tool: ask.tool, problem: truncate(ask.problem, 120) } }],
      });
    }
    if (!failure && finalText !== null) {
      let output: O | undefined;
      const text = finalText.trim();
      if (!text) {
        failure = { kind: "empty", attempt, maxRetries, tier, executor: executor.id, reason: "empty answer", inputChars, splittable: !!def.splittable };
      } else {
        try {
          if (def.parse) output = def.parse(text, input);
          else if (def.outputSchema) {
            const j = checkJson(text);
            if (!j.ok) throw new Error(j.error);
            output = j.value as O;
          } else output = text as unknown as O;
        } catch (e) {
          failure = { kind: "parse", attempt, maxRetries, tier, executor: executor.id, reason: (e as Error)?.message ?? "parse failed", hint: def.outputSchema ? "Reply with JSON only." : undefined, inputChars, splittable: !!def.splittable };
          step({ kind: "validate", ms: 0, label: "parse", ok: false, detail: failure.reason });
        }
      }
      // The declared schema is enforced on the parsed value even when the
      // executor constrained the output natively: a model can still ignore
      // the constraint, and prompt-only executors never had one.
      if (!failure && output !== undefined && def.outputSchema) {
        const errors = validateSchema(output, def.outputSchema);
        step({ kind: "validate", ms: 0, label: "schema", ok: errors.length === 0, detail: errors.length ? formatSchemaErrors(errors) : undefined });
        if (errors.length) {
          failure = { kind: "validation", attempt, maxRetries, tier, executor: executor.id, label: "schema", reason: `JSON does not match the required schema: ${formatSchemaErrors(errors)}`, hint: "Reply with JSON matching the schema exactly.", inputChars, splittable: !!def.splittable };
        }
      }
      if (!failure && output !== undefined && languageMode(def, input) === "input") {
        const t1 = Date.now();
        const r = await sameLanguage(inputTextOf(def, input), output);
        step({ kind: "validate", ms: Date.now() - t1, label: "language", ok: r.ok, detail: r.ok ? undefined : r.reason });
        if (!r.ok) failure = { kind: "validation", attempt, maxRetries, tier, executor: executor.id, label: "language", reason: r.reason, hint: r.hint, inputChars, splittable: !!def.splittable };
      }
      if (!failure && output !== undefined) {
        for (const v of def.validators ?? []) {
          const t2 = Date.now();
          const r = await v.check(output, input, { pages: ctx.pages ?? new Map() });
          step({ kind: "validate", ms: Date.now() - t2, label: v.name, ok: r.ok, detail: r.ok ? undefined : r.reason });
          if (!r.ok) {
            failure = { kind: "validation", attempt, maxRetries, tier, executor: executor.id, label: v.name, reason: r.reason, hint: r.hint, inputChars, splittable: !!def.splittable };
            break;
          }
        }
      }
      if (!failure) {
        if (key) {
          const { putCached } = await import("../ai/responseCache");
          // Text agents cache the raw model text (re-parsed on a hit); JSON agents the value.
          await putCached(key, def.outputSchema || !def.parse ? JSON.stringify(output) : text, run.model ?? "").catch(() => { /* why: the answer is already returned; a failed cache write only means no cache hit next time */ });
        }
        return finish("ok", { output });
      }
    }

    // No usable answer: ask the critic.
    const alternatives: ExecutorId[] = [];
    for (const ex of listExecutors()) {
      if (ex.id !== executor.id && preference.includes(ex.id) && (await ex.available()).available) alternatives.push(ex.id);
    }
    const verdict = await review({ ...failure!, alternatives, agentId: def.id, signal: opts.signal });
    if (opts.signal?.aborted) return finish("aborted", { errorCode: "aborted", error: "aborted" });
    step({ kind: "critic", ms: 0, label: verdict.diagnosis, ok: !!verdict.retry, detail: failure!.reason });
    if (verdict.retry && attempt <= maxRetries) {
      patch = { ...patch, ...verdict.retry };
      step({ kind: "retry", ms: 0, label: `attempt ${attempt + 1}`, ok: true, detail: JSON.stringify({ tier: patch.tier, temperature: patch.temperature, executor: patch.executor }) });
      continue;
    }
    if (verdict.retry && verdict.byModel && !modelRetryUsed) {
      // The retries are spent and the model critic proposed a concrete change: one attempt with it.
      modelRetryUsed = true;
      patch = { ...patch, ...verdict.retry };
      step({ kind: "retry", ms: 0, label: `attempt ${attempt + 1} (model critic)`, ok: true, detail: truncate(verdict.retry.promptSuffix ?? "", 200) });
      continue;
    }
    return finish("failed", { errorCode: failure!.kind, error: failure!.reason ?? failure!.kind, suggestions: verdict.suggestions });
  }
  return finish("failed", { errorCode: "error", error: "exhausted" });
}

/** The agent's output, or an `AgentRunError` that carries the run (status, error, suggestions). */
export interface CallToolOptions {
  /** Scopes granted for this call (`read` always is). */
  grants?: ToolScope[];
  signal?: AbortSignal;
  document?: string;
  selection?: string;
  path?: string | null;
  consentNetwork?: RunOptions["consentNetwork"];
  /** Who calls, for the staged changes' provenance (write tools). */
  runId?: string;
  agentId?: string;
}

/**
 * Call one tool outside a model turn, under the runtime's rules — the scope
 * must be granted, the arguments must match the tool's schema, a network
 * tool passes the network gate, a write tool only stages. For a command
 * that needs what a tool returns (the note list to check an agent's links
 * against) and for agents that need no model (the digest): they go through
 * the same path as an agent's own calls instead of importing the source.
 * Resolves to the tool's result; rejects with a ToolError carrying its error.
 */
export async function callTool<R = unknown>(name: string, args: Record<string, unknown> = {}, opts: CallToolOptions = {}): Promise<R> {
  const { getTool } = await import("./tools");
  const tool = getTool(name);
  if (!tool) throw new ToolError("bad-args", `Unknown tool "${name}"`);
  const env: ToolEnv = {
    ctx: { signal: opts.signal, path: opts.path ?? null, document: opts.document, selection: opts.selection, grants: new Set<ToolScope>(["read", ...(opts.grants ?? [])]), pages: new Map() },
    runId: opts.runId ?? newRunId(),
    agentId: opts.agentId ?? "command",
    consent: opts.consentNetwork,
    staged: [],
    // No model reads a direct call's result, so outside content in it needs no approval here (plan 2.7).
    taint: [],
    private: false,
  };
  const r = await execTool([tool], { id: `direct_${++runSeq}`, name, args }, env);
  if (r.error !== undefined) {
    const code = r.error.startsWith("bad-args") ? "bad-args" : r.error.startsWith("not-found") ? "not-found" : r.error.startsWith("denied") || / permission, which was not granted/.test(r.error) ? "denied" : "failed";
    throw new ToolError(code, r.error);
  }
  return r.result as R;
}

/**
 * One request to a model on this device for a module that is not an agent
 * definition (the entity-relation extractor, the HeRE eval adapter, "Ask the
 * law"): it still goes through the runtime (plan 5.5.3), so it is in the
 * trace like any run — the engine, the model, how long, and whether it
 * failed; never the prompt or the answer. No tools are passed (the request
 * cannot write or reach the network), and a cloud executor is refused.
 */
export async function runLocalRequest(executor: Executor, req: Omit<ExecutorRequest, "tools">, meta: { agentId: string; commandId?: string }): Promise<ExecutorResponse> {
  if (executor.id === "chat") throw new Error(`${meta.agentId}: a local engine only, not the cloud`);
  const startedAt = Date.now();
  const run: AgentRun = {
    id: newRunId(),
    agentId: meta.agentId,
    commandId: meta.commandId,
    executor: executor.id,
    model: req.model ?? null,
    startedAt,
    endedAt: 0,
    status: "ok",
    attempts: 1,
    steps: [],
    suggestions: [],
    tokens: { input: 0, output: 0, estimated: true },
  };
  try {
    const res = await executor.chat({ ...req, tools: undefined, signal: req.signal });
    run.model = res.model || run.model;
    if (res.usage) run.tokens = { input: res.usage.inputTokens, output: res.usage.outputTokens, estimated: res.usage.estimated };
    run.steps.push({ kind: "model", at: startedAt, ms: Date.now() - startedAt, label: run.model ?? executor.id, ok: true });
    return res;
  } catch (e) {
    const aborted = isAbort(e, req.signal);
    run.status = aborted ? "aborted" : "failed";
    run.errorCode = aborted ? "aborted" : "error";
    run.error = aborted ? "aborted" : e instanceof Error ? e.name : "error";
    run.steps.push({ kind: "model", at: startedAt, ms: Date.now() - startedAt, label: run.model ?? executor.id, ok: false });
    throw e;
  } finally {
    run.endedAt = Date.now();
    void recordRun(run).catch(() => undefined); // why: a trace that can't be stored never fails the request
  }
}

export async function runAgentOrThrow<I extends AgentInput, O = string>(def: AgentDefinition<I, O>, input: I, opts: RunOptions = {}): Promise<O> {
  const run = await runAgent(def, input, opts);
  if (run.status === "ok" && run.output !== undefined) return run.output;
  throw new AgentRunError(run as AgentRun, run.error ?? run.status);
}

/**
 * Run a streaming agent as an async generator of text deltas (what the
 * editor's streaming UIs consume). Throws AgentRunError when the run does
 * not end with a usable answer. Closing the generator early aborts the run.
 */
export async function* streamAgent<I extends AgentInput>(def: AgentDefinition<I, string>, input: I, opts: RunOptions = {}): AsyncGenerator<string, void, undefined> {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  let result: AgentRun<string> | null = null;
  const ctrl = new AbortController();
  const onOuter = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  else opts.signal?.addEventListener("abort", onOuter, { once: true });
  const p = runAgent(def, input, {
    ...opts,
    signal: ctrl.signal,
    onDelta: (d) => {
      queue.push(d);
      wake?.();
    },
  }).then((r) => {
    result = r;
    done = true;
    wake?.();
  });
  let yielded = false;
  try {
    for (;;) {
      if (queue.length) {
        yielded = true;
        yield queue.shift()!;
        continue;
      }
      if (done) break;
      await new Promise<void>((r) => {
        wake = r;
      });
      wake = null;
    }
    await p;
    const run = result as AgentRun<string> | null;
    if (!run || run.status !== "ok") throw new AgentRunError(run as AgentRun, run?.error ?? "agent failed");
    // An executor that could not stream: the whole answer arrives once.
    if (!yielded && run.output) yield run.output;
  } finally {
    opts.signal?.removeEventListener("abort", onOuter);
    if (!done) ctrl.abort();
  }
}
