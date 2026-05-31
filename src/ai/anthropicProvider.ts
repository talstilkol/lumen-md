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
import { getProviderKey, AiError } from "./llm";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

export function getAnthropicModel(opts: ChatOptions): string {
  if (opts.model) return opts.model;
  try {
    return localStorage.getItem("lumen.ai.model.anthropic") || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

interface AnthropicBody {
  model: string;
  max_tokens: number;
  system?: string;
  temperature?: number;
  stream?: boolean;
  messages: { role: "user" | "assistant"; content: string }[];
}

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
  return {
    model: getAnthropicModel(opts),
    max_tokens: opts.maxTokens ?? 1024,
    ...(system ? { system } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(stream ? { stream: true } : {}),
    messages: turns,
  };
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
        // content_block_delta carries { delta: { type: "text_delta", text } }
        const delta = json?.delta?.text;
        if (delta) yield delta;
      } catch {
        /* skip non-JSON keep-alive lines */
      }
    }
  }
}
