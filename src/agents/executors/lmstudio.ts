/**
 * LM Studio as an engine (W11.I17).
 *
 * LM Studio runs a local server (default http://localhost:1234) with two
 * APIs, both used here:
 *  - OpenAI-compatible `/v1` (`/v1/models`, `/v1/chat/completions`): client
 *    tools (`tools` / `tool_calls`) and structured output
 *    (`response_format: json_schema`), so every agent with tools or a
 *    schema goes through it;
 *  - the native `/api/v1/chat` (LM Studio 0.4): a plain turn with
 *    `reasoning: "off"` (no hidden thinking keeps the UI waiting),
 *    `store: false` (nothing kept on the server) and real token stats. Its
 *    tools are server-side integrations, never Lumen's, so it is used only
 *    for turns without tools or a schema; on a server without it (before
 *    0.4, a 404) the turn falls back to `/v1`.
 *
 * Permission keys (LM Studio 0.4, Settings → Server) are sent as
 * `Authorization: Bearer <key>` when the user saved one (in the secret store).
 *
 * Policy: under `local-only` a server that is not on this machine or LAN is
 * refused; airplane mode refuses anything but loopback (the same rule as
 * its network guard).
 */
import type { AgentTool, Availability, Executor, ExecutorMessage, ExecutorRequest, ExecutorResponse, ModelTier, ToolCall } from "../types";
import { getAiPolicy, isLocalOrigin } from "../../ai/policy";
import { getSecret } from "../../lib/secretStore";

import { LMSTUDIO_DEFAULT_URL, LMSTUDIO_URL_KEY, lmStudioUrl } from "../../ai/lmStudioEndpoint";

export { LMSTUDIO_DEFAULT_URL, LMSTUDIO_URL_KEY, lmStudioUrl };
export const LMSTUDIO_KEY_KEY = "lumen.ai.lmstudio.key";
export const LMSTUDIO_MODEL_KEY = "lumen.ai.lmstudio.model";

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};


const isLoopback = (url: string) => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" || h.endsWith(".localhost");
  } catch {
    return false;
  }
};

async function airplaneOn(): Promise<boolean> {
  try {
    return (await import("../../privacy/airplane")).airplaneModeOn();
  } catch {
    return false;
  }
}

/** Why the configured server may not be used now, or null. */
export async function lmStudioRefusal(url = lmStudioUrl()): Promise<string | null> {
  if (getAiPolicy() === "local-only" && !isLocalOrigin(url)) return "policy";
  if (!isLoopback(url) && (await airplaneOn())) return "airplane";
  return null;
}

/** The permission key is a credential: it lives in the secret store (encrypted or the OS keychain when the user chose that). */
function headers(): Record<string, string> {
  const key = getSecret(LMSTUDIO_KEY_KEY);
  return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

export const LMSTUDIO_ON_KEY = "lumen.ai.lmstudio.on";

/** LM Studio takes part in the engine order once the user turned it on, or set its address. */
export function lmStudioEnabled(): boolean {
  return read(LMSTUDIO_ON_KEY) === "1" || !!read(LMSTUDIO_URL_KEY);
}

/** "Detect": is an LM Studio server answering at the address (default localhost:1234)? Turns it on when it is. */
export async function detectLmStudio(url = lmStudioUrl()): Promise<{ found: boolean; models: string[]; reason?: string }> {
  const refused = await lmStudioRefusal(url);
  if (refused) return { found: false, models: [], reason: refused };
  try {
    // privacy-ledger: LM Studio at the configured base URL (classify: local-ai on this machine/LAN, cloud-ai when remote)
    const res = await fetch(`${url.replace(/\/+$/, "")}/v1/models`, { headers: headers() });
    if (res.status === 401 || res.status === 403) return { found: true, models: [], reason: "unauthorized" };
    if (!res.ok) return { found: false, models: [], reason: `HTTP ${res.status}` };
    const list = (((await res.json()) as { data?: Array<{ id?: string }> }).data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
    try {
      localStorage.setItem(LMSTUDIO_ON_KEY, "1");
    } catch {
      /* why: storage denied: detection still answers */
    }
    return { found: true, models: list };
  } catch (e) {
    return { found: false, models: [], reason: (e as Error)?.message ?? "offline" };
  }
}

let models: string[] | null = null;
let nativeChat: boolean | null = null;

/** Reset cached state (tests). */
export function __resetLmStudioState(): void {
  models = null;
  nativeChat = null;
}

async function listModels(signal?: AbortSignal): Promise<string[]> {
  // privacy-ledger: LM Studio at the configured base URL (classify: local-ai on this machine/LAN, cloud-ai when remote)
  const res = await fetch(`${lmStudioUrl()}/v1/models`, { headers: headers(), signal });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("LM Studio refused the permission key"), { code: "unauthorized" });
  if (!res.ok) throw new Error(`LM Studio /v1/models: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string" && !/embed/i.test(id));
}

/* ─── Message and tool mapping (OpenAI format) ────────────────────────── */

export function toOpenAiMessages(messages: ExecutorMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? m.name ?? "call" };
    if (m.role === "assistant" && m.toolCalls?.length) {
      return { role: "assistant", content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) };
    }
    return { role: m.role, content: m.content };
  });
}

export function toOpenAiTools(tools: AgentTool[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c: { id?: string; function?: { name?: string; arguments?: unknown } }, i) => {
    const name = c?.function?.name;
    if (!name) return [];
    let args: Record<string, unknown> = {};
    const a = c.function?.arguments;
    if (typeof a === "string") {
      try {
        args = a.trim() ? (JSON.parse(a) as Record<string, unknown>) : {};
      } catch {
        args = { _raw: a };
      }
    } else if (a && typeof a === "object") args = a as Record<string, unknown>;
    return [{ id: c.id || `call_${i}`, name, args }];
  });
}

/** The model for a tier: the user's pick, else the first loaded chat model. */
function pickModel(tier: ModelTier, list: string[] | null): string {
  void tier;
  return read(LMSTUDIO_MODEL_KEY) || list?.[0] || "local-model";
}

async function chatCompletions(req: ExecutorRequest, model: string): Promise<ExecutorResponse> {
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAiMessages(req.messages),
    stream: false,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(req.seed !== undefined ? { seed: req.seed } : {}),
  };
  if (req.tools?.length) body.tools = toOpenAiTools(req.tools);
  if (req.schema) body.response_format = { type: "json_schema", json_schema: { name: "answer", strict: true, schema: req.schema } };
  // privacy-ledger: LM Studio at the configured base URL (classify: local-ai on this machine/LAN, cloud-ai when remote)
  const res = await fetch(`${lmStudioUrl()}/v1/chat/completions`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: req.signal });
  if (!res.ok) throw new Error(`LM Studio /v1/chat/completions: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const out = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const msg = out.choices?.[0]?.message ?? {};
  const content = msg.content ?? "";
  if (req.onDelta && content) req.onDelta(content);
  return {
    content,
    toolCalls: parseToolCalls(msg.tool_calls),
    model: out.model || model,
    ...(out.usage ? { usage: { inputTokens: out.usage.prompt_tokens ?? 0, outputTokens: out.usage.completion_tokens ?? 0, estimated: false } } : {}),
  };
}

/** The native turn: system prompt apart, the rest as text input (LM Studio 0.4 `/api/v1/chat`). Null: not supported. */
async function nativeTurn(req: ExecutorRequest, model: string): Promise<ExecutorResponse | null> {
  const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = req.messages.filter((m) => m.role !== "system");
  const input = rest.length === 1 && rest[0]!.role === "user" ? rest[0]!.content : rest.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  const body: Record<string, unknown> = {
    model,
    input,
    ...(system ? { system_prompt: system } : {}),
    stream: false,
    store: false,
    ...(req.think === true ? {} : { reasoning: "off" }),
    ...(req.temperature !== undefined ? { temperature: Math.min(1, Math.max(0, req.temperature)) } : {}),
    ...(req.maxTokens ? { max_output_tokens: req.maxTokens } : {}),
  };
  // privacy-ledger: LM Studio at the configured base URL (classify: local-ai on this machine/LAN, cloud-ai when remote)
  let res = await fetch(`${lmStudioUrl()}/api/v1/chat`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: req.signal });
  // A model without a reasoning switch rejects the field: once more without it.
  if (res.status === 400 && body.reasoning) {
    delete body.reasoning;
    // privacy-ledger: LM Studio at the configured base URL (classify: local-ai on this machine/LAN, cloud-ai when remote)
    res = await fetch(`${lmStudioUrl()}/api/v1/chat`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: req.signal });
  }
  if (res.status === 404 || res.status === 405) return null;
  if (!res.ok) throw new Error(`LM Studio /api/v1/chat: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const out = (await res.json()) as { model_instance_id?: string; output?: Array<{ type?: string; content?: string }>; stats?: { input_tokens?: number; total_output_tokens?: number } };
  const content = (out.output ?? []).filter((o) => o.type === "message").map((o) => o.content ?? "").join("");
  if (req.onDelta && content) req.onDelta(content);
  return {
    content,
    toolCalls: [],
    model: out.model_instance_id || model,
    ...(out.stats ? { usage: { inputTokens: out.stats.input_tokens ?? 0, outputTokens: out.stats.total_output_tokens ?? 0, estimated: false } } : {}),
  };
}

export const lmstudioExecutor: Executor = {
  id: "lmstudio",
  label: "LM Studio",
  async available(): Promise<Availability> {
    // Only once the user set it up (AI settings, or "detect" found it): no probe of port 1234 on every run.
    if (!lmStudioEnabled()) return { available: false, reason: "not-configured" };
    const refused = await lmStudioRefusal();
    if (refused) return { available: false, reason: refused, detail: lmStudioUrl() };
    try {
      models = await listModels();
    } catch (e) {
      if ((e as { code?: string }).code === "unauthorized") return { available: false, reason: "unauthorized", detail: "LM Studio needs a permission key (Settings → Server)" };
      return { available: false, reason: "lmstudio-offline", detail: (e as Error)?.message };
    }
    return models.length ? { available: true } : { available: false, reason: "no-model", detail: "LM Studio has no chat model loaded" };
  },
  supportsTools: () => true,
  supportsSchema: () => true,
  modelFor: (tier) => pickModel(tier, models),
  async chat(req: ExecutorRequest): Promise<ExecutorResponse> {
    if (req.loopbackOnly && !isLoopback(lmStudioUrl())) throw new Error(`This agent uses only an LM Studio on this computer; ${lmStudioUrl()} is not (writing agents send no text off the machine).`);
    const refused = await lmStudioRefusal();
    if (refused) throw new Error(`LM Studio at ${lmStudioUrl()} is refused (${refused === "policy" ? 'the AI policy is "local only"' : "airplane mode is on"})`);
    const model = req.model ?? pickModel(req.tier ?? "small", models);
    if (!req.tools?.length && !req.schema && nativeChat !== false) {
      const r = await nativeTurn(req, model);
      if (r) {
        nativeChat = true;
        return r;
      }
      nativeChat = false;
    }
    return chatCompletions(req, model);
  },
};
