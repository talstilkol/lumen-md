/**
 * W11.M3 / W12.M1 / plan 2.6: the DictaBERT-NER and GLiNER engine modules
 * (scripts/eval-public/engines). The models run on the Mac; here their
 * pipelines are stand-ins with the documented output shapes, and the code
 * that turns those outputs into tags and spans is the real one.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { alignPieces, bioToSpans, decodeGliner, fileDigest, glinerInputs, joinTokens, spansToBio, words } from "../../scripts/eval-public/engines/ner-core.mjs";
import { makeDictaBertNer, nerEngine } from "../../scripts/eval-public/engines/dictabert-ner.mjs";
import { glinerEngine, makeGliner, NEMO_LABELS, ortFeeds } from "../../scripts/eval-public/engines/gliner.mjs";
// @ts-expect-error — a plain .mjs harness without types (as in piiGolden.test.ts)
import { namesFrom, scoreWith } from "../../scripts/golden/evals/ner-pii.mjs";
import { findPii } from "../ai/pii";

describe("words, tags and spans", () => {
  it("splits Hebrew with geresh and gershayim inside a word, punctuation on its own", () => {
    expect(words("צה״ל, ג׳ורג׳ ו-IBM.").map((w) => w.w)).toEqual(["צה״ל", ",", "ג׳ורג׳", "ו-IBM", "."]);
  });

  it("spans → B-/I- tags → the same spans", () => {
    const { text, offsets } = joinTokens(["דוד", "בן", "גוריון", "נולד", "בפולין"]);
    const spans = [{ start: 0, end: text.indexOf(" נולד"), type: "PER" }, { start: text.indexOf("בפולין"), end: text.length, type: "GPE" }];
    const tags = spansToBio(offsets, spans);
    expect(tags).toEqual(["B-PER", "I-PER", "I-PER", "O", "B-GPE"]);
    expect(bioToSpans(offsets, tags)).toEqual(spans);
    // BIOES (NEMO's raw files) reads the same.
    expect(bioToSpans(offsets, ["B-PER", "I-PER", "E-PER", "O", "S-GPE"])).toEqual(spans);
  });

  it("aligns WordPiece output with the text, a continuation joined, a prefix's word completed", () => {
    const text = "שלום ליוסי כהן מחיפה";
    const pieces = [
      { entity: "B-PER", word: "ליוסי", score: 0.9 },
      { entity: "I-PER", word: "כהן", score: 0.95 },
      { entity: "B-GPE", word: "מח", score: 0.8 },
      { entity: "I-GPE", word: "##יפה", score: 0.8 },
    ];
    expect(alignPieces(text, pieces).map((s) => [text.slice(s.start, s.end), s.type])).toEqual([["ליוסי כהן", "PER"], ["מחיפה", "GPE"]]);
    expect(alignPieces(text, [{ entity: "B-PER", word: "מח", score: 0.9 }]).map((s) => text.slice(s.start, s.end))).toEqual(["מחיפה"]);
    expect(alignPieces(text, [{ entity: "B-PER", word: "כהן", score: 0.2 }])).toEqual([]);
  });
});

describe("DictaBERT-NER engine", () => {
  const pipe = async (text: string) => {
    const out: Array<{ entity: string; word: string; score: number }> = [];
    for (const w of ["משה", "לוי"]) if (text.includes(w)) out.push({ entity: w === "משה" ? "B-PER" : "I-PER", word: w, score: 0.99 });
    if (text.includes("ירושלים")) out.push({ entity: "B-GPE", word: "ירושלים", score: 0.97 });
    return out;
  };

  it("tags corpus tokens and extracts spans from one pipeline", async () => {
    const e = nerEngine("dictabert-ner:q8", "sha256:x", pipe);
    expect(await e.tag(["משה", "לוי", "גר", "ב", "ירושלים"])).toEqual(["B-PER", "I-PER", "O", "O", "B-GPE"]);
    expect(await e.extract("אתמול משה לוי הגיע")).toEqual([{ start: 6, end: 13, type: "PER" }]);
  });

  it("loads only a local folder (remote models off) and records the weights' sha256", async () => {
    await expect(makeDictaBertNer({})).rejects.toThrow(/LUMEN_NER_MODEL/);
    const dir = mkdtempSync(join(tmpdir(), "ner-"));
    const tf = { env: { allowRemoteModels: true, allowLocalModels: false } };
    const seen: unknown[] = [];
    const e = await makeDictaBertNer({ LUMEN_NER_MODEL: dir }, { transformers: tf, pipeline: async (...a: unknown[]) => (seen.push(a), pipe), digest: "sha256:abc" });
    expect(tf.env).toEqual({ allowRemoteModels: false, allowLocalModels: true });
    expect(seen[0]).toEqual(["token-classification", dir, { dtype: "q8" }]);
    expect(e).toMatchObject({ id: "dictabert-ner:q8", digest: "sha256:abc" });
    const f = join(dir, "w.onnx");
    writeFileSync(f, "weights");
    expect(await fileDigest(f)).toBe(`sha256:${createHash("sha256").update("weights").digest("hex")}`);
  });
});

describe("GLiNER engine", () => {
  // A toy tokenizer: one id per character, CLS 1, SEP 2.
  const tok = { encode: (s: string) => [...s].map((c) => 1000 + (c.codePointAt(0)! % 500)), cls: 1, sep: 2 };

  it("builds GLiNER's inputs: prompt first, words_mask on each word's first sub-token, every span up to the width", () => {
    const f = glinerInputs(tok, ["ab", "c"], ["person"], 3);
    const promptLen = "<<ENT>>".length + "person".length + "<<SEP>>".length;
    expect(f.input_ids[0]).toBe(1);
    expect(f.input_ids.at(-1)).toBe(2);
    expect(f.words_mask.slice(1, 1 + promptLen).every((m) => m === 0)).toBe(true);
    expect(f.words_mask.slice(1 + promptLen, -1)).toEqual([1, 0, 2]);
    expect(f.text_lengths).toEqual([2]);
    expect(f.span_idx).toEqual([0, 0, 0, 1, 0, 2, 1, 1, 1, 2, 1, 3]);
    expect(f.span_mask).toEqual([true, true, false, true, false, false]);
  });

  it("decodes logits [L, K, C] into the best non-overlapping spans", () => {
    const L = 3;
    const K = 2;
    const C = 2;
    const logits = new Float32Array(L * K * C).fill(-10);
    const at = (i: number, k: number, c: number, v: number) => (logits[(i * K + k) * C + c] = v);
    at(0, 1, 0, 3); // words 0-1, label 0, p 0.95
    at(1, 0, 1, 2); // word 1, label 1, p 0.88 — overlaps, dropped
    at(2, 0, 1, 1); // word 2, label 1, p 0.73
    at(2, 1, 0, 9); // out of range (2 + 1 >= L): never a span
    expect(decodeGliner(logits, L, K, C, 0.5).map((s) => [s.start, s.end, s.label])).toEqual([
      [0, 1, 0],
      [2, 2, 1],
    ]);
  });

  it("tags tokens and extracts spans with the NEMO labels; refuses logits of the wrong size", async () => {
    const names = Object.keys(NEMO_LABELS);
    const run = async (f: { L: number; K: number }) => {
      const out = new Float32Array(f.L * f.K * names.length).fill(-10);
      out[(0 * f.K + 1) * names.length + names.indexOf("person")] = 4; // words 0-1: person
      out[(f.L - 1) * f.K * names.length + names.indexOf("country or city")] = 4; // last word: GPE
      return out;
    };
    const e = glinerEngine({ id: "gliner:x", digest: "sha256:y", tok, run });
    expect(await e.tag(["דוד", "בן-גוריון", "נולד", "בפולין"])).toEqual(["B-PER", "I-PER", "O", "B-GPE"]);
    expect(await e.extract("דוד בן-גוריון נולד בפולין")).toEqual([{ start: 0, end: 13, type: "PER" }, { start: 19, end: 25, type: "GPE" }]);
    const bad = glinerEngine({ id: "g", digest: "d", tok, run: async () => new Float32Array(3) });
    await expect(bad.tag(["a"])).rejects.toThrow(/logits/);
  });

  it("feeds onnxruntime int64 and bool tensors in GLiNER's shapes", async () => {
    class Tensor {
      constructor(
        readonly type: string,
        readonly data: unknown,
        readonly dims: number[],
      ) {}
    }
    const f = glinerInputs(tok, ["ab", "c"], ["person"], 3);
    const feeds = ortFeeds({ Tensor }, f) as unknown as Record<string, Tensor>;
    expect(feeds.span_idx!.dims).toEqual([1, 6, 2]);
    expect(feeds.span_mask!.type).toBe("bool");
    expect(feeds.input_ids!.data).toBeInstanceOf(BigInt64Array);
    await expect(makeGliner({})).rejects.toThrow(/LUMEN_GLINER_DIR/);
    const g = await makeGliner({ LUMEN_GLINER_DIR: mkdtempSync(join(tmpdir(), "g-")) }, { tok, run: async (x: { L: number; K: number }) => new Float32Array(x.L * x.K * 9).fill(-9), digest: "sha256:z" });
    expect(await g.tag(["x"])).toEqual(["O"]);
  });
});

describe("plan 2.6: the redactor's names target on the golden harness", () => {
  it("a names model's PER spans reach findPii, raising names recall from 0", async () => {
    const items = [
      { id: "1", kind: "synthetic", text: "פגישה עם יוסי כהן מחר, טל' 052-1234567", entities: [{ start: 9, end: 17, type: "PERSON" }] },
      { id: "2", kind: "hard-negative", text: "רחוב הרצל 5 בתל אביב", entities: [] },
    ];
    const engine = { extract: async (t: string) => (t.includes("יוסי כהן") ? [{ start: t.indexOf("יוסי"), end: t.indexOf("יוסי") + 8, type: "PER" }, { start: 0, end: 5, type: "ORG" }] : [{ start: 0, end: 4, type: "LOC" }]) };
    const ner = namesFrom(engine);
    expect(await ner("פגישה עם יוסי כהן")).toEqual([{ start: 9, end: 17, type: "PERSON" }]);
    const patterns = await scoreWith((t: string) => findPii(t), items);
    const named = await scoreWith((t: string) => findPii(t, { ner }), items);
    expect(patterns["recall.names"]).toBe(0);
    expect(named["recall.names"]).toBe(1);
    expect(named["falseRedactions.negatives"]).toBe(0); // the LOC span is not a name
  });
});
