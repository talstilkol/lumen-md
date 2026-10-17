/**
 * transformers.js worker — speech recognition (Whisper) and text
 * embeddings on this device, through ONNX Runtime on WebGPU or wasm.
 * The library (~1 MB) and the models live here; `src/ai/transformersEngine.ts`
 * is the client side of this protocol:
 *
 *   → { id, type: "transcribe", model, device, audio: Float32Array (16 kHz mono), language?, task? }
 *   → { id, type: "embed",      model, device, texts: string[] }
 *   → { id, type: "load",       task, model, device }
 *   → { id, type: "unload" }
 *   ← { id, type: "progress", file, progress, loaded, total }   (model download)
 *   ← { id, type: "result",   value }
 *   ← { id, type: "error",    message }
 *
 * ONNX Runtime's wasm comes from this origin (public/ort/, staged by
 * scripts/copy-ort.mjs): the app's CSP allows no CDN. Model files come from
 * huggingface.co and are cached in the browser by the library.
 */

import { env, pipeline, type AutomaticSpeechRecognitionPipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export type Device = "webgpu" | "wasm";

export type WorkerIn =
  | { id: number; type: "transcribe"; model: string; device: Device; audio: Float32Array; language?: string; task?: "transcribe" | "translate" }
  | { id: number; type: "embed"; model: string; device: Device; texts: string[] }
  | { id: number; type: "load"; task: "automatic-speech-recognition" | "feature-extraction"; model: string; device: Device }
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
let queue: Promise<unknown> = Promise.resolve();

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

async function transcribe(id: number, msg: Extract<WorkerIn, { type: "transcribe" }>): Promise<TranscribeResult> {
  const pipe = await getAsr(id, msg.model, msg.device);
  const seconds = msg.audio.length / 16_000;
  const out = (await pipe(msg.audio, {
    ...(msg.language ? { language: msg.language } : {}),
    task: msg.task ?? "transcribe",
    // Whisper sees 30 s windows; longer memos are chunked with overlap.
    ...(seconds > 30 ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
  })) as { text?: string; language?: string } | Array<{ text?: string }>;
  const text = Array.isArray(out) ? out.map((o) => o.text ?? "").join(" ") : (out.text ?? "");
  const language = Array.isArray(out) ? undefined : out.language;
  return { text: text.trim(), ...(language ? { language } : {}) };
}

async function embed(id: number, msg: Extract<WorkerIn, { type: "embed" }>): Promise<EmbedResult> {
  const pipe = await getEmbedder(id, msg.model, msg.device);
  const tensor = await pipe(msg.texts, { pooling: "mean", normalize: true });
  const vectors = tensor.tolist() as number[][];
  return { vectors, dims: vectors[0]?.length ?? 0 };
}

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn);
  queue = p.catch(() => undefined);
  return p;
}

export async function handle(msg: WorkerIn): Promise<void> {
  const { id } = msg;
  try {
    switch (msg.type) {
      case "transcribe":
        post({ id, type: "result", value: await serial(() => transcribe(id, msg)) });
        return;
      case "embed":
        post({ id, type: "result", value: await serial(() => embed(id, msg)) });
        return;
      case "load":
        await serial<unknown>(() => (msg.task === "automatic-speech-recognition" ? getAsr(id, msg.model, msg.device) : getEmbedder(id, msg.model, msg.device)));
        post({ id, type: "result", value: msg.model });
        return;
      case "unload": {
        const a = asr;
        const e = embedder;
        asr = null;
        embedder = null;
        await a?.pipe.dispose();
        await e?.pipe.dispose();
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
