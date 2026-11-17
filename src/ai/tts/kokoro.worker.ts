/**
 * Kokoro worker (plan 6.2, W10.E65): kokoro-v1.0 ONNX in onnxruntime-web
 * (MIT), WASM, one thread. Not kokoro-js (it bundles eSpeak NG, GPL-3.0).
 *
 *   → { type: "load", id, model: ArrayBuffer, ortBase }
 *   → { type: "synth", id, ids: number[], style: Float32Array (256), speed }
 *   ← { type: "result", id, value } | { type: "error", id, message }
 *
 * The model's inputs: input_ids int64 [1, n + 2] (0-padded at both ends),
 * style float32 [1, 256], speed float32 [1]; its output is the waveform at
 * 24 kHz. `synth` answers { audio: Float32Array (transferred), ms }.
 */
import "../workerLedgerInstall"; // first: what this worker fetches reaches the privacy ledger (plan 2.4, W10.D22)
import * as ort from "onnxruntime-web/wasm";

type In = { type: "load"; id: number; model: ArrayBuffer; ortBase: string } | { type: "synth"; id: number; ids: number[]; style: Float32Array; speed: number };

let session: ort.InferenceSession | null = null;

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      ort.env.wasm.wasmPaths = { mjs: `${msg.ortBase}ort-wasm-simd-threaded.mjs`, wasm: `${msg.ortBase}ort-wasm-simd-threaded.wasm` };
      ort.env.wasm.numThreads = 1;
      session = await ort.InferenceSession.create(new Uint8Array(msg.model), { executionProviders: ["wasm"] });
      post({ type: "result", id: msg.id, value: true });
      return;
    }
    if (!session) throw new Error("kokoro not loaded");
    const t0 = performance.now();
    const ids = BigInt64Array.from([0, ...msg.ids, 0].map((x) => BigInt(x)));
    const out = await session.run({
      input_ids: new ort.Tensor("int64", ids, [1, ids.length]),
      style: new ort.Tensor("float32", Float32Array.from(msg.style), [1, msg.style.length]),
      speed: new ort.Tensor("float32", Float32Array.from([msg.speed]), [1]),
    });
    const audio = Float32Array.from(out[session.outputNames[0]].data as Float32Array);
    post({ type: "result", id: msg.id, value: { audio, ms: performance.now() - t0 } }, [audio.buffer]);
  } catch (err) {
    post({ type: "error", id: msg.id, message: (err as Error)?.message ?? String(err) });
  }
};
