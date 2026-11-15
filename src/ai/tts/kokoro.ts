/**
 * Neural English read-aloud (plan 6.2, W10.E65): Kokoro-82M (Apache-2.0
 * weights) behind a seam, dormant until decision 15.10 and a pinned model.
 *
 * - ENGLISH_VOICES is empty: no Kokoro model is pinned (URL at a revision,
 *   size, sha256) and decision 15.10 is open, so `englishNeuralVoice()` is
 *   null and read-aloud stays on the system voices.
 * - No kokoro-js: it bundles eSpeak NG (GPL-3.0), which the licence gate
 *   fails (ttsLicence.test.ts). The model runs in our own worker
 *   (./kokoro.worker.ts, onnxruntime-web, MIT). English text → token ids is
 *   a seam too (`setEnglishPhonemizer`): a permissively licensed G2P is part
 *   of 15.10; without one the engine refuses to load.
 * - With a voice: the download is explicit (the user is asked, with the
 *   size, before any request), both files are checked against their sha256
 *   (neuralReader.verifiedFile, Cache Storage "lumen-voices"), and after
 *   that reading makes no request. The next sentence is synthesized while
 *   the current one plays.
 */
import type { Sentence, WordRange } from "../tts";
import type { VoiceFile } from "./voices";

export interface KokoroPack {
  id: string;
  language: "en";
  /** Licence of the weights AND of the data they were trained on. */
  license: string;
  attribution: string;
  /** kokoro-v1.0 ONNX. */
  model: VoiceFile;
  /** The voice's style vectors (float32, rows × 256; the row is picked by token count). */
  voice: VoiceFile;
  sampleRate: number;
}

/** No Kokoro model pinned yet (decision 15.10). */
export const ENGLISH_VOICES: readonly KokoroPack[] = [];

export interface RegistryEntry {
  id: string;
  class: string;
  verified: boolean;
}

const pinned = (f: VoiceFile) => /^https:\/\//.test(f.url) && f.bytes > 0 && /^[0-9a-f]{64}$/.test(f.sha256);

/** Packs whose registry entry allows them (class allowed, verified) and whose files are pinned. */
export function usableKokoro(packs: readonly KokoroPack[], registry: readonly RegistryEntry[]): KokoroPack[] {
  const ok = new Map(registry.map((e) => [e.id, e.class === "allowed" && e.verified === true]));
  return packs.filter((p) => ok.get(p.id) === true && pinned(p.model) && pinned(p.voice));
}

/** English text → Kokoro token ids. */
export type EnglishPhonemizer = (text: string) => Promise<number[]>;
let phonemizer: EnglishPhonemizer | null = null;
/** Register the English G2P (null removes it). */
export function setEnglishPhonemizer(p: EnglishPhonemizer | null): void {
  phonemizer = p;
}

/** The engine the reader drives: text in, audio at `sampleRate` out. */
export interface KokoroEngine {
  sampleRate: number;
  synth(text: string, speed: number): Promise<Float32Array>;
}

/** The voice to read English with, or null (today: always null). */
export async function englishNeuralVoice(packs: readonly KokoroPack[] = ENGLISH_VOICES): Promise<KokoroPack | null> {
  if (!packs.length) return null;
  const mod = (await import("../../../models/registry.json")) as unknown as { default?: { models: RegistryEntry[] }; models?: RegistryEntry[] };
  return usableKokoro(packs, (mod.default ?? mod).models ?? [])[0] ?? null;
}

/** Style row for a token count (Kokoro voices hold one 256-value row per length). */
export function styleFor(voice: Float32Array, tokens: number, width = 256): Float32Array {
  const rows = Math.floor(voice.length / width);
  if (!rows) throw new Error("kokoro: the voice file has no style rows");
  const r = Math.min(Math.max(tokens, 0), rows - 1);
  return voice.slice(r * width, (r + 1) * width);
}

export interface LoadDeps {
  /** Asked once, before anything is downloaded: the pack and the total size. */
  consent: (pack: KokoroPack, bytes: number) => Promise<boolean>;
  /** neuralReader.verifiedFile, or a stand-in in tests. */
  fetchVerified?: (f: VoiceFile) => Promise<ArrayBuffer>;
  /** The model runner: the worker by default. */
  run?: (model: ArrayBuffer) => Promise<(ids: number[], style: Float32Array, speed: number) => Promise<Float32Array>>;
  phonemize?: EnglishPhonemizer | null;
}

/**
 * Load the engine for `pack`: no G2P → refused before anything else; no
 * consent → refused before any request; then both files, checked.
 */
export async function loadKokoro(pack: KokoroPack, deps: LoadDeps): Promise<KokoroEngine> {
  const g2p = deps.phonemize === undefined ? phonemizer : deps.phonemize;
  if (!g2p) throw new Error("kokoro: no English phonemizer is registered (decision 15.10)");
  if (!(await deps.consent(pack, pack.model.bytes + pack.voice.bytes))) throw new Error("kokoro: the download was not allowed");
  const fetchVerified = deps.fetchVerified ?? (async (f: VoiceFile) => (await import("./neuralReader")).verifiedFile(f));
  const [model, voice] = await Promise.all([fetchVerified(pack.model), fetchVerified(pack.voice)]);
  const styles = new Float32Array(voice);
  const run = await (deps.run ?? workerRunner)(model);
  return {
    sampleRate: pack.sampleRate,
    async synth(text, speed) {
      const ids = await g2p(text);
      return run(ids, styleFor(styles, ids.length), speed);
    },
  };
}

async function workerRunner(model: ArrayBuffer): Promise<(ids: number[], style: Float32Array, speed: number) => Promise<Float32Array>> {
  const w = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  w.onmessage = (e: MessageEvent<{ type: string; id: number; value?: unknown; message?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.type === "error") p.reject(new Error(e.data.message));
    else p.resolve(e.data.value);
  };
  const call = <T,>(msg: Record<string, unknown>, transfer: Transferable[] = []) =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ ...msg, id }, transfer);
    });
  await call({ type: "load", model, ortBase: `${import.meta.env.BASE_URL}ort/` }, [model]);
  return async (ids, style, speed) => (await call<{ audio: Float32Array }>({ type: "synth", ids, style, speed })).audio;
}

/** Word start times (seconds) in proportion to the words' lengths: Kokoro gives no alignment. */
export function wordStarts(words: readonly string[], seconds: number): number[] {
  const total = words.reduce((n, w) => n + w.length + 1, 0) || 1;
  let at = 0;
  return words.map((w) => {
    const t = (at / total) * seconds;
    at += w.length + 1;
    return t;
  });
}

export interface EnglishNeuralOptions {
  rate?: number;
  startAt?: number;
  signal?: AbortSignal;
  source: string;
  onSentence?: (s: Sentence, index: number) => void;
  onWord?: (s: Sentence, word: WordRange) => void;
  onFirstAudio?: (ms: number) => void;
  wordRanges: (source: string, s: Sentence) => WordRange[];
  audio?: AudioContext;
}

/** Read `sentences` with the engine; resolves when done or aborted. */
export async function speakKokoro(engine: KokoroEngine, sentences: readonly Sentence[], opts: EnglishNeuralOptions): Promise<void> {
  const t0 = performance.now();
  const ctx = opts.audio ?? new AudioContext();
  const rate = opts.rate ?? 1;
  const start = opts.startAt ?? 0;
  let next = sentences[start] ? engine.synth(sentences[start].text, rate) : null;
  let first = true;
  for (let i = start; i < sentences.length && next; i++) {
    if (opts.signal?.aborted) return;
    const s = sentences[i];
    const audio = await next;
    next = i + 1 < sentences.length ? engine.synth(sentences[i + 1].text, rate) : null; // prefetch while this one plays
    if (opts.signal?.aborted) return;
    const buf = ctx.createBuffer(1, audio.length, engine.sampleRate);
    buf.copyToChannel(Float32Array.from(audio), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    opts.onSentence?.(s, i);
    if (first) {
      opts.onFirstAudio?.(performance.now() - t0);
      first = false;
    }
    const ranges = opts.wordRanges(opts.source, s);
    const words = ranges.map((r) => opts.source.slice(r.from, r.to));
    const timers = wordStarts(words, buf.duration).map((at, w) => setTimeout(() => !opts.signal?.aborted && opts.onWord?.(s, ranges[w]), at * 1000));
    await new Promise<void>((resolve) => {
      src.onended = () => resolve();
      opts.signal?.addEventListener(
        "abort",
        () => {
          try {
            src.stop();
          } catch {
            // why: the source already stopped (it ended before the abort)
          }
          resolve();
        },
        { once: true },
      );
      src.start();
    });
    for (const tm of timers) clearTimeout(tm);
  }
}
