/**
 * Voice → text transcription (γ.4 / F2).
 *
 * Two backends:
 *   - **Cloud** (default): POSTs the audio blob to OpenAI's
 *     `/v1/audio/transcriptions` (`whisper-1` model). Fast (≤5 s for a
 *     30 s memo), needs an API key.
 *   - **Local** (Privacy Mode): dynamic-imports
 *     `@xenova/transformers` and runs `Xenova/whisper-tiny.en` on the
 *     device. Slower (~30 s for 30 s of audio on a recent laptop) but
 *     no network — the audio never leaves the browser.
 *
 * The choice is driven by `useAppStore.useLocalAi`. Both paths return
 * the same `TranscribeResult` shape so the caller stays branch-free.
 *
 * The summary step is in `summarizeMemo()` — it routes through the
 * existing `chat()` so Privacy Mode also keeps the summary on-device
 * (Llama-3 via web-llm).
 */

import { useAppStore } from "../store/useStore";
import { chat, getAiKey, AiError } from "./llm";
import { PROMPTS } from "./prompts";
import { log } from "../lib/logger";

export interface TranscribeOptions {
  /** Override the language hint sent to Whisper (default: auto). */
  language?: string;
  /** AbortSignal for cancelling long-running Whisper jobs. */
  signal?: AbortSignal;
}

export interface TranscribeResult {
  /** Plain-text transcript. */
  text: string;
  /** "cloud" | "local" — the backend that produced the result. */
  backend: "cloud" | "local";
  /** Wall-clock duration of the transcription pass, in ms. */
  ms: number;
}

const OPENAI_TRANSCRIPTION_URL =
  "https://api.openai.com/v1/audio/transcriptions";

/**
 * Run Whisper on the supplied audio blob. Routes to local or cloud
 * based on Privacy Mode.
 */
export async function transcribe(
  blob: Blob,
  opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const useLocal = useAppStore.getState().useLocalAi;
  const start = performance.now();
  if (useLocal) {
    const text = await transcribeLocal(blob);
    return { text, backend: "local", ms: performance.now() - start };
  }
  const text = await transcribeCloud(blob, opts);
  return { text, backend: "cloud", ms: performance.now() - start };
}

async function transcribeCloud(
  blob: Blob,
  opts: TranscribeOptions,
): Promise<string> {
  const key = getAiKey(); // throws AiError("NO_KEY") if missing
  const form = new FormData();
  form.append("file", blob, "memo.webm");
  form.append("model", "whisper-1");
  if (opts.language) form.append("language", opts.language);
  form.append("response_format", "json");
  const res = await fetch(OPENAI_TRANSCRIPTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: opts.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AiError(
      "API_ERROR",
      `Whisper failed (${res.status}): ${detail.slice(0, 160)}`,
    );
  }
  const json = (await res.json()) as { text?: string };
  if (typeof json.text !== "string") {
    throw new AiError("PARSE_ERROR", "Whisper response missing `text` field");
  }
  return json.text.trim();
}

/**
 * Local fallback via `@xenova/transformers`. The library is
 * dynamic-imported so it's not in the main bundle — first invocation
 * downloads ~75 MB of the whisper-tiny model into the cache.
 *
 * Implementation note: the `pipeline()` API takes a Blob/ArrayBuffer
 * URL. We hand it the in-memory blob URL we just made.
 */
async function transcribeLocal(blob: Blob): Promise<string> {
  let pipelineFn: PipelineLoader;
  try {
    // String-built specifier so TS doesn't try to resolve the optional
    // peer dep at compile time. The package is only installed in
    // deployments that actually want local Whisper.
    const specifier = "@xenova/transformers";
    const xenova = (await import(/* @vite-ignore */ specifier)) as {
      pipeline: PipelineLoader;
    };
    pipelineFn = xenova.pipeline;
  } catch (err) {
    log.warn("local whisper unavailable", err);
    throw new AiError(
      "API_ERROR",
      "Local transcription requires `@xenova/transformers`. Install it or turn off Privacy Mode.",
    );
  }
  const whisper = (await pipelineFn(
    "automatic-speech-recognition",
    "Xenova/whisper-tiny.en",
  )) as (input: ArrayBuffer) => Promise<{ text: string } | { text: string }[]>;
  const buf = await blob.arrayBuffer();
  const out = await whisper(buf);
  const text = Array.isArray(out) ? out[0]?.text : out.text;
  if (typeof text !== "string") {
    throw new AiError("PARSE_ERROR", "Local whisper returned no text");
  }
  return text.trim();
}

type PipelineLoader = (
  task: string,
  model: string,
) => Promise<unknown>;

/**
 * Two-bullet summary of a transcript. Routes through `chat()` so it
 * honors Privacy Mode (local Llama via web-llm) automatically.
 */
export async function summarizeMemo(transcript: string): Promise<string> {
  if (!transcript.trim()) return "";
  return chat(
    [
      { role: "system", content: PROMPTS.summarize },
      { role: "user", content: transcript },
    ],
    { maxTokens: 120 },
  );
}

/**
 * Format a memo for insertion at the editor cursor. The summary lives
 * in a quote block; the full transcript collapses behind a `<details>`
 * so it doesn't dominate the surrounding doc.
 */
export function formatVoiceMemo(args: {
  transcript: string;
  summary: string;
  date?: Date;
  backend: "cloud" | "local";
}): string {
  const date = (args.date ?? new Date()).toISOString().slice(0, 16).replace("T", " ");
  const tagSuffix = args.backend === "local" ? " · 🛡 local" : "";
  return [
    `> 🎙 Voice memo · ${date}${tagSuffix}`,
    "",
    args.summary || "_(no summary available)_",
    "",
    "<details><summary>Full transcript</summary>",
    "",
    args.transcript,
    "",
    "</details>",
    "",
  ].join("\n");
}
