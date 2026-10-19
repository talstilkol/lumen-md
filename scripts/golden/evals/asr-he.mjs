/**
 * Harness for the Hebrew speech-recognition golden set (plan 6.1, 7.1):
 * WER and CER per part (FLEURS, Common Voice, the owner's), after the set's
 * normalisation — NFC, no punctuation, no niqqud — and the latency of live
 * dictation, all on the engine the browser runs: sherpa-onnx's WebAssembly
 * build (the `sherpa-onnx` npm package is that build for Node) with the
 * ivrit.ai Zipformer2 streaming model (int8).
 *
 *   score({ items }) → { "wer.fleurs": 0.1, "cer.fleurs": …, "wer": …, "latency.p95Ms": …, "rtf": … }
 *
 * The model is not in the repo (72 MB): LUMEN_ASR_MODEL_DIR points to the
 * folder with encoder/decoder/joiner .int8.onnx and tokens.txt
 * (scripts/asr/fetch-model.sh downloads it). Audio is decoded with ffmpeg.
 *
 * Latency is measured, not assumed: the audio is fed in 160 ms slices at
 * real time (a clock that advances with the audio and with every
 * millisecond of decoding), and each word's latency is the time it appears
 * minus the time it was spoken (sherpa-onnx's token timestamps). Reported
 * as p50 / p95 over every word.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/* ── Normalisation and error rates ───────────────────────────────────── */

const MARKS = /[֑-ׇֽֿׁׂׅׄ]/g;

/** The set's normal form: NFC, no niqqud or cantillation, no punctuation, single spaces, lower case. */
export function normalizeAsr(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(MARKS, "")
    .normalize("NFC")
    .replace(/[־\-‐-―]/g, " ") // maqaf and dashes join words: split them
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Edit distance between two sequences. */
export function editDistance(a, b) {
  const n = a.length;
  const m = b.length;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[m];
}

/** Errors and reference length, words and characters, of one hypothesis (both normalised here). */
export function errors(reference, hypothesis) {
  const r = normalizeAsr(reference);
  const h = normalizeAsr(hypothesis);
  const rw = r ? r.split(" ") : [];
  const hw = h ? h.split(" ") : [];
  const rc = [...r.replace(/ /g, "")];
  const hc = [...h.replace(/ /g, "")];
  return { wordErrors: editDistance(rw, hw), words: rw.length, charErrors: editDistance(rc, hc), chars: rc.length };
}

/** Corpus-level rates: total edits over total reference length. */
export function rates(list) {
  const sum = (k) => list.reduce((s, x) => s + x[k], 0);
  return { wer: sum("words") ? sum("wordErrors") / sum("words") : 0, cer: sum("chars") ? sum("charErrors") / sum("chars") : 0 };
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/* ── Audio and the engine ─────────────────────────────────────────────── */

/** 16 kHz mono float samples of any audio file (ffmpeg). */
export function decodeAudio(path) {
  const r = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg could not decode ${path}`);
  const buf = r.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
}

export const MODEL = {
  repo: "ivrit-ai/zipformer2-66m-streaming-he",
  files: ["sherpa-onnx/encoder.int8.onnx", "sherpa-onnx/decoder.int8.onnx", "sherpa-onnx/joiner.int8.onnx", "sherpa-onnx/tokens.txt"],
};

/** The recognizer on sherpa-onnx's WebAssembly build, from a model folder. */
export async function createRecognizer(modelDir = process.env.LUMEN_ASR_MODEL_DIR) {
  if (!modelDir || !existsSync(join(modelDir, "encoder.int8.onnx"))) throw new Error("the streaming model is not downloaded (LUMEN_ASR_MODEL_DIR; scripts/asr/fetch-model.sh)");
  // Not a dependency of the app: the ASR workflow installs it (npm i --no-save sherpa-onnx@1.13.8).
  const pkg = process.env.LUMEN_SHERPA_ONNX ?? "sherpa-onnx";
  const sherpa = (await import(/* @vite-ignore */ pkg)).default;
  return sherpa.createOnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: join(modelDir, "encoder.int8.onnx"), decoder: join(modelDir, "decoder.int8.onnx"), joiner: join(modelDir, "joiner.int8.onnx") },
      tokens: join(modelDir, "tokens.txt"),
      numThreads: 1,
      provider: "cpu",
      debug: 0,
      modelType: "zipformer2",
    },
    decodingMethod: "greedy_search",
    enableEndpoint: 0,
  });
}

const SLICE = 0.16; // seconds of audio per feed, as a microphone delivers it
const TAIL = 1.5; // seconds of silence that flush the last chunk (the model card's recipe)

/**
 * Transcribe one clip as live dictation would: real-time slices, decoding
 * whenever a chunk is ready. Returns the text, each word's latency (s) and
 * the compute time.
 */
export function transcribeLive(recognizer, samples, now = () => performance.now() / 1000) {
  const stream = recognizer.createStream();
  let clock = 0; // wall time since the clip started, in seconds
  let compute = 0;
  let seen = 0;
  const latencies = [];
  const step = Math.round(SLICE * 16000);
  const collect = () => {
    const r = recognizer.getResult(stream);
    const ts = r.timestamps ?? [];
    const tokens = r.tokens ?? [];
    for (let i = seen; i < tokens.length; i++) {
      // A word starts at a token that begins with the SentencePiece word marker.
      if (/^▁/.test(tokens[i]) || i === 0) latencies.push(Math.max(0, clock - (ts[i] ?? clock)));
    }
    seen = Math.max(seen, tokens.length);
    return r;
  };
  const decode = () => {
    const t0 = now();
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    const dt = now() - t0;
    compute += dt;
    clock += dt;
  };
  for (let at = 0; at < samples.length; at += step) {
    const slice = samples.subarray(at, Math.min(samples.length, at + step));
    clock = Math.max(clock, (at + slice.length) / 16000); // the audio arrives in real time
    stream.acceptWaveform(16000, slice);
    decode();
    collect();
  }
  stream.acceptWaveform(16000, new Float32Array(Math.round(TAIL * 16000)));
  stream.inputFinished();
  decode();
  const r = collect();
  stream.free?.();
  return { text: r.text ?? "", latencies, compute, duration: samples.length / 16000 };
}

/* ── The harness ──────────────────────────────────────────────────────── */

/** Scores of every part, with `transcribe(item) → { text, latencies, compute, duration }`. */
export async function scoreWith(transcribe, items) {
  const parts = new Map();
  const latencies = [];
  let compute = 0;
  let duration = 0;
  for (const it of items) {
    const out = await transcribe(it);
    if (!parts.has(it.part)) parts.set(it.part, []);
    parts.get(it.part).push(errors(it.text, out.text));
    latencies.push(...(out.latencies ?? []));
    compute += out.compute ?? 0;
    duration += out.duration ?? 0;
  }
  const scores = {};
  const all = [];
  for (const [part, list] of parts) {
    const r = rates(list);
    scores[`wer.${part}`] = round(r.wer);
    scores[`cer.${part}`] = round(r.cer);
    scores[`items.${part}`] = list.length;
    all.push(...list);
  }
  const r = rates(all);
  scores.wer = round(r.wer);
  scores.cer = round(r.cer);
  if (latencies.length) {
    scores["latency.p50Ms"] = Math.round(percentile(latencies, 50) * 1000);
    scores["latency.p95Ms"] = Math.round(percentile(latencies, 95) * 1000);
  }
  if (duration) scores.rtf = round(compute / duration);
  return scores;
}

const round = (x) => Math.round(x * 10000) / 10000;

export async function score({ items }) {
  const recognizer = await createRecognizer();
  return scoreWith(async (it) => transcribeLive(recognizer, decodeAudio(it.audio)), items);
}
