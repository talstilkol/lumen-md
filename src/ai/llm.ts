/**
 * Centralized LLM service for all AI agents.
 * Single point for API calls, streaming, abort, retry, and error handling.
 */

import { AiQuotaExceededError, aiQuotaStatus, chargeAiCommandDispatch, consumeAiPrompt } from "../billing/aiQuota";
import { useAppStore } from "../store/useStore";
import { toast } from "../store/useToastStore";
import { fetchWithRetry } from "../lib/fetchRetry";
import { t } from "../i18n";
import { docsUrl } from "../lib/docsLinks";
import { estimateTokens, recordCacheHit, recordUsage, type Usage } from "./usage";

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
      t("ai.toast.rateLimit.title"),
      t("ai.toast.rateLimit.body", { seconds: Math.ceil(retryAfterMs / 1000) }),
    );
    throw new RateLimitError(retryAfterMs);
  }
  if (inflight >= MAX_CONCURRENT) {
    toast.warn(t("ai.toast.capacity.title"), t("ai.toast.capacity.body"));
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
  temperature?: number;
  signal?: AbortSignal;
  /** If true, returns a ReadableStream for streaming responses. */
  stream?: boolean;
  /**
   * The caller already counted this request against the AI quota
   * (`consumeAiPrompt`), so it must not also be billed to a palette
   * command that is waiting to dispatch.
   */
  prepaid?: boolean;
  /**
   * A non-palette request (Ctrl-Space, inline suggestions, Ask Workspace,
   * voice-memo summary, …) that pays for ITSELF — at dispatch, after the
   * provider / key / rate-limit checks, so a request that fails locally
   * spends nothing — and never takes a waiting palette command's
   * reservation. `"silent"`: no toast when the quota is spent (background
   * callers); the request just doesn't go out.
   */
  ownPrompt?: boolean | "silent";
  /**
   * Reuse an identical earlier answer from the local response cache (and
   * store this one). Only for deterministic transformations of the given
   * text; ignored when the user turned the cache off.
   */
  cache?: boolean;
  /**
<<<<<<< HEAD
   * "light": a small task (tags, titles, outline, completions). In the
   * economy / balanced AI modes it goes to the provider's small model
   * unless `model` pins one. Economy mode routes every unpinned request.
   */
  tier?: "light" | "heavy";
=======
   * With `cache`: store the answer only when this accepts it (e.g. it
   * parses), so a malformed answer is retried next time, not replayed.
   */
  cacheIf?: (text: string) => boolean;
>>>>>>> feat/ai-cache-usage
  /**
   * Internal: providers report token usage here (exact where the API
   * returns it). `provider` overrides the selected one when the request
   * was routed elsewhere (fallbacks, local WebGPU).
   */
  onUsage?: (u: Omit<Usage, "provider"> & { provider?: string }) => void;
}

const DEFAULT_MODEL = "gpt-4o-mini";
/** Each cloud provider's model when the user hasn't picked one (the provider modules use these). */
export const PROVIDER_DEFAULT_MODELS = {
  anthropic: "claude-3-5-sonnet-latest",
  gemini: "gemini-1.5-flash",
  mistral: "mistral-small-latest",
} as const;
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
export type AiProvider =
  | "openai"
  | "ollama"
  | "local-webgpu"
  | "anthropic"
  | "gemini"
  | "mistral";

const KNOWN_PROVIDERS: AiProvider[] = [
  "openai",
  "ollama",
  "local-webgpu",
  "anthropic",
  "gemini",
  "mistral",
];

export function getActiveProvider(): AiProvider {
  try {
    const stored = localStorage.getItem("lumen.ai.provider") as AiProvider | null;
    if (stored && KNOWN_PROVIDERS.includes(stored)) return stored;
  } catch { /* */ }
  const state = useAppStore.getState();
  if (state.useLocalAi) return "local-webgpu";
  return "openai";
}

export function setActiveProvider(provider: AiProvider): void {
  localStorage.setItem("lumen.ai.provider", provider);
}

/**
 * Return the API key for a cloud provider. Per-provider keys live in
 * localStorage (`lumen.ai.key.<provider>`); OpenAI falls back to the primary
 * `aiKey` in the store for backwards compatibility. Throws if none is set.
 */
export function getProviderKey(provider: AiProvider): string {
  let key = "";
  try {
    key = localStorage.getItem(`lumen.ai.key.${provider}`) ?? "";
  } catch { /* */ }
  if (!key && provider === "openai") key = useAppStore.getState().aiKey ?? "";
  if (!key) {
    throw new AiError(
      "NO_KEY",
      `Please configure your ${provider} API key (⌘K → AI Settings).`,
    );
  }
  return key;
}

/**
 * The model a request to `provider` will use, for cache keys and the usage
 * meter (the provider modules resolve it the same way).
 */
export function effectiveModel(provider: AiProvider, opts: ChatOptions = {}): string {
  if (opts.model) return opts.model;
  if (provider === "openai") {
    const s = useAppStore.getState();
    return (s.useFineTunedModel && s.fineTunedModelId) || DEFAULT_MODEL;
  }
  try {
    // Ollama keeps its model where the Ollama picker writes it.
    if (provider === "ollama") return localStorage.getItem("lumen.ollama.model") || "llama3.1";
    const fallback = (PROVIDER_DEFAULT_MODELS as Record<string, string>)[provider] ?? "default";
    return localStorage.getItem(`lumen.ai.model.${provider}`) || fallback;
  } catch {
    return "default";
  }
}

/** Each cloud provider's small, cheap model for light tasks. */
export const LIGHT_MODELS: Partial<Record<AiProvider, string>> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash",
  mistral: "mistral-small-latest",
};

/**
 * Model router (Plan D: D4): picks the small model for light tasks (and,
 * in economy mode, for everything) unless the caller pinned a model.
 * Local providers are never rerouted.
 */
export function routeOptions(provider: AiProvider, opts: ChatOptions, mode: "economy" | "balanced" | "quality"): ChatOptions {
  if (opts.model || mode === "quality") return opts;
  const light = LIGHT_MODELS[provider];
  if (!light) return opts;
  if (opts.tier === "light" || mode === "economy") return { ...opts, model: light };
  return opts;
}

async function routed(provider: AiProvider, opts: ChatOptions): Promise<ChatOptions> {
  const { getAiMode } = await import("./contextPacker");
  return routeOptions(provider, opts, getAiMode());
}

const promptChars = (messages: ChatMessage[]) => messages.map((m) => m.content).join("\n");

/**
 * Send a chat completion request. Returns the full text response.
 * Answers may come from the local response cache (`opts.cache`); every
 * request that goes out is recorded in the usage meter.
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const provider = getActiveProvider();
  const opts = await routed(provider, options);
  const model = effectiveModel(provider, opts);
  const { aiCacheEnabled, cacheKey, getCached, putCached } = await import("./responseCache");
  const key =
    opts.cache && aiCacheEnabled()
      ? await cacheKey({ v: 1, provider, model, messages, maxTokens: opts.maxTokens ?? null, temperature: opts.temperature ?? null }).catch(() => null)
      : null;
  if (key) {
    const hit = await getCached(key);
    if (hit) {
      recordCacheHit(provider, model);
      return hit.text;
    }
  }
  let reported = false;
  // Fallbacks (Ollama / WebGPU unavailable → OpenAI) answer under another
  // provider: such an answer must not be cached under the selected one.
  let answeredBy: string = provider;
  const text = await chatDirect(messages, {
    ...opts,
    onUsage: (u) => {
      reported = true;
      answeredBy = u.provider ?? provider;
      recordUsage({ ...u, provider: answeredBy });
    },
  });
  if (text && !reported) {
    recordUsage({
      provider,
      model,
      inputTokens: estimateTokens(promptChars(messages)),
      outputTokens: estimateTokens(text),
      estimated: true,
    });
  }
  if (key && text && answeredBy === provider && (!opts.cacheIf || opts.cacheIf(text))) await putCached(key, text, model);
  return text;
}

async function chatDirect(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  // The monthly quota is charged right before a request actually goes out
  // (after availability, key and rate-limit checks), so a request that
  // fails locally never spends a prompt.
  const charge = () => {
    if (opts.prepaid) return;
    if (opts.ownPrompt) {
      if (!consumeAiPrompt(new Date(), { silent: opts.ownPrompt === "silent" })) {
        throw new AiQuotaExceededError(aiQuotaStatus(new Date()).limit);
      }
      return;
    }
    chargeAiCommandDispatch();
  };
  const provider = getActiveProvider();

  // ── Ollama (local server) ──────────────────────────────────────
  if (provider === "ollama") {
    const { chatOllama, isOllamaAvailable, getBaseUrl } = await import("./ollamaProvider");
    if (await isOllamaAvailable()) {
      charge();
      return chatOllama(messages, opts);
    }
    toast.warn(
      t("ai.toast.ollamaUnavailable.title"),
      t("ai.toast.ollamaUnavailable.body", { url: getBaseUrl() }),
    );
    // Ollama is unreachable. Execution continues below: the anthropic /
    // gemini / mistral branches only match their own provider id, so they
    // are skipped; the WebGPU branch runs only if `useLocalAi` is on; and
    // otherwise we reach the OpenAI request at the end of this function,
    // which throws NO_KEY when no OpenAI key is configured.
  }

  // ── Anthropic Claude (cloud) ───────────────────────────────────
  if (provider === "anthropic") {
    const { chatAnthropic } = await import("./anthropicProvider");
    getProviderKey("anthropic"); // NO_KEY before anything is charged
    checkRateLimit();
    charge();
    inflight++;
    try {
      return await chatAnthropic(messages, opts);
    } finally {
      inflight--;
    }
  }

  // ── Google Gemini (cloud) ──────────────────────────────────────
  if (provider === "gemini") {
    const { chatGemini } = await import("./geminiProvider");
    getProviderKey("gemini"); // NO_KEY before anything is charged
    checkRateLimit();
    charge();
    inflight++;
    try {
      return await chatGemini(messages, opts);
    } finally {
      inflight--;
    }
  }

  // ── Mistral (cloud, OpenAI-compatible) ─────────────────────────
  if (provider === "mistral") {
    const { chatMistral } = await import("./mistralProvider");
    getProviderKey("mistral"); // NO_KEY before anything is charged
    checkRateLimit();
    charge();
    inflight++;
    try {
      return await chatMistral(messages, opts);
    } finally {
      inflight--;
    }
  }

  // ── WebGPU local (in-browser) ──────────────────────────────────
  if (provider === "local-webgpu" || useAppStore.getState().useLocalAi) {
    const { chatLocal, localLlmAvailable, onLocalLlmProgress } = await import(
      "./localLlm"
    );
    if (localLlmAvailable().available) {
      let lastPct = -1;
      const off = onLocalLlmProgress(({ progress, text }) => {
        const pct = Math.round(progress * 100);
        if (pct >= lastPct + 5 || pct === 100) {
          lastPct = pct;
          toast.info(
            t("ai.toast.localLoading.title"),
            t("ai.toast.localLoading.body", {
              pct,
              status: text || t("ai.toast.localLoading.preparing"),
            }),
          );
        }
      });
      try {
        charge();
        const text = await chatLocal(messages, { model: opts.model, maxTokens: opts.maxTokens, temperature: opts.temperature });
        opts.onUsage?.({
          provider: "local-webgpu",
          model: opts.model ?? "webgpu",
          inputTokens: estimateTokens(promptChars(messages)),
          outputTokens: estimateTokens(text),
          estimated: true,
        });
        return text;
      } finally {
        off();
      }
    }
    toast.warn(t("ai.toast.localUnavailable.title"), t("ai.toast.localUnavailable.body"), docsUrl("localLlm"));
  }

  // ── OpenAI (cloud) ─────────────────────────────────────────────
  const key = getAiKey();
  checkRateLimit();
  charge();
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

  try {
    const res = await fetchWithRetry(
      API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
        signal: opts.signal,
      },
      { label: "llm.chat", maxRetries: MAX_RETRIES, baseDelayMs: 500, maxDelayMs: 2000 },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AiError("API_ERROR", `API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AiError("PARSE_ERROR", "Empty AI response.");
    reportOpenAiUsage(data.usage, data.model ?? model, opts);
    return text;
  } catch (err) {
    if (opts.signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      return "";
    }
    throw err;
  } finally {
    inflight--;
  }
}

/**
 * Stream a chat completion. Yields text chunks as they arrive.
 * Routes through the active provider (Ollama / OpenAI / WebGPU).
 */
/** OpenAI-shaped `usage` (OpenAI, Mistral) → the usage meter. */
export function reportOpenAiUsage(
  usage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined,
  model: string,
  opts: ChatOptions,
  provider = "openai",
): void {
  if (!usage || typeof usage.prompt_tokens !== "number") return;
  // OpenAI caches long prompt prefixes automatically (billed at a discount).
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  opts.onUsage?.({
    provider,
    model,
    inputTokens: usage.prompt_tokens - cached,
    outputTokens: usage.completion_tokens ?? 0,
    ...(cached ? { cacheReadTokens: cached } : {}),
  });
}

/**
 * Stream a chat completion. Yields text chunks as they arrive. Usage is
 * recorded when the stream ends (exact when the provider reports it).
 */
export async function* chatStream(
  messages: ChatMessage[],
  options: ChatOptions = {},
): AsyncGenerator<string, void, undefined> {
  const provider = getActiveProvider();
  const opts = await routed(provider, options);
  let reported = false;
  let out = "";
  try {
    for await (const chunk of chatStreamDirect(messages, {
      ...opts,
      onUsage: (u) => {
        reported = true;
        recordUsage({ ...u, provider: u.provider ?? provider });
      },
    })) {
      out += chunk;
      yield chunk;
    }
  } finally {
    // Also on abort, a read error or the consumer stopping early: the
    // final usage event never arrived, but the generated text was billed.
    if (out && !reported) {
      recordUsage({
        provider,
        model: effectiveModel(provider, opts),
        inputTokens: estimateTokens(promptChars(messages)),
        outputTokens: estimateTokens(out),
        estimated: true,
      });
    }
  }
}

async function* chatStreamDirect(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string, void, undefined> {
  const charge = () => {
    if (opts.prepaid) return;
    if (opts.ownPrompt) {
      if (!consumeAiPrompt(new Date(), { silent: opts.ownPrompt === "silent" })) {
        throw new AiQuotaExceededError(aiQuotaStatus(new Date()).limit);
      }
      return;
    }
    chargeAiCommandDispatch();
  };
  const provider = getActiveProvider();

  if (provider === "ollama") {
    const { chatOllamaStream, isOllamaAvailable } = await import("./ollamaProvider");
    if (await isOllamaAvailable()) {
      charge();
      yield* chatOllamaStream(messages, opts);
      return;
    }
  }

  if (provider === "anthropic") {
    const { chatAnthropicStream } = await import("./anthropicProvider");
    getProviderKey("anthropic"); // NO_KEY before anything is charged
    charge();
    yield* chatAnthropicStream(messages, opts);
    return;
  }

  if (provider === "gemini") {
    const { chatGeminiStream } = await import("./geminiProvider");
    getProviderKey("gemini"); // NO_KEY before anything is charged
    charge();
    yield* chatGeminiStream(messages, opts);
    return;
  }

  if (provider === "mistral") {
    const { chatMistralStream } = await import("./mistralProvider");
    getProviderKey("mistral"); // NO_KEY before anything is charged
    charge();
    yield* chatMistralStream(messages, opts);
    return;
  }

  const key = getAiKey();
  checkRateLimit();
  charge();
  inflight++;
  const model = opts.model ?? DEFAULT_MODEL;

  try {
    const res = await fetchWithRetry(
      API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          // The last chunk then carries `usage` (empty `choices`).
          stream_options: { include_usage: true },
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        }),
        signal: opts.signal,
      },
      { label: "llm.chatStream", maxRetries: MAX_RETRIES, baseDelayMs: 500, maxDelayMs: 2000 },
    );

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
          if (json.usage) reportOpenAiUsage(json.usage, json.model ?? model, opts);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    throw err;
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
