/**
 * Plan 6.2 (W10.E65): neural English read-aloud with Kokoro behind a seam,
 * with a stand-in engine. The model, its pinned files and the English G2P
 * are decision 15.10 and the Mac's; here: the seam is dormant without
 * them, refuses before any download without a phonemizer or the user's
 * yes, checks the files, and the reader drives any engine sentence by
 * sentence (prefetching the next), with word highlights and abort.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ENGLISH_VOICES, englishNeuralVoice, loadKokoro, setEnglishPhonemizer, speakKokoro, styleFor, usableKokoro, wordStarts, type KokoroEngine, type KokoroPack } from "../ai/tts/kokoro";
import { verifiedFile } from "../ai/tts/neuralReader";
import { speakableSentences, wordRanges } from "../ai/tts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const MODEL = "model-bytes";
const VOICE = new Float32Array(3 * 256).map((_, i) => Math.floor(i / 256) + 1); // rows 1, 2, 3
const voiceBytes = Buffer.from(VOICE.buffer);
const PACK: KokoroPack = {
  id: "kokoro-82m-test",
  language: "en",
  license: "Apache-2.0",
  attribution: "test",
  model: { url: "https://example.com/kokoro.onnx", bytes: MODEL.length, sha256: sha(MODEL) },
  voice: { url: "https://example.com/af.bin", bytes: voiceBytes.length, sha256: createHash("sha256").update(voiceBytes).digest("hex") },
  sampleRate: 24000,
};

function fakeAudio() {
  const ended: Array<() => void> = [];
  const ctx = {
    destination: {},
    createBuffer: (_c: number, length: number, rate: number) => ({ duration: length / rate, copyToChannel: () => undefined }),
    createBufferSource: () => {
      const src = { buffer: null as unknown, onended: null as null | (() => void), connect: () => undefined, stop: () => src.onended?.(), start: () => ended.push(() => src.onended?.()) };
      return src;
    },
  } as unknown as AudioContext;
  return { ctx, ended };
}

afterEach(() => setEnglishPhonemizer(null));

describe("dormant until 15.10", () => {
  it("no pinned English voice: none is used, nothing is imported or fetched", async () => {
    expect(ENGLISH_VOICES).toEqual([]);
    expect(await englishNeuralVoice()).toBeNull();
  });

  it("a pack is usable only with a registry entry that allows it and pinned files", () => {
    expect(usableKokoro([PACK], [])).toEqual([]);
    expect(usableKokoro([PACK], [{ id: PACK.id, class: "forbidden", verified: true }])).toEqual([]);
    expect(usableKokoro([PACK], [{ id: PACK.id, class: "allowed", verified: true }])).toEqual([PACK]);
    expect(usableKokoro([{ ...PACK, voice: { ...PACK.voice, sha256: "x" } }], [{ id: PACK.id, class: "allowed", verified: true }])).toEqual([]);
  });
});

describe("loading the engine", () => {
  const fetchOk = async (f: { url: string }) => (f.url.endsWith(".onnx") ? new TextEncoder().encode(MODEL).buffer : voiceBytes.buffer.slice(voiceBytes.byteOffset, voiceBytes.byteOffset + voiceBytes.length));

  it("no English phonemizer, or no consent: refused before any request", async () => {
    const fetchVerified = vi.fn(fetchOk);
    await expect(loadKokoro(PACK, { consent: async () => true, fetchVerified, phonemize: null })).rejects.toThrow("no English phonemizer");
    await expect(loadKokoro(PACK, { consent: async () => false, fetchVerified, phonemize: async () => [1] })).rejects.toThrow("not allowed");
    expect(fetchVerified).not.toHaveBeenCalled();
  });

  it("asks once with the total size; the files must match their sha256 (the real verifiedFile)", async () => {
    const consent = vi.fn(async () => true);
    const bad = (f: { url: string; bytes: number; sha256: string }) => verifiedFile(f, { fetch: (async () => new Response("tampered")) as typeof fetch, caches: null });
    await expect(loadKokoro(PACK, { consent, fetchVerified: bad, phonemize: async () => [1] })).rejects.toThrow("checksum");
    expect(consent).toHaveBeenCalledWith(PACK, MODEL.length + voiceBytes.length);
  });

  it("text → the phonemizer's ids, the style row for that many tokens, the speed → the runner", async () => {
    const calls: Array<{ ids: number[]; style: number; speed: number }> = [];
    const engine = await loadKokoro(PACK, {
      consent: async () => true,
      fetchVerified: fetchOk,
      phonemize: async (t) => Array.from(t, (_, i) => i + 1),
      run: async (model) => {
        expect(new TextDecoder().decode(model)).toBe(MODEL);
        return async (ids, style, speed) => (calls.push({ ids, style: style[0], speed }), new Float32Array(10));
      },
    });
    expect(engine.sampleRate).toBe(24000);
    await engine.synth("hi", 1.25);
    expect(calls).toEqual([{ ids: [1, 2], style: 3, speed: 1.25 }]);
    expect(styleFor(VOICE, 0)[0]).toBe(1);
    expect(styleFor(VOICE, 99)[0]).toBe(3);
  });
});

describe("reading with an engine (a stand-in)", () => {
  it("sentence by sentence in order, the next one synthesized while this one plays, words highlighted, first audio reported once", async () => {
    vi.useFakeTimers();
    try {
      const source = "Hello there world. Second sentence here.";
      const sentences = speakableSentences(source);
      const synthed: string[] = [];
      const engine: KokoroEngine = { sampleRate: 24000, synth: async (t) => (synthed.push(t), new Float32Array(24000)) };
      const { ctx, ended } = fakeAudio();
      const order: string[] = [];
      const words: string[] = [];
      const first = vi.fn();
      const done = speakKokoro(engine, sentences, { audio: ctx, source, wordRanges, onSentence: (_s, i) => order.push(`s${i}`), onWord: (_s, w) => words.push(source.slice(w.from, w.to)), onFirstAudio: first });
      await vi.waitFor(() => expect(ended.length).toBe(1));
      expect(synthed).toEqual([sentences[0].text, sentences[1].text]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(words).toEqual(["Hello", "there", "world"]);
      ended[0]();
      await vi.waitFor(() => expect(ended.length).toBe(2));
      ended[1]();
      await done;
      expect(order).toEqual(["s0", "s1"]);
      expect(first).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("abort stops the sentence playing and reads no further", async () => {
    const source = "One. Two. Three.";
    const sentences = speakableSentences(source);
    const engine: KokoroEngine = { sampleRate: 24000, synth: async () => new Float32Array(100) };
    const { ctx, ended } = fakeAudio();
    const ctl = new AbortController();
    const order: number[] = [];
    const done = speakKokoro(engine, sentences, { audio: ctx, source, wordRanges, signal: ctl.signal, onSentence: (_s, i) => order.push(i) });
    await vi.waitFor(() => expect(ended.length).toBe(1));
    ctl.abort();
    await done;
    expect(order).toEqual([0]);
  });

  it("word starts follow the words' lengths", () => {
    expect(wordStarts(["a", "bbb"], 6)).toEqual([0, 2]);
  });
});
