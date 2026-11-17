/**
 * Plan W13.W2 — the writing agents on their eval sets, with the numbers the
 * cards carry. The sets are synthetic (scripts/eval/writing-sets.mjs), so
 * every card is `dev`; the held-out split is scored on its own.
 *
 * With LUMEN_WRITE_CARDS=1 this writes eval/cards/writing/<agent>.json
 * (makeCard: bootstrap 95 % intervals over the per-item scores); without
 * it, it checks that the committed card is the one these sets give — a
 * card cannot go stale behind a changed rule or set.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — a plain .mjs module without types
import { makeCard, validateCard } from "../../scripts/lib/evalCard.mjs";
import { mean, scoreCoach, scoreConcision, scoreToneGuard, type CoachItem, type ConcisionItem, type ToneItem } from "../eval/writing/score";

const ROOT = join(__dirname, "../..");
const read = <T,>(agent: string, lang: string): T[] => readFileSync(join(ROOT, "eval/writing", agent, `${lang}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l) as T);
const both = <T,>(agent: string) => [...read<T>(agent, "he"), ...read<T>(agent, "en")];
const rulesDigest = (...files: string[]) => `sha256:${createHash("sha256").update(files.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n")).digest("hex")}`;
const setVersion = (agent: string) => {
  const m = JSON.parse(readFileSync(join(ROOT, "eval/writing", agent, "manifest.json"), "utf8"));
  return `${m.version}+${createHash("sha256").update(m.files["he.jsonl"].sha256 + m.files["en.jsonl"].sha256).digest("hex").slice(0, 12)}`;
};

function card(agent: string, model: string, ruleFiles: string[], scores: Record<string, number[]>) {
  return makeCard({
    tag: "dev",
    model: { name: model, digest: rulesDigest(...ruleFiles) },
    seed: 13,
    temperature: 0,
    dataset: { name: `eval/writing/${agent}`, version: setVersion(agent), license: "CC0-1.0", origin: "synthetic" },
    scores,
  });
}

/** Writes the card, or checks the committed one equals it. */
function settle(agent: string, c: Record<string, unknown>, notes: Record<string, unknown>) {
  const path = join(ROOT, "eval/cards/writing", `${agent}.json`);
  const report = { plan: "W13.W2", agent, notes, card: c };
  const text = JSON.stringify(report, null, 2) + "\n";
  if (process.env.LUMEN_WRITE_CARDS === "1") {
    mkdirSync(join(ROOT, "eval/cards/writing"), { recursive: true });
    writeFileSync(path, text);
  }
  expect(existsSync(path), `${path}: run with LUMEN_WRITE_CARDS=1`).toBe(true);
  expect(validateCard(JSON.parse(readFileSync(path, "utf8")).card)).toEqual([]);
  expect(readFileSync(path, "utf8"), `${agent}: the committed card is stale; re-run with LUMEN_WRITE_CARDS=1`).toBe(text);
}

const by = <T extends { lang: string; split: string }>(xs: T[], lang: string, split: string) => xs.filter((x) => x.lang === lang && x.split === split);

describe("writing evals (W13.W2)", () => {
  it("every set has ≥ 150 items per language and a 30 % held-out split", () => {
    for (const agent of ["styleCoach", "toneShifter", "concision"]) {
      for (const lang of ["he", "en"]) {
        const xs = read<{ split: string; origin: string }>(agent, lang);
        expect(xs.length).toBeGreaterThanOrEqual(150);
        expect(xs.filter((x) => x.split === "heldout").length / xs.length).toBeCloseTo(0.3, 1);
        expect(xs.every((x) => x.origin === "synthetic")).toBe(true);
      }
    }
  });

  it("styleCoach (W13.W3): precision ≥ 0.85 and recall ≥ 0.6 on the held-out split, in Hebrew and in English", () => {
    const items = both<CoachItem>("styleCoach");
    const notes: Record<string, number> = {};
    for (const lang of ["he", "en"]) {
      for (const split of ["dev", "heldout"]) {
        const s = scoreCoach(by(items, lang, split));
        notes[`${lang}.${split}.precision`] = Math.round(mean(s.precision) * 1000) / 1000;
        notes[`${lang}.${split}.recall`] = Math.round(mean(s.recall) * 1000) / 1000;
      }
      expect(notes[`${lang}.heldout.precision`], `${lang} precision`).toBeGreaterThanOrEqual(0.85);
      expect(notes[`${lang}.heldout.recall`], `${lang} recall`).toBeGreaterThanOrEqual(0.6);
    }
    const held = scoreCoach(items.filter((x) => x.split === "heldout"));
    settle("styleCoach", card("styleCoach", "rules (styleCoach, no model)", ["src/agents/writing/agents/styleRules.ts", "src/agents/writing/agents/styleCoach.ts"], { heldout_precision: held.precision, heldout_recall: held.recall }), notes);
  });

  it("toneShifter (W13.W4): the guard blocks every rewrite that changed a number, a name or a negation", () => {
    const items = both<ToneItem>("toneShifter");
    const notes: Record<string, number> = {};
    for (const lang of ["he", "en"]) {
      const s = scoreToneGuard(items.filter((x) => x.lang === lang));
      notes[`${lang}.recall`] = Math.round(mean(s.recall) * 1000) / 1000;
      notes[`${lang}.precision`] = Math.round(mean(s.precision) * 1000) / 1000;
      notes[`${lang}.passKept`] = Math.round(mean(s.passKept) * 1000) / 1000;
      expect(notes[`${lang}.recall`], `${lang}: a changed fact got through`).toBe(1);
    }
    const all = scoreToneGuard(items);
    settle("toneShifter", card("toneShifter", "rules (fact guard; the rewrites need a local model, owed)", ["src/agents/writing/facts.ts"], { guard_recall: all.recall, guard_precision: all.precision, kept_passed: all.passKept }), notes);
  });

  it("concision (W13.W5): 0 invented numbers or names get through; the length check agrees with an independent count", () => {
    const items = both<ConcisionItem>("concision");
    const notes: Record<string, number> = {};
    for (const lang of ["he", "en"]) {
      const s = scoreConcision(items.filter((x) => x.lang === lang));
      notes[`${lang}.inventedCaught`] = mean(s.inventedCaught);
      notes[`${lang}.factRecall`] = Math.round(mean(s.factRecall) * 1000) / 1000;
      notes[`${lang}.factPass`] = Math.round(mean(s.factPass) * 1000) / 1000;
      notes[`${lang}.lengthAgree`] = Math.round(mean(s.lengthAgree) * 1000) / 1000;
      expect(notes[`${lang}.inventedCaught`], `${lang}: an invented fact got through`).toBe(1);
    }
    const all = scoreConcision(items);
    settle("concision", card("concision", "rules (length + fact checks; the rewrites need a local model, owed)", ["src/agents/writing/facts.ts", "src/agents/writing/agents/concision.ts", "src/book/wordCount.ts"], { invented_caught: all.inventedCaught, fact_recall: all.factRecall, fact_pass: all.factPass, length_agree: all.lengthAgree }), notes);
  });
});
