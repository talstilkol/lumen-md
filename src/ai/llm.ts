/**
 * Centralized LLM service for all AI agents.
 * Single point for API calls, streaming, abort, retry, and error handling.
 */

import { useAppStore } from "../store/useStore";
import { toast } from "../store/useToastStore";

// ── Rate limiting ───────────────────────────────────────────────────────
// Token bucket — protects the user's API key against runaway loops.
const RATE_LIMIT_PER_MIN = 60;
const MAX_CONCURRENT = 5;
const requestTimestamps: number[] = [];
let inflight = 0;

class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`Rate limit exceeded. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = "RateLimitError";
  }
}

function checkRateLimit(): void {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  // Drop timestamps older than 1 minute.
  while (requestTimestamps.length && requestTimestamps[0] < oneMinuteAgo) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT_PER_MIN) {
    const oldest = requestTimestamps[0];
    const retryAfterMs = 60_000 - (now - oldest);
    toast.warn(
      "AI rate limit reached",
      `Wait ${Math.ceil(retryAfterMs / 1000)}s before sending another prompt.`,
    );
    throw new RateLimitError(retryAfterMs);
  }
  if (inflight >= MAX_CONCURRENT) {
    toast.warn(
      "AI requests at capacity",
      "Wait for the current prompts to finish before sending more.",
    );
    throw new RateLimitError(1_000);
  }
  requestTimestamps.push(now);
}

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
 *
 * When the user has flipped `useLocalAi` in the store and WebGPU is
 * available, the call is routed to `chatLocal()` instead of OpenAI.
 * This keeps prompts on-device for privacy / offline scenarios.
 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  if (useAppStore.getState().useLocalAi) {
    const { chatLocal, localLlmAvailable, onLocalLlmProgress } = await import(
      "./localLlm"
    );
    if (localLlmAvailable().available) {
      // Surface model-download progress as a lightweight toast so the user
      // knows the first prompt may take a while (Llama-3-8B is ≈ 4 GB).
      let lastPct = -1;
      const off = onLocalLlmProgress(({ progress, text }) => {
        const pct = Math.round(progress * 100);
        if (pct >= lastPct + 5 || pct === 100) {
          lastPct = pct;
          toast.info("Local AI loading", `${pct}% — ${text || "preparing model"}`);
        }
      });
      try {
        return await chatLocal(messages, { model: opts.model, maxTokens: opts.maxTokens });
      } finally {
        off();
      }
    }
    // WebGPU unavailable — fall through to the cloud path with a warning.
    toast.warn(
      "Local AI unavailable",
      "WebGPU isn't supported here — falling back to your OpenAI key.",
    );
  }
  const key = getAiKey();
  checkRateLimit();
  inflight++;
  // F3 — when the user has trained + enabled their personal model,
  // route chat() through it. Caller-supplied `opts.model` still wins
  // so individual call sites (e.g. autocomplete) can pin a fast model.
  const storeState = useAppStore.getState();
  const fineTuneOverride =
    storeState.useFineTunedModel && storeState.fineTunedModelId
      ? storeState.fineTunedModelId
      : null;
  const model = opts.model ?? fineTuneOverride ?? DEFAULT_MODEL;
  let lastError: Error | null = null;

  try {
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
      if (e instanceof RateLimitError) throw e;
      if (opts.signal?.aborted || (e as DOMException).name === "AbortError") return "";
      lastError = e as Error;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new AiError("API_ERROR", "Unknown error.");
  } finally {
    inflight--;
  }
}

/**
 * Stream a chat completion. Yields text chunks as they arrive.
 */
export async function* chatStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string, void, undefined> {
  const key = getAiKey();
  checkRateLimit();
  inflight++;
  const model = opts.model ?? DEFAULT_MODEL;

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
  } finally {
    inflight--;
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
