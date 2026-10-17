/**
 * Native Ollama executor — `/api/chat` with tool calling (`tools`),
 * JSON-schema constrained output (`format`) and NDJSON streaming, so an
 * agent gets real function calls instead of the JSON-ReAct protocol and
 * exact token counts instead of estimates.
 *
 * Model choice by tier comes from what is installed: the configured model
 * (`lumen.ollama.model`) when it fits the tier, otherwise the largest
 * installed model that fits, otherwise the largest installed. Tool support
 * is read from `/api/show` (`capabilities`) when the server reports it,
 * with a family list as the fallback for older servers.
 */

import type { AgentTool, Availability, Executor, ExecutorMessage, ExecutorRequest, ExecutorResponse, ModelTier, ToolCall } from "../types";
import { getBaseUrl } from "../../ai/ollamaProvider";

export const RECOMMENDED_OLLAMA_MODEL = "qwen2.5:7b";
/** Ollama accepts a JSON schema in `format` from this version on. */
const SCHEMA_MIN_VERSION = [0, 5, 0] as const;
const TAGS_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 2_000;

export interface InstalledModel {
  name: string;
  /** Billions of parameters, when Ollama reports a size. */
  params: number | null;
  family: string | null;
}

interface OllamaState {
  models: InstalledModel[];
  version: string | null;
  schemaOk: boolean;
  fetchedAt: number;
  /** model → tool support, from /api/show. */
  tools: Map<string, boolean>;
}

const state: OllamaState = { models: [], version: null, schemaOk: false, fetchedAt: 0, tools: new Map() };

/** Model families whose Ollama templates support tool calling (fallback when /api/show says nothing). */
const TOOL_FAMILIES = /^(llama3\.[123]|llama-?3\.[123]|qwen2\.5|qwen3|qwen2\.5-coder|qwen3-coder|mistral|mistral-nemo|mistral-small|mixtral|command-r|gpt-oss|granite3|phi4-mini|hermes3|firefunction|nemotron|devstral|magistral)/i;

export function parseParams(size?: string | null): number | null {
  if (!size) return null;
  const m = size.match(/([\d.]+)\s*([bm])/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2].toLowerCase() === "m" ? n / 1000 : n;
}

/** Parameter-count ceiling of each tier (billions). */
export const TIER_MAX_PARAMS: Record<ModelTier, number> = { tiny: 2.5, small: 9, medium: 16, large: Infinity };

export function tierOf(params: number | null): ModelTier {
  if (params === null) return "small";
  if (params <= TIER_MAX_PARAMS.tiny) return "tiny";
  if (params <= TIER_MAX_PARAMS.small) return "small";
  if (params <= TIER_MAX_PARAMS.medium) return "medium";
  return "large";
}

function configuredModel(): string | null {
  try {
    return localStorage.getItem("lumen.ollama.model");
  } catch {
    return null;
  }
}

/**
 * The installed model for a tier: the configured one when it fits, else
 * the largest installed model inside the tier's band, else the largest
 * below it, else (everything installed is bigger) the smallest installed.
 * Embedding models are never chosen for chat.
 */
export function pickModel(tier: ModelTier, models: InstalledModel[], configured: string | null): string | null {
  const chat = models.filter((m) => !/embed/i.test(m.name));
  if (!chat.length) return configured;
  const byName = new Map(chat.map((m) => [m.name, m]));
  const cfg = configured ? byName.get(configured) ?? byName.get(`${configured}:latest`) : undefined;
  if (cfg && tierOf(cfg.params) === tier) return cfg.name;
  const lower = tier === "tiny" ? 0 : tier === "small" ? TIER_MAX_PARAMS.tiny : tier === "medium" ? TIER_MAX_PARAMS.small : TIER_MAX_PARAMS.medium;
  const upper = TIER_MAX_PARAMS[tier];
  const largest = (list: InstalledModel[]) => list.reduce((b, m) => ((m.params ?? 0) > (b.params ?? 0) ? m : b));
  const smallest = (list: InstalledModel[]) => list.reduce((b, m) => ((m.params ?? Infinity) < (b.params ?? Infinity) ? m : b));
  const sized = chat.filter((m) => m.params !== null);
  const inBand = sized.filter((m) => m.params! > lower && m.params! <= upper);
  if (inBand.length) return largest(inBand).name;
  const below = sized.filter((m) => m.params! <= upper);
  if (below.length) return largest(below).name;
  if (sized.length) return smallest(sized).name;
  return cfg?.name ?? chat[0].name;
}

export function versionAtLeast(version: string | null, min: readonly [number, number, number]): boolean {
  if (!version) return false;
  const parts = version.replace(/^v/, "").split(".").map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const a = Number.isFinite(parts[i]) ? parts[i] : 0;
    if (a > min[i]) return true;
    if (a < min[i]) return false;
  }
  return true;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = PROBE_TIMEOUT_MS): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  const data = res.ok ? await res.json().catch(() => null) : null;
  return { ok: res.ok, status: res.status, data };
}

/** Refresh the installed-model list and server version (cached briefly). */
export async function refreshOllama(force = false): Promise<OllamaState> {
  if (!force && Date.now() - state.fetchedAt < TAGS_TTL_MS) return state;
  const base = getBaseUrl();
  const tags = await fetchJson(`${base}/api/tags`);
  if (!tags.ok) {
    const err = new Error(`Ollama API error ${tags.status}`) as Error & { status?: number };
    err.status = tags.status;
    throw err;
  }
  const list = ((tags.data as { models?: Array<Record<string, unknown>> })?.models ?? []).map((m) => ({
    name: String(m.name ?? m.model ?? ""),
    params: parseParams((m.details as { parameter_size?: string } | undefined)?.parameter_size),
    family: ((m.details as { family?: string } | undefined)?.family ?? null) as string | null,
  }));
  let version: string | null = null;
  try {
    const v = await fetchJson(`${base}/api/version`);
    version = v.ok ? String((v.data as { version?: string })?.version ?? "") || null : null;
  } catch {
    version = null;
  }
  state.models = list.filter((m) => m.name);
  state.version = version;
  state.schemaOk = versionAtLeast(version, SCHEMA_MIN_VERSION);
  state.fetchedAt = Date.now();
  return state;
}

/** Does `model` support tool calling? Cached; /api/show first, family list as fallback. */
export async function probeToolSupport(model: string): Promise<boolean> {
  const cached = state.tools.get(model);
  if (cached !== undefined) return cached;
  let supported: boolean | null = null;
  try {
    const r = await fetchJson(`${getBaseUrl()}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) });
    const caps = (r.data as { capabilities?: string[] })?.capabilities;
    if (r.ok && Array.isArray(caps)) supported = caps.includes("tools");
  } catch {
    supported = null;
  }
  if (supported === null) supported = TOOL_FAMILIES.test(model);
  state.tools.set(model, supported);
  return supported;
}

/** Ollama's wire format for a message list. */
export function toOllamaMessages(messages: ExecutorMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === "tool") return { role: "tool", content: m.content, ...(m.name ? { tool_name: m.name } : {}) };
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export function toOllamaTools(tools: AgentTool[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

let callSeq = 0;

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const c of raw) {
    const fn = (c as { function?: { name?: string; arguments?: unknown } })?.function;
    if (!fn?.name) continue;
    let args: Record<string, unknown> = {};
    if (fn.arguments && typeof fn.arguments === "object") args = fn.arguments as Record<string, unknown>;
    else if (typeof fn.arguments === "string") {
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        args = {};
      }
    }
    out.push({ id: (c as { id?: string }).id ?? `call_${++callSeq}`, name: fn.name, args });
  }
  return out;
}

export const ollamaExecutor: Executor = {
  id: "ollama",
  label: "Ollama",
  async available(): Promise<Availability> {
    try {
      const s = await refreshOllama();
      // Only chat-capable installs count: an embedding-only Ollama would
      // otherwise be picked and then 404 on the recommended model.
      if (!s.models.some((m) => !/embed/i.test(m.name))) return { available: false, reason: "no-model", detail: RECOMMENDED_OLLAMA_MODEL };
      const model = this.modelFor("small");
      if (model) await probeToolSupport(model);
      return { available: true };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 403) return { available: false, reason: "cors", detail: getBaseUrl() };
      return { available: false, reason: "ollama-offline", detail: getBaseUrl() };
    }
  },
  supportsTools(model?: string): boolean {
    const m = model ?? this.modelFor("small");
    if (!m) return false;
    const cached = state.tools.get(m);
    return cached ?? TOOL_FAMILIES.test(m);
  },
  supportsSchema(): boolean {
    return state.schemaOk;
  },
  modelFor(tier: ModelTier): string {
    return pickModel(tier, state.models, configuredModel()) ?? configuredModel() ?? RECOMMENDED_OLLAMA_MODEL;
  },
  async chat(req: ExecutorRequest): Promise<ExecutorResponse> {
    const base = getBaseUrl();
    const model = req.model ?? this.modelFor(req.tier ?? "small");
    const useTools = !!req.tools?.length && this.supportsTools(model);
    const stream = !!req.onDelta && !useTools;
    const body: Record<string, unknown> = {
      model,
      messages: toOllamaMessages(req.messages),
      stream,
      options: {
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
      },
    };
    if (useTools) body.tools = toOllamaTools(req.tools!);
    if (req.schema && this.supportsSchema()) body.format = req.schema;
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama API error ${res.status}: ${text.slice(0, 300)}`);
    }
    const usageOf = (d: Record<string, unknown>) =>
      typeof d.prompt_eval_count === "number" || typeof d.eval_count === "number"
        ? { inputTokens: Number(d.prompt_eval_count ?? 0), outputTokens: Number(d.eval_count ?? 0), estimated: false }
        : undefined;

    if (!stream) {
      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data.error === "string") throw new Error(`Ollama API error: ${data.error}`);
      const msg = (data.message ?? {}) as Record<string, unknown>;
      return {
        content: String(msg.content ?? "").trim(),
        toolCalls: parseToolCalls(msg.tool_calls),
        model: String(data.model ?? model),
        usage: usageOf(data),
      };
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("Ollama: no response body");
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let toolCalls: ToolCall[] = [];
    let usage: ExecutorResponse["usage"];
    let answeredModel = model;
    const consume = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(trimmed);
      } catch {
        return;
      }
      // Ollama reports a failure after streaming began as an NDJSON object
      // with `error` under HTTP 200; a truncated prefix must not pass as
      // an answer.
      if (typeof json.error === "string") throw new Error(`Ollama API error: ${json.error}`);
      if (typeof json.model === "string") answeredModel = json.model;
      const msg = json.message as Record<string, unknown> | undefined;
      const delta = typeof msg?.content === "string" ? msg.content : "";
      if (delta) {
        content += delta;
        req.onDelta?.(delta);
      }
      if (msg?.tool_calls) toolCalls = toolCalls.concat(parseToolCalls(msg.tool_calls));
      if (json.done) usage = usageOf(json);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    consume(buffer);
    return { content: content.trim(), toolCalls, model: answeredModel, usage };
  },
};

/** Tests. */
export function __resetOllamaState(): void {
  state.models = [];
  state.version = null;
  state.schemaOk = false;
  state.fetchedAt = 0;
  state.tools.clear();
}
