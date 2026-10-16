/**
 * Anthropic Claude provider.
 *
 * Routes chat/stream calls through the Messages API
 * (https://api.anthropic.com/v1/messages). Anthropic separates the system
 * prompt from the message list and requires an explicit max_tokens, so the
 * body shape differs from OpenAI — `buildAnthropicBody` handles that mapping
 * and is exported for unit testing.
 *
 * Zero external dependencies — native fetch + SSE parsing.
 */

import type { ChatMessage, ChatOptions } from "./llm";
import { getProviderKey, AiError, PROVIDER_DEFAULT_MODELS } from "./llm";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = PROVIDER_DEFAULT_MODELS.anthropic;

export function getAnthropicModel(opts: ChatOptions): string {
  if (opts.model) return opts.model;
  try {
    return localStorage.getItem("lumen.ai.model.anthropic") || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

type TextBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

interface AnthropicBody {
  model: string;
  max_tokens: number;
  system?: string | TextBlock[];
  temperature?: number;
  stream?: boolean;
  messages: { role: "user" | "assistant"; content: string | TextBlock[] }[];
}

/**
 * Prompt caching: a prefix of at least ~1–2K tokens (by model) marked with
 * `cache_control` is cached for 5 minutes and re-read at ~10% of the input
 * price. Long system prompts and long first user messages (a document
 * sent as context) are marked; shorter ones aren't worth a cache write.
 */
export const CACHE_MIN_CHARS = 8_000;
const cached = (text: string): TextBlock[] => [{ type: "text", text, cache_control: { type: "ephemeral" } }];

/** Pure mapping from our ChatMessage[] to the Anthropic Messages body. */
export function buildAnthropicBody(
  messages: ChatMessage[],
  opts: ChatOptions = {},
  stream = false,
): AnthropicBody {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  // At most two breakpoints: the system prompt and the first user turn.
  const first = turns.findIndex((m) => m.role === "user");
  const messagesOut = turns.map((m, i) =>
    i === first && m.content.length >= CACHE_MIN_CHARS ? { ...m, content: cached(m.content) } : m,
  );
  return {
    model: getAnthropicModel(opts),
    max_tokens: opts.maxTokens ?? 1024,
    ...(system ? { system: system.length >= CACHE_MIN_CHARS ? cached(system) : system } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(stream ? { stream: true } : {}),
    messages: messagesOut,
  };
}

type AnthropicUsage = {
  server_tool_use?: { web_search_requests?: number };
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

function reportUsage(u: AnthropicUsage | undefined, model: string, opts: ChatOptions): void {
  if (!u) return;
  opts.onUsage?.({
    model,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    ...(u.server_tool_use?.web_search_requests ? { webSearches: u.server_tool_use.web_search_requests } : {}),
  });
}

function headers(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-api-key": getProviderKey("anthropic"),
    "anthropic-version": ANTHROPIC_VERSION,
    // Required for calls originating from a browser.
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

export async function chatAnthropic(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(buildAnthropicBody(messages, opts)),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiError("API_ERROR", `Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type?: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AiError("PARSE_ERROR", "Empty Anthropic response.");
  reportUsage(data.usage, data.model ?? getAnthropicModel(opts), opts);
  return text;
}

export async function* chatAnthropicStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string, void, undefined> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(buildAnthropicBody(messages, opts, true)),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiError("API_ERROR", `Anthropic stream ${res.status}: ${body.slice(0, 200)}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new AiError("API_ERROR", "No response body from Anthropic.");
  // message_start carries the input usage, message_delta the output count.
  const usage: AnthropicUsage = {};
  let model = getAnthropicModel(opts);
  let sawUsage = false;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
        if (json?.type === "message_start" && json.message?.usage) {
          Object.assign(usage, json.message.usage);
          if (json.message.model) model = json.message.model;
          sawUsage = true;
        } else if (json?.type === "message_delta" && json.usage) {
          Object.assign(usage, json.usage);
          sawUsage = true;
        }
        // content_block_delta carries { delta: { type: "text_delta", text } }
        const delta = json?.delta?.text;
        if (delta) yield delta;
      } catch {
        /* skip non-JSON keep-alive lines */
      }
    }
  }
  if (sawUsage) reportUsage(usage, model, opts);
}

/** A passage of the answer and the web sources Claude cited for it. */
export interface CitedBlock {
  text: string;
  citations: Array<{ url: string; title: string; quote: string }>;
}

/**
 * One Messages API call with Claude's server-side web search tool: Claude
 * searches, reads and answers, returning text blocks with the passages it
 * relied on (`web_search_result_location` citations, quoted verbatim by the
 * API). `maxSearches` caps the searches (each is billed by Anthropic).
 */
export async function anthropicWebResearch(
  messages: ChatMessage[],
  opts: ChatOptions & { maxSearches?: number } = {},
): Promise<CitedBlock[]> {
  // The web search tool needs a current model: an explicit or configured
  // Claude 3.x choice falls back to the default (Sonnet 5.5).
  const configured = getAnthropicModel(opts);
  const model = /^claude-3/.test(configured) ? PROVIDER_DEFAULT_MODELS.anthropic : configured;
  const base = buildAnthropicBody(messages, { ...opts, model, maxTokens: opts.maxTokens ?? 4096 });
  const maxSearches = Math.max(1, Math.min(10, opts.maxSearches ?? 5));
  const tool = { type: "web_search_20250305", name: "web_search", max_uses: maxSearches };
  const body: Record<string, unknown> & { messages: unknown[] } = { ...base, tools: [tool] };
  let searched = 0;
  const content: Array<{ type?: string; text?: string; citations?: Array<{ type?: string; url?: string; title?: string; cited_text?: string }> }> = [];
  // A long search turn can stop with `pause_turn`: send it back to continue
  // (bounded).
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch(API_URL, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: opts.signal });
    if (!res.ok) {
      const b = await res.text().catch(() => "");
      throw new AiError("API_ERROR", `Anthropic ${res.status}: ${b.slice(0, 200)}`);
    }
    const data = await res.json();
    reportUsage(data.usage, data.model ?? model, opts);
    content.push(...(data.content ?? []));
    if (data.stop_reason !== "pause_turn") break;
    // `max_uses` applies per request: carry the remaining budget over, and
    // stop continuing once the run's searches are spent.
    searched += Number(data.usage?.server_tool_use?.web_search_requests) || 0;
    // Budget spent: still continue the paused turn (it isn't finished), but
    // with searching switched off so the answer gets written.
    if (searched >= maxSearches) body.tool_choice = { type: "none" };
    else tool.max_uses = maxSearches - searched;
    body.messages = [...body.messages, { role: "assistant", content: data.content }];
  }
  const blocks: CitedBlock[] = [];
  for (const b of content) {
    if (b.type !== "text" || !b.text) continue;
    blocks.push({
      text: b.text,
      citations: (b.citations ?? [])
        .filter((c) => c.type === "web_search_result_location" && c.url)
        .map((c) => ({ url: c.url!, title: c.title ?? "", quote: (c.cited_text ?? "").trim() })),
    });
  }
  if (!blocks.length) throw new AiError("PARSE_ERROR", "Empty Anthropic response.");
  return blocks;
}
