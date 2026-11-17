/**
 * W13.W9 — the Hebrew readability index and Flesch–Kincaid for English.
 *
 * Acceptance: Spearman ≥ 0.7 against the graded labels on the held-out
 * split (15 of 50 passages, never fitted on); the committed coefficients
 * equal a refit on the training split. Flesch–Kincaid: the formula and the
 * syllable rules checked by hand here; the ±0.1 match against a known
 * library on 50 texts is scripts/writing/fk-compare.py over
 * eval/fixtures/writing/readability/fk-en.jsonl (needs textstat: owed to the Mac).
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { HE_CORPUS, isHeldOut } from "../agents/writing/readability/corpusHe.eval";
import { englishReadability, fitHebrewModel, fleschKincaid, hebrewFeatures, hebrewReadability, readability, spearman, syllables, topList } from "../agents/writing/readability/readability";
import committed from "../agents/writing/readability/hebrewModel.json";
import { parseFrequencyList } from "../ai/hebrewFreq";
import { FK_TEXTS } from "./fixtures/writing/fkTexts";
// @ts-expect-error — a plain .mjs helper without types
import { bootstrapCi, validateCard } from "../../scripts/lib/evalCard.mjs";

const ROOT = resolve(__dirname, "../..");
const freq = topList(parseFrequencyList(readFileSync(resolve(ROOT, "public/dict/he_50k.txt"), "utf8")));
const train = HE_CORPUS.filter((t) => !isHeldOut(t));
const held = HE_CORPUS.filter(isHeldOut);

describe("the graded corpus", () => {
  it("50 passages, 10 per level, 15 held out (3 per level)", () => {
    expect(HE_CORPUS.length).toBe(50);
    for (let l = 1; l <= 5; l++) {
      expect(HE_CORPUS.filter((t) => t.level === l).length).toBe(10);
      expect(held.filter((t) => t.level === l).length).toBe(3);
    }
  });
});

describe("W13.W9 Hebrew index", () => {
  it("the committed coefficients are a refit on the training split", () => {
    const m = fitHebrewModel(train, freq, "src/agents/writing/readability/corpusHe.eval.ts (train split)");
    expect(m).toEqual(committed);
  });

  it("Spearman ≥ 0.7 on the held-out split, with and without the frequency list", () => {
    const levels = held.map((t) => t.level);
    expect(spearman(held.map((t) => hebrewReadability(t.text, freq).score), levels)).toBeGreaterThanOrEqual(0.7);
    expect(spearman(held.map((t) => hebrewReadability(t.text).score), levels)).toBeGreaterThanOrEqual(0.7);
  });

  it("features: letters (not niqqud) per word, words per sentence, rare and ambiguous shares", () => {
    const f = hebrewFeatures("סֵפֶר טוֹב. ספר דבר מלך.", freq);
    expect(f.sentences).toBe(2);
    expect(f.words).toBe(5);
    expect(f.wordLen).toBeCloseTo(15 / 5, 5);
    // The pointed words are not ambiguous; the three unpointed short ones are.
    expect(f.ambiguous).toBeCloseTo(3 / 5, 5);
    expect(hebrewFeatures("המדיניות האפיסטמולוגית", freq).rare).toBeGreaterThan(0);
    expect(hebrewFeatures("אני לא יודע", freq).rare).toBe(0);
  });

  it("says what raises the level, ordered, in points", () => {
    const hard = hebrewReadability(HE_CORPUS.find((t) => t.id === "he-L5-2")!.text, freq);
    const easy = hebrewReadability(HE_CORPUS.find((t) => t.id === "he-L1-1")!.text, freq);
    expect(hard.band).toBe("hard");
    expect(easy.band).toBe("easy");
    expect(hard.score).toBeGreaterThan(easy.score);
    expect(hard.reasons[0].points).toBeGreaterThan(0);
    expect(hard.reasons.map((r) => r.points)).toEqual([...hard.reasons.map((r) => r.points)].sort((a, b) => b - a));
    expect(["grade10-12", "academic"]).toContain(hard.stage);
  });

  it("empty and code-only text: no words, no crash", () => {
    expect(hebrewReadability("", freq).words).toBe(0);
    expect(readability("```\nconst a = 1;\n```").words).toBe(0);
  });

  it("10,000-word text in under 1 s", () => {
    const big = HE_CORPUS.map((t) => t.text).join(" ").repeat(8);
    const t0 = performance.now();
    const r = hebrewReadability(big, freq);
    expect(r.words).toBeGreaterThan(10_000);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("the eval card matches this run", () => {
    const sc = (set: typeof HE_CORPUS) => spearman(set.map((t) => hebrewReadability(t.text, freq).score), set.map((t) => t.level));
    // Per-item scores for the bootstrap: 1 when the item ranks on the right side of every other level's median.
    const ok = held.map((t) => {
      const s = hebrewReadability(t.text, freq).score;
      return Math.abs(s - t.level) <= 1 ? 1 : 0;
    });
    const pred = held.map((t) => hebrewReadability(t.text, freq).score);
    const lvl = held.map((t) => t.level);
    const rho = bootstrapCi(
      held.map((_, i) => i),
      { seed: 9, stat: (ix: number[]) => spearman(ix.map((i) => pred[i]), ix.map((i) => lvl[i])) },
    );
    delete rho.resamples;
    expect(rho.value).toBeCloseTo(sc(held), 5);
    const card = {
      schema: 1,
      tag: "dev",
      agent: "readability",
      model: { name: "linear index, 4 features (hebrewModel.json v1)", digest: "n/a (coefficients in the repository)" },
      seed: 9,
      temperature: 0,
      dataset: { name: "src/agents/writing/readability/corpusHe.eval.ts (held-out split)", version: "1", license: "MIT (written for lumen-md; graded by intended reader)", origin: "synthetic" },
      n: held.length,
      metrics: {
        spearman: rho,
        withinOneLevel: (() => {
          const b = bootstrapCi(ok, { seed: 9 });
          delete b.resamples;
          return b;
        })(),
      },
      notes: "Spearman on 15 held-out passages (bootstrap over passages). Calibration on an open graded corpus is owed (gate 0.10).",
    };
    const fk = FK_TEXTS.map((d) => ({ id: d.id, text: d.text, grade: fleschKincaid(d.text).grade }));
    const cardFile = resolve(ROOT, "eval/cards/writing/readability.json");
    const fkFile = resolve(ROOT, "eval/fixtures/writing/readability/fk-en.jsonl");
    const report = { card };
    if (process.env.LUMEN_WRITE_CARDS) {
      mkdirSync(dirname(cardFile), { recursive: true });
      writeFileSync(cardFile, `${JSON.stringify(report, null, 1)}\n`);
      mkdirSync(dirname(fkFile), { recursive: true });
      writeFileSync(fkFile, fk.map((r) => JSON.stringify(r)).join("\n") + "\n");
    }
    expect(fk.length).toBe(50);
    expect(validateCard(card)).toEqual([]);
    expect(existsSync(cardFile) && existsSync(fkFile)).toBe(true);
    expect(JSON.parse(readFileSync(cardFile, "utf8"))).toEqual(JSON.parse(JSON.stringify(report)));
    expect(readFileSync(fkFile, "utf8").trim().split("\n").map((l) => JSON.parse(l))).toEqual(fk);
  });
});

const EXTRA_EN = [
  "The cat sat on the mat.",
  "We went to the shop and bought bread, milk and eggs for the week.",
  "Photosynthesis converts light energy into chemical energy stored in sugars.",
  "The committee recommends a phased implementation, subject to periodic evaluation of outcomes.",
];

describe("Flesch–Kincaid (English)", () => {
  it("syllables by rule", () => {
    expect(["cat", "cake", "table", "wanted", "jumped", "boxes", "makes", "readability", "the", "yellow"].map(syllables)).toEqual([1, 1, 2, 2, 1, 2, 1, 5, 1, 2]);
  });
  it("the formula: 'The cat sat on the mat.' = 0.39·6 + 11.8·1 − 15.59", () => {
    const r = fleschKincaid("The cat sat on the mat.");
    expect([r.words, r.sentences, r.syllables]).toEqual([6, 1, 6]);
    expect(r.grade).toBeCloseTo(0.39 * 6 + 11.8 - 15.59, 2);
  });
  it("orders plain, general and academic English", () => {
    const g = EXTRA_EN.map((t) => englishReadability(t).score);
    expect(g[0]).toBeLessThan(g[1]);
    expect(g[1]).toBeLessThan(g[3]);
    expect(englishReadability(EXTRA_EN[3]).band).toBe("hard");
  });
  it("readability() picks the language by script", () => {
    expect(readability("שלום לכולם, מה שלומכם היום?").lang).toBe("he");
    expect(readability("Hello everyone.").lang).toBe("en");
  });
});
