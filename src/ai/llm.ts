/**
 * Centralized LLM service for all AI agents.
 * Single point for API calls, streaming, abort, retry, and error handling.
 */

import { useAppStore } from "../store/useStore";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /** If true, returns a ReadableStream for streaming responses. */
  stream?: boolean;
}

const DEFAULT_MODEL = "gpt-4o-mini";
const API_URL = "https://api.openai.com/v1/chat/completions";
const MAX_RETRIES = 2;

/**
 * Get the current AI key from the store.
 * Throws a user-friendly error if not configured.
 */
export function getAiKey(): string {
  const key = useAppStore.getState().aiKey;
  if (!key) {
    throw new AiError("NO_KEY", "Please configure your AI Key (⌘K → AI Settings).");
  }
  return key;
}

export class AiError extends Error {
  constructor(
    public code: "NO_KEY" | "API_ERROR" | "PARSE_ERROR" | "ABORTED",
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/**
 * Send a chat completion request. Returns the full text response.
 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const key = getAiKey();
  const model = opts.model ?? DEFAULT_MODEL;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        }),
        signal: opts.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new AiError("API_ERROR", `API ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new AiError("PARSE_ERROR", "Empty AI response.");
      return text;
    } catch (e) {
      if (e instanceof AiError && e.code === "NO_KEY") throw e;
      if (opts.signal?.aborted) throw new AiError("ABORTED", "Request cancelled.");
      lastError = e as Error;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new AiError("API_ERROR", "Unknown error.");
}

/**
 * Stream a chat completion. Yields text chunks as they arrive.
 */
export async function* chatStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string, void, undefined> {
  const key = getAiKey();
  const model = opts.model ?? DEFAULT_MODEL;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiError("API_ERROR", `API ${res.status}: ${body.slice(0, 200)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new AiError("API_ERROR", "No response body.");

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
        // skip malformed SSE lines
      }
    }
  }
}

/**
 * Parse a JSON response from the AI, stripping any markdown code fences.
 */
export function parseJsonResponse<T = unknown>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AiError("PARSE_ERROR", "Failed to parse AI JSON response.");
  }
}
