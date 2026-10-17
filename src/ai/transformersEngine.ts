/**
 * Client of the transformers.js worker (./transformers.worker.ts): speech
 * recognition and text embeddings on this device. The library, ONNX
 * Runtime and the models live in the worker; this module is message
 * passing plus the model choice by hardware.
 *
 *   transcribeAudio(samples, { language })  → { text, language? }
 *   embedTextsLocal(texts)                  → { vectors, dims }
 *
 * Models (Hugging Face `onnx-community`, cached in the browser):
 *   Whisper   WebGPU: whisper-small (~250 MB), whisper-large-v3-turbo on a
 *             strong GPU (~800 MB); wasm: whisper-tiny (~40 MB). All three
 *             are multilingual (Hebrew included).
 *   Embeddings multilingual-e5-small (384 dims, ~100 languages).
 */

import type { Device, EmbedResult, TranscribeResult, WorkerIn, WorkerOut } from "./transformers.worker";
import { detectHardware, vramBudgetMB, type Hardware } from "./modelManager";

export type { TranscribeResult, EmbedResult };

export const WHISPER_MODELS = {
  tiny: "onnx-community/whisper-tiny",
  small: "onnx-community/whisper-small",
  turbo: "onnx-community/whisper-large-v3-turbo",
} as const;

export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const EMBEDDING_DIMS = 384;

export interface DownloadProgress {
  file: string;
  /** 0–100 for the current file. */
  progress: number;
  loaded: number;
  total: number;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
let listeners: Array<(p: DownloadProgress) => void> = [];

export function onTransformersProgress(cb: (p: DownloadProgress) => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function failAll(message: string): void {
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./transformers.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (ev: MessageEvent<WorkerOut>) => {
    const m = ev.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === "progress") {
      for (const l of listeners) l({ file: m.file, progress: m.progress, loaded: m.loaded, total: m.total });
      return;
    }
    pending.delete(m.id);
    if (m.type === "result") p.resolve(m.value);
    else p.reject(new Error(m.message));
  };
  w.onerror = (ev) => failAll(`transformers worker error: ${ev.message || "unknown"}`);
  worker = w;
  return w;
}

type WorkerCall = WorkerIn extends infer M ? (M extends { id: number } ? Omit<M, "id"> : never) : never;

function call<T>(msg: WorkerCall, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...msg, id, ortBase: `${location.origin}/ort/` }, transfer);
  });
}

/** WebGPU when the adapter is usable, else wasm (always available). */
export async function transformersDevice(hw?: Hardware): Promise<Device> {
  const h = hw ?? (await detectHardware());
  return h.webgpu ? "webgpu" : "wasm";
}

/** The Whisper model for this device: turbo needs a real GPU budget, small fits most laptops, tiny for wasm. */
export function whisperModelFor(hw: Hardware, device: Device = hw.webgpu ? "webgpu" : "wasm"): string {
  if (device !== "webgpu") return WHISPER_MODELS.tiny;
  return vramBudgetMB(hw) >= 6_000 && !hw.mobile ? WHISPER_MODELS.turbo : WHISPER_MODELS.small;
}

/** Transcribe 16 kHz mono PCM. `language` is an ISO-639-1 code ("he", "en"); omitted = auto-detect. */
export async function transcribeAudio(samples: Float32Array, opts: { language?: string; model?: string; signal?: AbortSignal } = {}): Promise<TranscribeResult> {
  if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
  const hw = await detectHardware();
  const device = await transformersDevice(hw);
  const model = opts.model ?? whisperModelFor(hw, device);
  // The buffer is transferred, not copied; callers must not reuse it.
  return call<TranscribeResult>({ type: "transcribe", model, device, audio: samples, language: opts.language, task: "transcribe" }, [samples.buffer]);
}

/** Normalised embeddings (mean pooled) for `texts`. */
export async function embedTextsLocal(texts: string[], opts: { model?: string } = {}): Promise<EmbedResult> {
  if (!texts.length) return { vectors: [], dims: EMBEDDING_DIMS };
  const device = await transformersDevice();
  return call<EmbedResult>({ type: "embed", model: opts.model ?? EMBEDDING_MODEL, device, texts });
}

/** Download / compile a model ahead of time. */
export async function preloadTransformersModel(task: "automatic-speech-recognition" | "feature-extraction", model?: string): Promise<string> {
  const hw = await detectHardware();
  const device = await transformersDevice(hw);
  const id = model ?? (task === "automatic-speech-recognition" ? whisperModelFor(hw, device) : EMBEDDING_MODEL);
  return call<string>({ type: "load", task, model: id, device });
}

/** Free the models and terminate the worker. */
export async function unloadTransformers(): Promise<void> {
  const w = worker;
  if (!w) return;
  try {
    await call<boolean>({ type: "unload" });
  } catch {
    /* worker may already be gone */
  }
  worker = null;
  failAll("transformers worker unloaded");
  w.terminate();
}

/**
 * Decode any audio blob the browser can play into 16 kHz mono PCM, the
 * input Whisper expects. Runs on the main thread: workers have no
 * AudioContext.
 */
export async function decodeAudioTo16k(blob: Blob): Promise<Float32Array> {
  const Ctx = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext; AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctx) throw new Error("Web Audio is not available in this browser");
  const ctx = new Ctx({ sampleRate: 16_000 });
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (decoded.numberOfChannels === 1 && decoded.sampleRate === 16_000) return decoded.getChannelData(0).slice();
    const length = Math.ceil(decoded.duration * 16_000);
    const offline = new OfflineAudioContext(1, length, 16_000);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Tests. */
export function __resetTransformersEngine(): void {
  worker = null;
  pending.clear();
  listeners = [];
}
