/**
 * transformers.js worker — speech recognition (Whisper) and text
 * embeddings on this device, through ONNX Runtime on WebGPU or wasm.
 * The library (~1 MB) and the models live here; `src/ai/transformersEngine.ts`
 * is the client side of this protocol:
 *
 *   → { id, type: "transcribe", model, device, audio: Float32Array (16 kHz mono), language?, task? }
 *   → { id, type: "embed",      model, device, texts: string[] }
 *   → { id, type: "rerank",     model, device, query, passages: string[] }  → scores 0..1 (T29)
 *   → { id, type: "load",       task, model, device }
 *   → { id, type: "cancel",     target }         (skip a queued job, discard a running one's result)
 *   → { id, type: "unload" }
 *   ← { id, type: "progress", file, progress, loaded, total }   (model download)
 *   ← { id, type: "result",   value }
 *   ← { id, type: "error",    message }
 *
 * ONNX Runtime's wasm comes from this origin (public/ort/, staged by
 * scripts/copy-ort.mjs): the app's CSP allows no CDN. Model files come from
 * huggingface.co and are cached in the browser by the library.
 */

import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type FeatureExtractionPipeline,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";

export type Device = "webgpu" | "wasm";

export type WorkerIn =
  | { id: number; type: "transcribe"; model: string; device: Device; audio: Float32Array; language?: string; task?: "transcribe" | "translate" }
  | { id: number; type: "embed"; model: string; device: Device; texts: string[] }
  | { id: number; type: "rerank"; model: string; device: Device; query: string; passages: string[] }
  | { id: number; type: "load"; task: "automatic-speech-recognition" | "feature-extraction"; model: string; device: Device }
  | { id: number; type: "cancel"; target: number }
  | { id: number; type: "unload" };

export type WorkerOut =
  | { id: number; type: "progress"; file: string; progress: number; loaded: number; total: number }
  | { id: number; type: "result"; value: unknown }
  | { id: number; type: "error"; message: string };

export interface TranscribeResult {
  text: string;
  /** Detected (or requested) language code when the model reports one. */
  language?: string;
}

export interface EmbedResult {
  vectors: number[][];
  dims: number;
}

const post = (m: WorkerOut): void => (self as unknown as { postMessage(m: WorkerOut): void }).postMessage(m);

/** Same-origin ONNX Runtime files (see scripts/copy-ort.mjs). */
export function configureOrt(baseUrl: string, suffix: ".asyncify" | "" = ".asyncify"): void {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.useWasmCache = true;
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } } | undefined;
  if (onnx?.wasm) {
    onnx.wasm.wasmPaths = {
      mjs: `${baseUrl}ort-wasm-simd-threaded${suffix}.mjs`,
      wasm: `${baseUrl}ort-wasm-simd-threaded${suffix}.wasm`,
    };
  }
}

let asr: { key: string; pipe: AutomaticSpeechRecognitionPipeline } | null = null;
let embedder: { key: string; pipe: FeatureExtractionPipeline } | null = null;
let reranker: { key: string; tokenizer: PreTrainedTokenizer; model: PreTrainedModel } | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** Jobs cancelled by the client: skipped when queued, their result discarded when running. */
const cancelled = new Set<number>();

/** Whisper's window. Longer audio is cut into windows and transcribed one call at a time. */
export const WINDOW_SECONDS = 30;
const SAMPLE_RATE = 16_000;

function progressFor(id: number) {
  return (info: { status?: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
    if (info.status === "progress" && typeof info.progress === "number") {
      post({ id, type: "progress", file: info.file ?? "", progress: info.progress, loaded: info.loaded ?? 0, total: info.total ?? 0 });
    }
  };
}

/** Whisper on WebGPU: fp32 encoder + q4 decoder is the library's recommended split; wasm: q8. */
function asrOptions(device: Device) {
  return device === "webgpu"
    ? { device, dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } }
    : { device, dtype: "q8" };
}

async function getAsr(id: number, model: string, device: Device): Promise<AutomaticSpeechRecognitionPipeline> {
  const key = `${model}@${device}`;
  if (asr?.key === key) return asr.pipe;
  if (asr) await asr.pipe.dispose();
  asr = null;
  const pipe = (await pipeline("automatic-speech-recognition", model, { ...asrOptions(device), progress_callback: progressFor(id) } as never)) as AutomaticSpeechRecognitionPipeline;
  asr = { key, pipe };
  return pipe;
}

async function getEmbedder(id: number, model: string, device: Device): Promise<FeatureExtractionPipeline> {
  const key = `${model}@${device}`;
  if (embedder?.key === key) return embedder.pipe;
  if (embedder) await embedder.pipe.dispose();
  embedder = null;
  const pipe = (await pipeline("feature-extraction", model, { device, dtype: device === "webgpu" ? "fp32" : "q8", progress_callback: progressFor(id) } as never)) as FeatureExtractionPipeline;
  embedder = { key, pipe };
  return pipe;
}

/**
 * Cut audio into Whisper-sized windows at the quietest sample near each
 * boundary (within ±2 s), so a cut rarely lands mid-word. The library's
 * own `chunk_length_s` path is avoided: with the WebGPU backend it leaks
 * GPU memory per chunk (transformers.js #1739), and one call per window
 * does not.
 */
export function windowsOf(audio: Float32Array, windowSeconds = WINDOW_SECONDS, sampleRate = SAMPLE_RATE): Float32Array[] {
  const size = windowSeconds * sampleRate;
  if (audio.length <= size) return [audio];
  const out: Float32Array[] = [];
  const slack = 2 * sampleRate;
  let start = 0;
  while (audio.length - start > size) {
    const target = start + size;
    let cut = target;
    let quietest = Infinity;
    for (let i = Math.max(start + size - slack, start + 1); i < Math.min(target + slack, audio.length); i += 160) {
      let energy = 0;
      for (let j = i; j < Math.min(i + 160, audio.length); j++) energy += audio[j] * audio[j];
      if (energy < quietest) {
        quietest = energy;
        cut = i;
      }
    }
    out.push(audio.subarray(start, cut));
    start = cut;
  }
  out.push(audio.subarray(start));
  return out;
}

async function transcribe(id: number, msg: Extract<WorkerIn, { type: "transcribe" }>): Promise<TranscribeResult> {
  const pipe = await getAsr(id, msg.model, msg.device);
  const kwargs = { ...(msg.language ? { language: msg.language } : {}), task: msg.task ?? "transcribe" };
  const parts: string[] = [];
  let language: string | undefined;
  for (const window of windowsOf(msg.audio)) {
    if (cancelled.has(id)) throw new DOMException("aborted", "AbortError");
    const out = (await pipe(window, kwargs)) as { text?: string; language?: string } | Array<{ text?: string }>;
    parts.push(Array.isArray(out) ? out.map((o) => o.text ?? "").join(" ") : (out.text ?? ""));
    if (!Array.isArray(out) && out.language && !language) language = out.language;
  }
  const text = parts.map((p) => p.trim()).filter(Boolean).join(" ");
  return { text, ...(language ? { language } : {}) };
}

async function embed(id: number, msg: Extract<WorkerIn, { type: "embed" }>): Promise<EmbedResult> {
  const pipe = await getEmbedder(id, msg.model, msg.device);
  const tensor = await pipe(msg.texts, { pooling: "mean", normalize: true });
  const vectors = tensor.tolist() as number[][];
  return { vectors, dims: vectors[0]?.length ?? 0 };
}

/** Cross-encoder reranking (bge-reranker-v2-m3): one relevance score per passage. */
async function rerank(id: number, msg: Extract<WorkerIn, { type: "rerank" }>): Promise<number[]> {
  const key = `${msg.model}@${msg.device}`;
  if (reranker?.key !== key) {
    if (reranker) await reranker.model.dispose();
    reranker = null;
    const opts = { device: msg.device, dtype: msg.device === "webgpu" ? "fp16" : "q8", progress_callback: progressFor(id) } as never;
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(msg.model, { progress_callback: progressFor(id) } as never),
      AutoModelForSequenceClassification.from_pretrained(msg.model, opts),
    ]);
    reranker = { key, tokenizer, model };
  }
  const scores: number[] = [];
  // Small batches keep memory flat on long result lists.
  for (let i = 0; i < msg.passages.length; i += 8) {
    if (cancelled.has(id)) throw new DOMException("aborted", "AbortError");
    const batch = msg.passages.slice(i, i + 8);
    const inputs = reranker.tokenizer(new Array(batch.length).fill(msg.query), { text_pair: batch, padding: true, truncation: true, max_length: 512 } as never);
    const { logits } = (await reranker.model(inputs)) as { logits: { sigmoid(): { tolist(): number[][] } } };
    for (const row of logits.sigmoid().tolist()) scores.push(row[0] ?? 0);
  }
  return scores;
}

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn);
  queue = p.catch(() => undefined);
  return p;
}

/** Run a cancellable job: skipped if cancelled while queued; its result dropped if cancelled while running. */
async function job<T>(id: number, fn: () => Promise<T>): Promise<T> {
  return serial(async () => {
    if (cancelled.delete(id)) throw new DOMException("aborted", "AbortError");
    try {
      const value = await fn();
      if (cancelled.delete(id)) throw new DOMException("aborted", "AbortError");
      return value;
    } finally {
      cancelled.delete(id);
    }
  });
}

export async function handle(msg: WorkerIn): Promise<void> {
  const { id } = msg;
  try {
    switch (msg.type) {
      case "transcribe":
        post({ id, type: "result", value: await job(id, () => transcribe(id, msg)) });
        return;
      case "embed":
        post({ id, type: "result", value: await job(id, () => embed(id, msg)) });
        return;
      case "rerank":
        post({ id, type: "result", value: await job(id, () => rerank(id, msg)) });
        return;
      case "cancel":
        cancelled.add(msg.target);
        post({ id, type: "result", value: true });
        return;
      case "load":
        await serial<unknown>(() => (msg.task === "automatic-speech-recognition" ? getAsr(id, msg.model, msg.device) : getEmbedder(id, msg.model, msg.device)));
        post({ id, type: "result", value: msg.model });
        return;
      case "unload": {
        const a = asr;
        const e = embedder;
        const r = reranker;
        asr = null;
        embedder = null;
        reranker = null;
        await a?.pipe.dispose();
        await e?.pipe.dispose();
        await r?.model.dispose();
        post({ id, type: "result", value: true });
        return;
      }
    }
  } catch (e) {
    post({ id, type: "error", message: (e as Error)?.message ?? String(e) });
  }
}

const ctx = self as unknown as { location?: { origin: string }; onmessage: ((ev: MessageEvent<WorkerIn & { ortBase?: string; ortSuffix?: ".asyncify" | "" }>) => void) | null };
let configured = false;
ctx.onmessage = (ev) => {
  if (!configured) {
    configureOrt(ev.data.ortBase ?? `${ctx.location?.origin ?? ""}/ort/`, ev.data.ortSuffix ?? ".asyncify");
    configured = true;
  }
  void handle(ev.data);
};
