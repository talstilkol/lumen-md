/**
 * Speaker diarization models (plan W2.7), behind their seam: pyannote
 * speaker-diarization 3.1's two networks as ONNX — segmentation-3.0 (MIT)
 * and a speaker-embedding network — run with onnxruntime-web on this device.
 *
 * The models are identified only by values the owner pins from their
 * publisher (repository, revision, file, size, sha256, licence, and the
 * input / output names of the export). While any is missing the diarizer is
 * "unavailable" and meeting transcripts simply have no speakers; nothing is
 * guessed and nothing is downloaded from here. Pinned files load through the
 * 6.0 verified model cache (size + sha256 checked).
 */
import { clusterEmbeddings, framesToTurns, powersetToSpeakers, windowStarts, type LocalSpeaker, type Turn } from "./diarize";

export { DIARIZATION_MODELS, diarizationAvailable, type DiarizationModels, type ModelFile } from "./diarizePins";
import { DIARIZATION_MODELS, diarizationAvailable, type DiarizationModels, type ModelFile } from "./diarizePins";

export interface OrtLike {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(model: Uint8Array, opts?: unknown): Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number>; dims: readonly number[] }>> }> };
}

export interface DiarizeDeps {
  ort: OrtLike;
  /** The model file's bytes (verified). */
  load: (m: ModelFile) => Promise<Uint8Array>;
  /** 80-bin log-mel frames of 16 kHz samples. */
  fbank: (samples: Float32Array) => Float32Array[];
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Who spoke when in 16 kHz mono `samples`. Windows of `windowSec` every
 * second; each local speaker with ≥ 0.5 s of speech in a window gets an
 * embedding of its frames; clustering names the speakers S1, S2, …
 */
export async function diarize(samples: Float32Array, deps: DiarizeDeps, models: DiarizationModels = DIARIZATION_MODELS): Promise<Turn[]> {
  if (!diarizationAvailable(models)) throw new Error("diarization models are not pinned");
  const seg = models.segmentation;
  const [segSession, embSession] = await Promise.all([deps.ort.InferenceSession.create(await deps.load(seg)), deps.ort.InferenceSession.create(await deps.load(models.embedding))]);
  const rate = 16_000;
  const duration = samples.length / rate;
  const winLen = Math.round(seg.windowSec * rate);
  const starts = windowStarts(duration, seg.windowSec, 1);
  const locals: LocalSpeaker[] = [];
  const embeddings: Float32Array[] = [];
  for (const [w, start] of starts.entries()) {
    if (deps.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const chunk = new Float32Array(winLen);
    chunk.set(samples.subarray(Math.round(start * rate), Math.round(start * rate) + winLen));
    const out = (await segSession.run({ [seg.input]: new deps.ort.Tensor("float32", chunk, [1, 1, winLen]) }))[seg.output];
    const frames = out.dims[1];
    const active = powersetToSpeakers(out.data, frames, out.dims[2]);
    for (let s = 0; s < 3; s++) {
      const mine = active.map((a, f) => (a[s] ? f : -1)).filter((f) => f >= 0);
      if (mine.length * seg.frameSec < 0.5) continue;
      // The local speaker's own audio (its active frames) → fbank → embedding.
      const parts: Float32Array[] = [];
      for (const f of mine) {
        const a = Math.round(f * seg.frameSec * rate);
        parts.push(chunk.subarray(a, Math.min(winLen, a + Math.round(seg.frameSec * rate))));
      }
      const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) {
        audio.set(p, o);
        o += p.length;
      }
      const feats = deps.fbank(models.embedding.int16Scale ? audio.map((x) => x * 32768) : audio);
      if (!feats.length) continue;
      const dim = feats[0].length;
      if (models.embedding.cmn) {
        const mean = new Float32Array(dim);
        for (const fr of feats) for (let k = 0; k < dim; k++) mean[k] += fr[k] / feats.length;
        for (const fr of feats) for (let k = 0; k < dim; k++) fr[k] -= mean[k];
      }
      const flat = new Float32Array(feats.length * dim);
      feats.forEach((fr, i) => flat.set(fr, i * dim));
      const emb = (await embSession.run({ [models.embedding.input]: new deps.ort.Tensor("float32", flat, [1, feats.length, dim]) }))[models.embedding.output];
      locals.push({ window: start, frames: mine });
      embeddings.push(Float32Array.from(emb.data));
    }
    deps.onProgress?.(w + 1, starts.length);
  }
  if (!embeddings.length) return [];
  const labels = clusterEmbeddings(embeddings, models.threshold);
  return framesToTurns(locals, labels, { frameSec: seg.frameSec, duration });
}
