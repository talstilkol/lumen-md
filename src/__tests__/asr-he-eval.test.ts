/**
 * Plan 6.1 — the asr-he harness: the set's normalisation (NFC, no niqqud,
 * no punctuation), WER / CER and the latency bookkeeping of live decoding,
 * on a fake recognizer (the real model is measured in the ASR workflow).
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs module without types
import { editDistance, errors, normalizeAsr, percentile, rates, scoreWith, transcribeLive } from "../../scripts/golden/evals/asr-he.mjs";

describe("normalizeAsr", () => {
  it("drops niqqud, cantillation and punctuation, keeps letters", () => {
    expect(normalizeAsr("שָׁלוֹם, עוֹלָם!")).toBe("שלום עולם");
    expect(normalizeAsr("בְּרֵאשִׁ֖ית")).toBe("בראשית");
    expect(normalizeAsr("  \"מה?\"  נשמע…  ")).toBe("מה נשמע");
  });
  it("splits on maqaf and dashes, composes to NFC, lower-cases Latin", () => {
    expect(normalizeAsr("בית־ספר")).toBe("בית ספר");
    expect(normalizeAsr("COVID-19")).toBe("covid 19");
    expect(normalizeAsr("é")).toBe("é");
  });
});

describe("error rates", () => {
  it("edit distance on words and characters", () => {
    expect(editDistance(["a", "b", "c"], ["a", "c"])).toBe(1);
    expect(editDistance([], ["x"])).toBe(1);
    expect(editDistance("kitten".split(""), "sitting".split(""))).toBe(3);
  });
  it("WER ignores niqqud and punctuation differences", () => {
    expect(errors("שָׁלוֹם, עוֹלָם.", "שלום עולם")).toEqual({ wordErrors: 0, words: 2, charErrors: 0, chars: 8 });
    const e = errors("אני הולך הביתה", "אני הלך הביתה");
    expect(e.wordErrors).toBe(1);
    expect(e.charErrors).toBe(1);
  });
  it("corpus rates sum edits over reference length", () => {
    expect(rates([{ wordErrors: 1, words: 4, charErrors: 2, chars: 10 }, { wordErrors: 0, words: 6, charErrors: 0, chars: 10 }])).toEqual({ wer: 0.1, cer: 0.1 });
  });
  it("percentiles", () => {
    expect(percentile([3, 1, 2, 4], 50)).toBe(2);
    expect(percentile([3, 1, 2, 4], 95)).toBe(4);
    expect(percentile([], 50)).toBe(0);
  });
});

/** A recognizer that emits one word per second of audio it has seen, stamped at the word's start. */
function fakeRecognizer(decodeCost = 0.05) {
  let clock = 0;
  const now = () => clock;
  const make = () => {
    let fed = 0;
    let decoded = 0;
    let finished = false;
    return {
      acceptWaveform: (s: Float32Array) => void (fed += s.length),
      inputFinished: () => void (finished = true),
      get ready() {
        return fed - decoded >= 16000 || (finished && fed > decoded);
      },
      decode() {
        decoded = Math.min(fed, decoded + 16000);
        clock += decodeCost;
      },
      get words() {
        return Math.floor(decoded / 16000);
      },
    };
  };
  type S = ReturnType<typeof make>;
  return {
    now,
    rec: {
      createStream: make,
      isReady: (s: S) => s.ready,
      decode: (s: S) => s.decode(),
      getResult: (s: S) => {
        const n = s.words;
        return { text: Array.from({ length: n }, (_, i) => `w${i}`).join(" "), tokens: Array.from({ length: n }, (_, i) => `▁w${i}`), timestamps: Array.from({ length: n }, (_, i) => i) };
      },
    },
  };
}

describe("transcribeLive", () => {
  it("feeds real-time slices and measures each word's delay from when it was spoken", async () => {
    const { rec, now } = fakeRecognizer(0.05);
    const out = await transcribeLive(rec, new Float32Array(3 * 16000), now);
    // The recogniser also decodes the 1.5 s tail, as the real one does with silence.
    expect(out.text.startsWith("w0 w1 w2")).toBe(true);
    expect(out.duration).toBe(3);
    // Word i is spoken at i s and decoded once its second of audio is in — at the end of the
    // first 160 ms slice that completes it — plus the decode cost: 1.12 + 0.05 − 0, 2.08 + 0.05 − 1.
    expect(out.latencies[0]).toBeCloseTo(1.17, 2);
    expect(out.latencies[1]).toBeCloseTo(1.13, 2);
    expect(out.compute).toBeGreaterThan(0);
  });
  it("scores per part, overall, with latency percentiles and the real-time factor", async () => {
    const items = [
      { part: "fleurs", text: "שלום עולם" },
      { part: "common-voice", text: "אחת שתיים שלוש" },
    ];
    const s = await scoreWith(async (it: { text: string }) => ({ text: it.text === "שלום עולם" ? "שלום עולם" : "אחת שתיים", latencies: [0.4, 0.8], compute: 1, duration: 4 }), items);
    expect(s["wer.fleurs"]).toBe(0);
    expect(s["wer.common-voice"]).toBeCloseTo(1 / 3, 3);
    expect(s.wer).toBeCloseTo(1 / 5, 3);
    expect(s["latency.p50Ms"]).toBe(400);
    expect(s["latency.p95Ms"]).toBe(800);
    expect(s.rtf).toBe(0.25);
  });
});
