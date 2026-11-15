/**
 * The live-dictation engine (plan 6.1, 7.8, W10.E35): ivrit.ai's Zipformer2
 * streaming model with Silero VAD, in the app's own dictation worker. The
 * recording is fed in the app's 1024-sample blocks, then a second and a
 * half of silence (the worker's tail) flushes the last segment; the
 * transcript is the worker's final segments joined, before the app's
 * punctuation pass (the set scores words). The numbers are the live
 * pipeline's, so they belong to Silero VAD v5 too: a worker that fell back
 * to its energy VAD is an error, never a number.
 */
import { loadDictationFiles } from "../../ai/dictation/modelStore";
import { ZIPFORMER_REPO } from "../../ai/dictation/models";
import { BLOCK } from "../../ai/dictation/session";
import type { DictationIn, DictationOut } from "../../ai/dictation/dictation.worker";
import { decodeAudioTo16k, ortBaseUrl } from "../../ai/transformersEngine";
import { dataUrlBlob, type BenchEngine } from "../types";

let worker: Worker | null = null;

function onMessage(w: Worker, until: (m: DictationOut) => boolean, collect?: (m: DictationOut) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    w.onmessage = (ev: MessageEvent<DictationOut>) => {
      const m = ev.data;
      if (m.type === "error") return reject(new Error(m.message));
      collect?.(m);
      if (until(m)) resolve();
    };
    w.onerror = (e) => reject(new Error(e.message || "dictation worker failed"));
  });
}

async function start(): Promise<Worker> {
  const files = await loadDictationFiles();
  const w = new Worker(new URL("../../ai/dictation/dictation.worker.ts", import.meta.url), { type: "module" });
  let vad: string | null = null;
  const ready = onMessage(w, (m) => m.type === "ready", (m) => m.type === "ready" && (vad = m.vad));
  const msg: DictationIn = { type: "load", ortBase: ortBaseUrl(), encoder: files.encoder.slice(), decoder: files.decoder.slice(), joiner: files.joiner.slice(), tokens: files.tokens, vad: files.vad?.slice() ?? null };
  w.postMessage(msg);
  await ready;
  if (vad !== "silero") {
    w.terminate();
    throw new Error(`the dictation worker ran without Silero VAD (${vad ?? "none"})`);
  }
  return w;
}

export const engine: BenchEngine = {
  id: "zipformer-he",
  label: "Zipformer2 66M streaming (live dictation)",
  set: "asr-he",
  models: [ZIPFORMER_REPO, "silero-vad-v5"],
  async load() {
    worker = await start();
    // The worker runs ONNX Runtime Web on wasm.
    return { device: "wasm", model: ZIPFORMER_REPO };
  },
  async run(item) {
    // One recording per session, as a user's dictation is: a fresh worker each time.
    worker?.terminate();
    const w = (worker = await start());
    const pcm = await decodeAudioTo16k(await dataUrlBlob((item.input as { audio: string }).audio));
    const finals: string[] = [];
    const done = onMessage(w, (m) => m.type === "stopped", (m) => m.type === "final" && m.text && finals.push(m.text));
    const tail = new Float32Array(16_000 * 1.5);
    for (const buf of [pcm, tail]) {
      for (let i = 0; i < buf.length; i += BLOCK) w.postMessage({ type: "audio", samples: buf.slice(i, i + BLOCK) } satisfies DictationIn);
    }
    w.postMessage({ type: "stop" } satisfies DictationIn);
    await done;
    return finals.join(" ").trim();
  },
  dispose: async () => {
    worker?.terminate();
    worker = null;
  },
};
