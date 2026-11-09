/**
 * The LLM service's providers, models and routing: which provider is
 * active and allowed by the AI policy, its key and default model, the
 * light-model routing, the shared request types and errors, and OpenAI-style
 * usage reporting. Split out of ./llm.ts (plan 12.1), which re-exports it;
 * the calls themselves (chat, chatStream) and the rate limiter stay there.
 */
import { useAppStore } from "../store/useStore";
import type { Usage } from "./usage";
import { cloudAllowed, getAiPolicy, isCloudProvider, isLocalOrigin, providerAllowed } from "./policy";
import { getSecret } from "../lib/secretStore";

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
   * Charges the quota instead of `prepaid` / `ownPrompt` — the agent
   * runtime's once-per-run charge, called at dispatch like the others.
   */
  chargeHook?: () => void;
  /**
   * Reuse an identical earlier answer from the local response cache (and
   * store this one). Only for deterministic transformations of the given
   * text; ignored when the user turned the cache off.
   */
  cache?: boolean;
  /**
   * "light": a small task (tags, titles, outline, completions). In the
   * economy / balanced AI modes it goes to the provider's small model
   * unless `model` pins one. Economy mode routes every unpinned request.
   */
  tier?: "light" | "heavy";
  /**
   * With `cache`: store the answer only when this accepts it (e.g. it
   * parses), so a malformed answer is retried next time, not replayed.
   */
  cacheIf?: (text: string) => boolean;
  /**
   * Internal: providers report token usage here (exact where the API
   * returns it). `provider` overrides the selected one when the request
   * was routed elsewhere (fallbacks, local WebGPU).
   */
  onUsage?: (u: Omit<Usage, "provider"> & { provider?: string }) => void;
  /** Internal: the provider a fallback actually sent the request to. */
  onRoute?: (provider: AiProvider, model: string) => void;
  /**
   * Internal: `model` was chosen by the model router for the selected
   * provider, not pinned by the caller — a local reroute must drop it.
   */
  modelFromRouter?: boolean;
}

export const DEFAULT_MODEL = "gpt-4o-mini";
/** Each cloud provider's model when the user hasn't picked one (the provider modules use these). */
export const PROVIDER_DEFAULT_MODELS = {
  // The in-browser default when the user picked none and the GPU wasn't
  // probed yet; the model manager (./modelManager.ts) picks by hardware.
  "local-webgpu": "Qwen3-4B-q4f16_1-MLC",
  // Sonnet 4.5 is deprecated (retires 30 Nov 2026); Sonnet 5.5 is the current general model.
  anthropic: "claude-sonnet-5-5",
  gemini: "gemini-1.5-flash",
  mistral: "mistral-small-latest",
} as const;
export const API_URL = "https://api.openai.com/v1/chat/completions";
export const MAX_RETRIES = 2;

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
    public code: "NO_KEY" | "API_ERROR" | "PARSE_ERROR" | "ABORTED" | "POLICY" | "NO_LOCAL",
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/**
 * The AI policy gate (./policy.ts). A cloud provider is contacted only
 * when the policy allows it: as the selected provider under `cloud` /
 * `local-first`, or as the fallback when a local provider is unavailable
 * under `local-first`. Under `local-only` the request stops here with a
 * clear code instead of silently reaching a third party.
 */
export function assertCloudProvider(provider: AiProvider): void {
  if (!providerAllowed(provider)) {
    throw new AiError("POLICY", `AI policy is "${getAiPolicy()}": ${provider} is a cloud provider and was not contacted.`);
  }
}

/**
 * Where a request goes when a CLOUD provider is selected but the policy
 * prefers local backends:
 *
 *   local-first  a reachable Ollama server, else in-browser WebGPU when the
 *                user turned Privacy Mode on (never a surprise multi-GB
 *                download for someone who picked a cloud provider), else
 *                null — the cloud provider answers.
 *   local-only   Ollama, else WebGPU, else NO_LOCAL — the cloud provider is
 *                never contacted.
 *   cloud        null.
 *
 * A selected local provider returns null and takes the normal branches.
 */
export async function localRoute(provider: AiProvider): Promise<"ollama" | "local-webgpu" | null> {
  if (!isCloudProvider(provider)) return null;
  const policy = getAiPolicy();
  if (policy === "cloud") return null;
  const { isOllamaAvailable, getBaseUrl } = await import("./ollamaProvider");
  // A custom Ollama URL on a public origin is a third party, not a local route.
  if (isLocalOrigin(getBaseUrl()) && (await isOllamaAvailable())) return "ollama";
  if (policy === "local-only" || useAppStore.getState().useLocalAi) {
    const { localLlmAvailable } = await import("./localLlm");
    if (localLlmAvailable().available) return "local-webgpu";
  }
  if (policy === "local-only") {
    throw new AiError("NO_LOCAL", `AI policy is "local-only": ${provider} is a cloud provider and no local backend (Ollama, WebGPU) is available.`);
  }
  return null;
}

/** Under `local-only`, an Ollama server off this machine / network is a third party. */
export function assertOllamaOrigin(baseUrl: string): void {
  if (getAiPolicy() === "local-only" && !isLocalOrigin(baseUrl)) {
    throw new AiError("POLICY", `AI policy is "local-only": the Ollama server at ${baseUrl} is not on this machine or network.`);
  }
}

export function assertCloudFallback(unavailable: string): void {
  if (!cloudAllowed()) {
    throw new AiError("NO_LOCAL", `${unavailable} is unavailable and the AI policy is "local-only", so no cloud fallback was used.`);
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
  } catch { /* why: storage denied: fall back to the default provider below */ }
  const state = useAppStore.getState();
  if (state.useLocalAi) return "local-webgpu";
  return "openai";
}

export function setActiveProvider(provider: AiProvider): void {
  localStorage.setItem("lumen.ai.provider", provider);
}

/**
 * Return the API key for a cloud provider. Per-provider keys live in
 * the encrypted secret store (`lumen.ai.key.<provider>`, see lib/secretStore); OpenAI falls back to the primary
 * `aiKey` in the store for backwards compatibility. Throws if none is set.
 */
export function getProviderKey(provider: AiProvider): string {
  let key = "";
  try {
    key = getSecret(`lumen.ai.key.${provider}`) ?? "";
  } catch { /* why: secret store unavailable: fall through to the store key and then the missing-key error */ }
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
  anthropic: "claude-haiku-5-5",
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
  if (opts.tier === "light" || mode === "economy") return { ...opts, model: light, modelFromRouter: true };
  return opts;
}

/** Options for a request rerouted to a local backend: a router-chosen cloud model name must not travel with it. */
export function forLocal(opts: ChatOptions): ChatOptions {
  return opts.modelFromRouter ? { ...opts, model: undefined, modelFromRouter: false } : opts;
}

export async function routed(provider: AiProvider, opts: ChatOptions): Promise<ChatOptions> {
  const { getAiMode } = await import("./contextPacker");
  return routeOptions(provider, opts, getAiMode());
}

export const promptChars = (messages: ChatMessage[]) => messages.map((m) => m.content).join("\n");

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
