/**
 * In-browser executor — web-llm on WebGPU, in a Worker (see
 * src/ai/webllmEngine.ts). Streams, constrains JSON output with the
 * agent's schema (`response_format: json_object` + schema) and calls
 * tools natively on the function-calling models (Hermes); every other
 * model gets the JSON-ReAct protocol from the runtime.
 *
 * The model comes from the model manager: the user's choice, or the
 * largest model of the requested tier that fits this device's GPU.
 */

import type { ChatCompletionMessageParam } from "@mlc-ai/web-llm";
import type { Availability, Executor, ExecutorMessage, ExecutorRequest, ExecutorResponse, ModelTier, ToolCall } from "../types";
import { flattenMessages } from "./chatExecutor";
import { detectHardware, webLlmModelFor, catalogEntryFor } from "../../ai/modelManager";
import { webLlmChat } from "../../ai/webllmEngine";
import { estimateTokens } from "../../ai/usage";

/** web-llm's native function-calling models (its `functionCallingModelIds`). */
const TOOL_MODELS = /^Hermes-(2-Pro|3)-/;

let hwSnapshot: Awaited<ReturnType<typeof detectHardware>> | null = null;

/** OpenAI-style messages with tool calls, for the function-calling models. */
export function toOpenAiMessages(messages: ExecutorMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "" };
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })),
      };
    }
    if (m.role === "system") return { role: "system", content: m.content };
    if (m.role === "assistant") return { role: "assistant", content: m.content };
    return { role: "user", content: m.content };
  });
}

let callSeq = 0;

export function parseOpenAiToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const c of raw) {
    const fn = (c as { function?: { name?: string; arguments?: unknown } })?.function;
    if (!fn?.name) continue;
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === "string") {
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        args = {};
      }
    } else if (fn.arguments && typeof fn.arguments === "object") args = fn.arguments as Record<string, unknown>;
    out.push({ id: (c as { id?: string }).id ?? `call_${++callSeq}`, name: fn.name, args });
  }
  return out;
}

export const webllmExecutor: Executor = {
  id: "webllm",
  label: "WebGPU (web-llm)",
  async available(): Promise<Availability> {
    hwSnapshot = await detectHardware();
    if (!hwSnapshot.webgpu) return { available: false, reason: "no-webgpu", detail: hwSnapshot.reason };
    return { available: true };
  },
  supportsTools(model?: string): boolean {
    const m = model ?? this.modelFor("small");
    return TOOL_MODELS.test(m);
  },
  supportsSchema(): boolean {
    return true;
  },
  modelFor(tier: ModelTier): string {
    const hw = hwSnapshot ?? { webgpu: true, f16: true, maxBufferMB: null, deviceMemoryGB: null, cores: null, mobile: false };
    return webLlmModelFor(tier, hw);
  },
  async chat(req: ExecutorRequest): Promise<ExecutorResponse> {
    const model = req.model ?? this.modelFor(req.tier ?? "small");
    const native = !!req.tools?.length && this.supportsTools(model);
    const messages: ChatCompletionMessageParam[] = native ? toOpenAiMessages(req.messages) : flattenMessages(req.messages);
    const request = {
      messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.schema && !native ? { response_format: { type: "json_object" as const, schema: JSON.stringify(req.schema) } } : {}),
      ...(native ? { tools: req.tools!.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
    };
    const promptChars = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
    const res = await webLlmChat(model, request, { onDelta: native ? undefined : req.onDelta, signal: req.signal });
    const content = res.content.trim();
    return {
      content,
      toolCalls: parseOpenAiToolCalls(res.tool_calls),
      model: res.model || model,
      usage: res.usage
        ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens, estimated: false }
        : { inputTokens: estimateTokens(promptChars), outputTokens: estimateTokens(content), estimated: true },
    };
  },
};

/** For the suggestions panel: is this a model we know how to describe? */
export function describeWebLlmModel(modelId: string): string {
  const e = catalogEntryFor(modelId);
  return e ? `${e.label} (${Math.round((modelId.includes("q4f16") ? e.vramMB.f16 : e.vramMB.f32) / 100) / 10} GB)` : modelId;
}
