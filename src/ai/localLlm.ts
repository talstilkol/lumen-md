/**
 * Local LLM bridge — wraps `@mlc-ai/web-llm` to run a model entirely in the
 * browser via WebGPU. Lets users with a capable GPU keep prompts private and
 * work offline (no network call after the first model download).
 *
 * The engine + the model weights are large (≈ 4 GB for Llama-3-8B-Instruct
 * q4f16_1), so:
 *   - The library is dynamic-imported only when `chatLocal()` is invoked,
 *     keeping the regular bundle slim.
 *   - The engine instance is cached so subsequent calls reuse the same
 *     download.
 *   - We expose a `loadProgress(cb)` helper so the UI can render a status
 *     line during the first download.
 *
 * If WebGPU isn't available, `localLlmAvailable()` returns false and the
 * caller should fall back to the cloud API.
 */

import type { ChatMessage } from "./llm";

const DEFAULT_MODEL_ID = "Llama-3-8B-Instruct-q4f16_1-MLC";

let enginePromise: Promise<unknown> | null = null;
let progressListeners: Array<(p: { progress: number; text: string }) => void> = [];

export interface LocalLlmStatus {
  available: boolean;
  /** Why local LLM is unavailable, if it is. */
  reason?: string;
}

export function localLlmAvailable(): LocalLlmStatus {
  if (typeof window === "undefined") return { available: false, reason: "Not in browser" };
  if (!("gpu" in navigator)) {
    return { available: false, reason: "WebGPU not supported by this browser" };
  }
  return { available: true };
}

export function onLocalLlmProgress(cb: (p: { progress: number; text: string }) => void): () => void {
  progressListeners.push(cb);
  return () => {
    progressListeners = progressListeners.filter((l) => l !== cb);
  };
}

interface MlcEngine {
  reload: (model: string) => Promise<void>;
  chat: {
    completions: {
      create: (req: {
        messages: ChatMessage[];
        max_tokens?: number;
        temperature?: number;
      }) => Promise<{ choices: { message: { content: string } }[] }>;
    };
  };
}

/**
 * Returns the singleton MLC engine, creating + warming it on first call.
 * The model download is reported via `progressListeners` so the UI can
 * surface "Loading Llama-3 (35%)…" strings instead of looking frozen.
 */
async function getEngine(modelId: string): Promise<MlcEngine> {
  if (enginePromise) return enginePromise as Promise<MlcEngine>;
  enginePromise = (async () => {
    const pkg = "@mlc-ai/web-llm";
    const mod = (await import(/* @vite-ignore */ pkg)) as {
      CreateMLCEngine: (
        model: string,
        opts: { initProgressCallback: (r: { progress: number; text: string }) => void },
      ) => Promise<MlcEngine>;
    };
    const engine = await mod.CreateMLCEngine(modelId, {
      initProgressCallback: (r) => {
        for (const l of progressListeners) l(r);
      },
    });
    return engine;
  })();
  return enginePromise as Promise<MlcEngine>;
}

/**
 * Run a chat completion locally via WebGPU. Mirrors the `chat()` signature
 * from `./llm` so callers can swap providers without touching their code.
 */
export async function chatLocal(
  messages: ChatMessage[],
  opts: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const status = localLlmAvailable();
  if (!status.available) {
    throw new Error(`Local LLM unavailable: ${status.reason}`);
  }
  const engine = await getEngine(opts.model ?? DEFAULT_MODEL_ID);
  const res = await engine.chat.completions.create({
    messages,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
  });
  const text = res.choices[0]?.message.content?.trim();
  if (!text) throw new Error("Local LLM returned an empty response.");
  return text;
}

/** Drop the cached engine — useful when switching models. */
export function unloadLocalLlm(): void {
  enginePromise = null;
}
