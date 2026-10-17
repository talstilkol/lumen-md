import { describe, it, expect, vi, beforeEach } from "vitest";

const { asrCall, embedCall, dispose, pipelineFn, env } = vi.hoisted(() => {
  const asrCall = vi.fn();
  const embedCall = vi.fn();
  const dispose = vi.fn(async () => {});
  const pipelineFn = vi.fn(async (task: string, _model: string, opts: { progress_callback?: (i: unknown) => void }) => {
    opts.progress_callback?.({ status: "progress", file: "model.onnx", progress: 42, loaded: 42, total: 100 });
    opts.progress_callback?.({ status: "done", file: "model.onnx" });
    const fn = task === "automatic-speech-recognition" ? asrCall : embedCall;
    const pipe = (input: unknown, kwargs: unknown) => fn(input, kwargs);
    (pipe as unknown as { dispose: typeof dispose }).dispose = dispose;
    return pipe;
  });
  const env = { allowLocalModels: true, useBrowserCache: false, useWasmCache: false, backends: { onnx: { wasm: { wasmPaths: undefined as unknown } } } };
  return { asrCall, embedCall, dispose, pipelineFn, env };
});
vi.mock("@huggingface/transformers", () => ({ env, pipeline: pipelineFn }));

const posted: unknown[] = [];
vi.stubGlobal("postMessage", (m: unknown) => posted.push(m));

import { handle, configureOrt } from "../ai/transformers.worker";

describe("transformers worker", () => {
  beforeEach(() => {
    posted.length = 0;
    pipelineFn.mockClear();
    asrCall.mockReset();
    embedCall.mockReset();
    dispose.mockClear();
  });

  it("points ONNX Runtime at the same-origin wasm and uses the browser caches", () => {
    configureOrt("https://lumen-md.vercel.app/ort/");
    expect(env.allowLocalModels).toBe(false);
    expect(env.useBrowserCache).toBe(true);
    expect(env.useWasmCache).toBe(true);
    expect(env.backends.onnx.wasm.wasmPaths).toEqual({
      mjs: "https://lumen-md.vercel.app/ort/ort-wasm-simd-threaded.asyncify.mjs",
      wasm: "https://lumen-md.vercel.app/ort/ort-wasm-simd-threaded.asyncify.wasm",
    });
    configureOrt("/ort/", "");
    expect((env.backends.onnx.wasm.wasmPaths as { wasm: string }).wasm).toBe("/ort/ort-wasm-simd-threaded.wasm");
  });

  it("transcribes with the WebGPU dtype split, forwards progress, chunks long audio", async () => {
    asrCall.mockResolvedValue({ text: " hello ", language: "en" });
    await handle({ id: 1, type: "transcribe", model: "onnx-community/whisper-small", device: "webgpu", audio: new Float32Array(16_000 * 40), language: "en" });
    expect(pipelineFn.mock.calls[0][0]).toBe("automatic-speech-recognition");
    expect(pipelineFn.mock.calls[0][2]).toMatchObject({ device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } });
    expect(asrCall.mock.calls[0][1]).toEqual({ language: "en", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
    expect(posted).toEqual([
      { id: 1, type: "progress", file: "model.onnx", progress: 42, loaded: 42, total: 100 },
      { id: 1, type: "result", value: { text: "hello", language: "en" } },
    ]);
    // Same model + device → the pipeline is reused; a short clip is not chunked.
    posted.length = 0;
    asrCall.mockResolvedValue([{ text: "a" }, { text: "b" }]);
    await handle({ id: 2, type: "transcribe", model: "onnx-community/whisper-small", device: "webgpu", audio: new Float32Array(16_000) });
    expect(pipelineFn).toHaveBeenCalledTimes(1);
    expect(asrCall.mock.calls[1][1]).toEqual({ task: "transcribe" });
    expect(posted).toEqual([{ id: 2, type: "result", value: { text: "a b" } }]);
    // Switching device disposes the old pipeline and loads q8 for wasm.
    await handle({ id: 3, type: "transcribe", model: "onnx-community/whisper-tiny", device: "wasm", audio: new Float32Array(10) });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(pipelineFn.mock.calls[1][2]).toMatchObject({ device: "wasm", dtype: "q8" });
  });

  it("embeds with mean pooling + normalisation and reports errors", async () => {
    embedCall.mockResolvedValue({ tolist: () => [[0.5, 0.5], [1, 0]] });
    await handle({ id: 4, type: "embed", model: "Xenova/multilingual-e5-small", device: "wasm", texts: ["a", "b"] });
    expect(embedCall.mock.calls[0][1]).toEqual({ pooling: "mean", normalize: true });
    expect(posted.at(-1)).toEqual({ id: 4, type: "result", value: { vectors: [[0.5, 0.5], [1, 0]], dims: 2 } });
    embedCall.mockRejectedValueOnce(new Error("oom"));
    await handle({ id: 5, type: "embed", model: "Xenova/multilingual-e5-small", device: "wasm", texts: ["c"] });
    expect(posted.at(-1)).toEqual({ id: 5, type: "error", message: "oom" });
    await handle({ id: 6, type: "load", task: "feature-extraction", model: "m2", device: "wasm" });
    expect(posted.at(-1)).toEqual({ id: 6, type: "result", value: "m2" });
    await handle({ id: 7, type: "unload" });
    expect(posted.at(-1)).toEqual({ id: 7, type: "result", value: true });
  });
});
