/**
 * The diarization models' pins (plan W2.7), apart from the code that runs
 * them (./diarizeModels.ts): the command list reads `diarizationAvailable`
 * at startup to show the speaker commands only when real models are pinned
 * (W11.I21), and this file has no imports, so the networks' code stays out
 * of the startup bundle.
 */

export interface ModelFile {
  repo: string | null;
  revision: string | null;
  file: string | null;
  bytes: number | null;
  sha256: string | null;
  license: string | null;
}

export interface DiarizationModels {
  segmentation: ModelFile & { input: string; output: string; windowSec: number; frameSec: number };
  embedding: ModelFile & { input: string; output: string; /** Kaldi fbank on int16-scaled samples (WeSpeaker) instead of [-1, 1]. */ int16Scale: boolean; /** Subtract the mean of each bin. */ cmn: boolean };
  /** Cosine-distance threshold of the clustering (pyannote 3.1: 0.7045). */
  threshold: number;
}

const unpinned: ModelFile = { repo: null, revision: null, file: null, bytes: null, sha256: null, license: null };

/**
 * TODO(owner, W2.7): pin both networks (`node scripts/meetings/diarization-pin.mjs`
 * prints the commands): segmentation-3.0 is MIT; the embedding network's
 * licence must be checked before it is pinned (WeSpeaker's VoxCeleb models
 * are CC BY 4.0, 3D-Speaker's are Apache-2.0).
 */
export const DIARIZATION_MODELS: DiarizationModels = {
  segmentation: { ...unpinned, input: "input_values", output: "logits", windowSec: 10, frameSec: 0.016875 },
  embedding: { ...unpinned, input: "feats", output: "embs", int16Scale: true, cmn: true },
  threshold: 0.7045,
};

const pinned = (m: ModelFile) =>
  typeof m.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(m.repo) &&
  typeof m.revision === "string" && /^[0-9a-f]{40}$/.test(m.revision) &&
  typeof m.file === "string" && /^[\w./-]+\.onnx$/.test(m.file) && !m.file.includes("..") &&
  typeof m.bytes === "number" && m.bytes > 0 &&
  typeof m.sha256 === "string" && /^[0-9a-f]{64}$/.test(m.sha256) &&
  typeof m.license === "string" && m.license.length > 0;

export function diarizationAvailable(models: DiarizationModels = DIARIZATION_MODELS): boolean {
  return pinned(models.segmentation) && pinned(models.embedding);
}
