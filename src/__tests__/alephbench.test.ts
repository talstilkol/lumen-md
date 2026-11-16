/**
 * Plan W11.I11 — AlephBench adapters. Acceptance: the adapters run on 5
 * examples per subset with a mock engine, and the average is computed as
 * the public leaderboard computes it (the mean of the per-subset scores).
 * The examples are synthetic (the real subsets are not redistributable);
 * the Mac run reads the real ones (src/agents/eval/alephbench.eval.ts).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { SUBSETS, cardScores, charF, lastNumber, macroAverage, nikudAccuracy, parseAlephJsonl, pickedChoice, promptOf, runAleph, scoreAnswer, scoresBySubset, subsetOf, tokenF1 } from "../../scripts/lib/alephbench.mjs";

interface AlephExample {
  id: string;
  subset: string;
  input: string;
  context?: string;
  choices?: string[];
  answer: string | number | string[];
}
interface AlephEngine {
  id: string;
  answer(prompt: string, e: AlephExample): Promise<string>;
}
type Row = { id: string; subset: string; score: number; answer: string; error?: string };
// @ts-expect-error — plain .mjs module without type declarations
import { makeCard, validateCard } from "../../scripts/lib/evalCard.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { measurements } from "../../scripts/lib/modelSelect.mjs";

/** Five synthetic examples per subset, with the answer a perfect model gives. */
function fixtures(): Array<AlephExample & { gold: string }> {
  const out: Array<AlephExample & { gold: string }> = [];
  const add = (subset: string, n: number, f: (i: number) => Omit<AlephExample, "id" | "subset"> & { gold: string }) => {
    for (let i = 0; i < n; i++) out.push({ id: `${subset}-${i}`, subset, ...f(i) });
  };
  const nli = ["entailment", "neutral", "contradiction"];
  const nliHe = ["היסק", "ניטרלי", "סתירה"];
  add("hebnli", 5, (i) => ({ context: "דנה קנתה לחם.", input: `משפט ${i}`, answer: nli[i % 3], gold: nliHe[i % 3] }));
  add("hebrew_qa", 5, (i) => ({ context: `ירושלים היא בירת ישראל. מספר ${i}.`, input: "מהי בירת ישראל?", answer: ["ירושלים"], gold: "בירושלים" }));
  const sent = ["positive", "negative", "neutral"];
  add("hebrew_sentiment", 5, (i) => ({ input: `טקסט ${i}`, answer: sent[i % 3], gold: ["Positive", "שלילי", "ניטרלי"][i % 3] }));
  add("winograd", 5, (i) => ({ input: `הגביע לא נכנס למזוודה כי הוא גדול מדי (${i}). מי גדול?`, choices: ["הגביע", "המזוודה"], answer: 0, gold: "א" }));
  add("winogrande", 5, (i) => ({ input: `משפט חסר ${i} _`, choices: ["רון", "דני"], answer: 1, gold: "התשובה: ב" }));
  add("mmlu_heb", 5, (i) => ({ input: `שאלה ${i}`, choices: ["1", "2", "3", "4"], answer: i % 4, gold: ["A", "ב", "ג.", "D)"][i % 4] }));
  add("gsm8k_heb", 5, (i) => ({ input: `לדני ${i} תפוחים ועוד 1,000. כמה?`, answer: i + 1000, gold: `החישוב: ${i} + 1000 = ${i + 1000}. התשובה: ${(i + 1000).toLocaleString("en-US")}` }));
  add("israeli_trivia", 5, (i) => ({ input: `מי היה ראש הממשלה הראשון? (${i})`, answer: ["דוד בן-גוריון", "בן גוריון"], gold: "דוד בן-גוריון" }));
  add("ted_heb", 5, (i) => ({ input: `שלום לכולם ${i}`, answer: [`Hello everyone ${i}`], gold: `Hello everyone ${i}` }));
  add("summarization", 5, (i) => ({ input: `טקסט ארוך ${i}`, answer: [`הכנס עסק בתקציב ${i}`], gold: `הכנס עסק בתקציב ${i}` }));
  add("nikud", 5, (i) => ({ input: "שלום עולם", answer: ["שָׁלוֹם עוֹלָם"], gold: i % 2 ? "שָׁלוֹם עוֹלָם" : "שָׁלוֹם עוֹלָם" }));
  return out;
}

const oracle = (xs: ReturnType<typeof fixtures>): AlephEngine => ({ id: "mock:oracle", answer: async (_p, e) => xs.find((x) => x.id === e.id)!.gold });

describe("the subsets", () => {
  it("are 11, each with an adapter kind and an instruction", () => {
    expect(SUBSETS).toHaveLength(11);
    expect(new Set((SUBSETS as Array<{ id: string }>).map((s) => s.id)).size).toBe(11);
    expect(() => subsetOf("hebnli")).not.toThrow();
    expect(() => subsetOf("nope")).toThrow(/unknown subset "nope"/);
  });
  it("a prompt has the instruction, the context, the input and lettered options", () => {
    const p = promptOf({ id: "w", subset: "winograd", context: "הקשר", input: "שאלה", choices: ["x", "y"], answer: 0 });
    expect(p).toBe(`${subsetOf("winograd").instruction}\n\nהקשר\n\nשאלה\n\nא. x\nב. y`);
  });
});

describe("5 examples per subset with a mock engine", () => {
  it("a perfect answer scores 1 in every subset; the macro average is 1", async () => {
    const xs = fixtures();
    for (const s of SUBSETS as Array<{ id: string }>) expect(xs.filter((x) => x.subset === s.id)).toHaveLength(5);
    const rows = await runAleph(xs, oracle(xs));
    expect(rows).toHaveLength(55);
    expect((rows as Row[]).filter((r) => r.score !== 1).map((r) => `${r.id}: ${r.score} for ${r.answer}`)).toEqual([]);
    expect(macroAverage(scoresBySubset(rows))).toBe(1);
  });

  it("an engine that always answers the first option or label scores what it should, per kind", async () => {
    const xs = fixtures();
    const lazy: AlephEngine = { id: "mock:first", answer: async (_p, e) => (e.choices ? "א" : e.subset === "hebnli" ? "היסק" : e.subset === "hebrew_sentiment" ? "חיובי" : "") };
    const by = scoresBySubset(await runAleph(xs, lazy));
    const mean = (k: string) => (by[k] as number[]).reduce((a, b) => a + b, 0) / by[k].length;
    expect(mean("hebnli")).toBeCloseTo(2 / 5); // entailment is items 0 and 3
    expect(mean("winograd")).toBe(1);
    expect(mean("winogrande")).toBe(0);
    expect(mean("mmlu_heb")).toBeCloseTo(2 / 5); // answers 0,1,2,3,0
    expect(mean("gsm8k_heb")).toBe(0);
    expect(mean("nikud")).toBe(0);
  });

  it("the average is the leaderboard's: per-subset means first, then their plain mean (not the mean over examples)", async () => {
    const xs = fixtures().filter((x) => x.subset !== "winograd" || x.id === "winograd-0");
    // winograd keeps one example (scored 0), every other subset is perfect.
    const engine: AlephEngine = { id: "mock", answer: async (_p, e) => (e.subset === "winograd" ? "ב" : fixtures().find((x) => x.id === e.id)!.gold) };
    const rows = await runAleph(xs, engine);
    const micro = (rows as Row[]).reduce((a, r) => a + r.score, 0) / rows.length;
    expect(micro).toBeCloseTo(50 / 51);
    expect(macroAverage(scoresBySubset(rows))).toBeCloseTo(10 / 11);
  });

  it("an engine error scores 0 and is kept on the row", async () => {
    const xs = fixtures().slice(0, 2);
    const rows = await runAleph(xs, { id: "mock:down", answer: async () => Promise.reject(new Error("ollama 500")) });
    expect((rows as Row[]).map((r) => [r.score, r.error])).toEqual([[0, "ollama 500"], [0, "ollama 500"]]);
  });
});

describe("the card", () => {
  it("macro (one score per subset) and nikud, which the default picker reads, plus one metric per subset", async () => {
    const xs = fixtures();
    const rows = await runAleph(xs, oracle(xs));
    const scores = cardScores(rows);
    expect(scores.macro).toHaveLength(11);
    expect(Object.keys(scores).filter((k) => k.startsWith("subset_"))).toHaveLength(11);
    const card = makeCard({ tag: "public", model: { name: "mock", digest: "ollama:sha256:x" }, seed: 1, temperature: 0, dataset: { name: "alephbench", version: "rev", license: "per subset", source: "https://huggingface.co/datasets/HebArabNlpProject/AlephBench" }, scores });
    expect(validateCard(card)).toEqual([]);
    expect(card.metrics.macro.value).toBe(1);
    const m = measurements([{ file: "a.json", report: { card, date: "2026-11-16" } }]);
    expect(m.byModel.get("mock")).toEqual({ aleph: 1, nikud: 1 });
  });
});

describe("scoring rules", () => {
  it("token F1 drops Hebrew one-letter prefixes and punctuation", () => {
    expect(tokenF1("בירושלים", "ירושלים")).toBe(1);
    expect(tokenF1("העיר ירושלים", "ירושלים")).toBeCloseTo(2 / 3);
    expect(tokenF1("", "x")).toBe(0);
  });
  it("chrF-like overlap: identical 1, unrelated 0, partial in between", () => {
    expect(charF("Hello everyone", "Hello everyone")).toBe(1);
    expect(charF("zzz", "Hello")).toBe(0);
    const p = charF("Hello all", "Hello everyone");
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });
  it("the last number, thousands separators allowed", () => {
    expect(lastNumber("3 + 4 = 7, so 1,007")).toBe(1007);
    expect(lastNumber("אין מספר")).toBeNull();
  });
  it("nikud: per letter, the same points; a missing point is wrong", () => {
    expect(nikudAccuracy("שָׁלוֹם", "שָׁלוֹם")).toBe(1);
    expect(nikudAccuracy("שלום", "שָׁלוֹם")).toBeCloseTo(2 / 4); // only ל and ם, which carry no points, match
    expect(nikudAccuracy("", "")).toBe(1);
  });
  it("a choice by letter (Hebrew or Latin), by option text, or a label by name; nothing named is null", () => {
    const e: AlephExample = { id: "x", subset: "mmlu_heb", input: "q", choices: ["חתול", "כלב", "סוס"], answer: 1 };
    const s = subsetOf("mmlu_heb");
    expect(pickedChoice("ב", e, s)).toBe(1);
    expect(pickedChoice("Answer: C", e, s)).toBe(2);
    expect(pickedChoice("אני חושב שזה כלב", e, s)).toBe(1);
    expect(pickedChoice("לא יודע", e, s)).toBeNull();
    expect(scoreAnswer({ id: "y", subset: "hebnli", input: "x", answer: "contradiction" }, "יש כאן סתירה")).toBe(1);
  });
  it("JSONL: a line of an unknown subset or without an answer is an error", () => {
    expect(parseAlephJsonl('{"subset":"hebnli","input":"a","answer":"neutral"}\n')).toHaveLength(1);
    expect(() => parseAlephJsonl('{"subset":"other","input":"a","answer":"x"}')).toThrow(/unknown subset/);
    expect(() => parseAlephJsonl('{"subset":"hebnli","input":"a"}')).toThrow(/needs subset, input and answer/);
  });
});
