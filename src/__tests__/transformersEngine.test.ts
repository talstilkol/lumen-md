import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkerIn, WorkerOut } from "../ai/transformers.worker";
import type { Hardware } from "../ai/modelManager";

let hardware: Hardware = { webgpu: true, f16: true, maxBufferMB: 2048, deviceMemoryGB: 8, cores: 8, mobile: false };
vi.mock("../ai/modelManager", async (orig) => {
  const real = await orig<typeof import("../ai/modelManager")>();
  return { ...real, detectHardware: async () => hardware };
});

import {
  transcribeAudio,
  embedTextsLocal,
  preloadTransformersModel,
  unloadTransformers,
  onTransformersProgress,
  whisperModelFor,
  transformersDevice,
  decodeAudioTo16k,
  WHISPER_MODELS,
  EMBEDDING_MODEL,
  __resetTransformersEngine,
} from "../ai/transformersEngine";

let script: (msg: WorkerIn, reply: (out: WorkerOut) => void) => void;
let received: Array<WorkerIn & { ortBase?: string }> = [];
let transfers: Transferable[][] = [];
const terminate = vi.fn();
let created = 0;

class FakeWorker {
  onmessage: ((ev: MessageEvent<WorkerOut>) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  terminate = terminate;
  constructor(public url: URL) {
    created++;
  }
  postMessage(msg: WorkerIn & { ortBase?: string }, transfer: Transferable[] = []) {
    received.push(msg);
    transfers.push(transfer);
    queueMicrotask(() => script(msg, (out) => this.onmessage?.({ data: out } as MessageEvent<WorkerOut>)));
  }
}

describe("transformersEngine (worker client)", () => {
  beforeEach(() => {
    __resetTransformersEngine();
    received = [];
    transfers = [];
    created = 0;
    terminate.mockClear();
    hardware = { webgpu: true, f16: true, maxBufferMB: 2048, deviceMemoryGB: 8, cores: 8, mobile: false };
    vi.stubGlobal("Worker", FakeWorker);
    script = (msg, reply) => reply({ id: msg.id, type: "result", value: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("picks Whisper by device: turbo on a strong GPU, small on a modest one, tiny on wasm", async () => {
    expect(whisperModelFor(hardware)).toBe(WHISPER_MODELS.turbo);
    expect(whisperModelFor({ ...hardware, deviceMemoryGB: 4 })).toBe(WHISPER_MODELS.small);
    expect(whisperModelFor({ ...hardware, mobile: true })).toBe(WHISPER_MODELS.small);
    expect(whisperModelFor({ ...hardware, webgpu: false })).toBe(WHISPER_MODELS.tiny);
    expect(await transformersDevice()).toBe("webgpu");
    hardware = { ...hardware, webgpu: false };
    expect(await transformersDevice()).toBe("wasm");
  });

  it("transcribes through the worker, transferring the samples and passing the ORT base", async () => {
    script = (msg, reply) => {
      if (msg.type === "transcribe") {
        reply({ id: msg.id, type: "progress", file: "model.onnx", progress: 50, loaded: 1, total: 2 });
        reply({ id: msg.id, type: "result", value: { text: "שלום", language: "he" } });
      }
    };
    const seen: number[] = [];
    const off = onTransformersProgress((p) => seen.push(p.progress));
    const samples = new Float32Array(32_000);
    const res = await transcribeAudio(samples, { language: "he" });
    off();
    expect(res).toEqual({ text: "שלום", language: "he" });
    expect(seen).toEqual([50]);
    expect(received[0]).toMatchObject({ type: "transcribe", model: WHISPER_MODELS.turbo, device: "webgpu", language: "he", task: "transcribe" });
    expect(received[0].ortBase).toMatch(/\/ort\/$/);
    expect(transfers[0][0]).toBe(samples.buffer);
    expect(created).toBe(1);
  });

  it("embeds, preloads and unloads; errors reject; an aborted signal is refused up front", async () => {
    script = (msg, reply) => {
      if (msg.type === "embed") reply({ id: msg.id, type: "result", value: { vectors: [[0.1, 0.2]], dims: 2 } });
      else if (msg.type === "load") reply({ id: msg.id, type: "error", message: "download failed" });
      else reply({ id: msg.id, type: "result", value: true });
    };
    expect(await embedTextsLocal(["a"])).toEqual({ vectors: [[0.1, 0.2]], dims: 2 });
    expect(received[0]).toMatchObject({ type: "embed", model: EMBEDDING_MODEL, texts: ["a"] });
    expect(await embedTextsLocal([])).toEqual({ vectors: [], dims: 384 });
    await expect(preloadTransformersModel("feature-extraction")).rejects.toThrow("download failed");
    const aborted = new AbortController();
    aborted.abort();
    await expect(transcribeAudio(new Float32Array(1), { signal: aborted.signal })).rejects.toMatchObject({ name: "AbortError" });
    await unloadTransformers();
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(received.at(-1)?.type).toBe("unload");
  });

  it("decodeAudioTo16k reports a missing Web Audio API", async () => {
    await expect(decodeAudioTo16k(new Blob(["x"]))).rejects.toThrow(/Web Audio/);
  });
});
