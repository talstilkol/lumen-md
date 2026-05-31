/**
 * Mistral provider.
 *
 * Mistral's chat API is OpenAI-compatible (same /v1/chat/completions shape and
 * SSE streaming), so the body/response handling mirrors the OpenAI path. Key
 * comes from getProviderKey("mistral").
 *
 * Zero external dependencies — native fetch + SSE parsing.
 */

import type { ChatMessage, ChatOptions } from "./llm";
import { getProviderKey, AiError } from "./llm";

const API_URL = "https://api.mistral.ai/v1/chat/completions";
const DEFAULT_MODEL = "mistral-small-latest";

export function getMistralModel(opts: ChatOptions): string {
  if (opts.model) return opts.model;
  try {
    return localStorage.getItem("lumen.ai.model.mistral") || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

function body(messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
  return JSON.stringify({
    model: getMistralModel(opts),
    messages,
    ...(stream ? { stream: true } : {}),
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  });
}

function headers(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getProviderKey("mistral")}`,
  };
}

export async function chatMistral(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: headers(),
    body: body(messages, opts, false),
    signal: opts.signal,
  });
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    throw new AiError("API_ERROR", `Mistral ${res.status}: ${b.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AiError("PARSE_ERROR", "Empty Mistral response.");
  return text;
}

export async function* chatMistralStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string, void, undefined> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: headers(),
    body: body(messages, opts, true),
    signal: opts.signal,
  });
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    throw new AiError("API_ERROR", `Mistral stream ${res.status}: ${b.slice(0, 200)}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new AiError("API_ERROR", "No response body from Mistral.");
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
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* skip */
      }
    }
  }
}
