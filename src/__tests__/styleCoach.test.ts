/**
 * Plan W13.W3 — the clarity and style coach: local rules in Hebrew and
 * English (long sentences, passives, action nouns, hedges, wordy phrases,
 * redundant and doubled words), levels, the small model's ranking of the
 * findings, and the latency budget (≤ 150 ms a paragraph without a model,
 * ≤ 600 ms with one). Quality on the held-out split is in writingEval.test.ts
 * and the card (npm run eval:card -- --agent styleCoach).
 */
import { describe, expect, it } from "vitest";
import { coachRules, rankFindings, RANK_BUDGET_MS, sentences, styleCoach } from "../agents/writing/agents/styleCoach";
import type { LocalModel } from "../agents/writing/model";
import { planChanges, applyPlan } from "../agents/writing/engine";

const ids = (text: string, lang: "he" | "en", level: "everyday" | "professional" | "academic" = "professional") => coachRules(text, lang, level).map((s) => `${s.ruleId}:${s.original}`);
const fixAll = (text: string, lang: "he" | "en", level: "everyday" | "professional" | "academic" = "professional") => {
  const list = coachRules(text, lang, level);
  return applyPlan(text, planChanges(text, list, list.map((s) => ({ id: s.id }))));
};

describe("the style coach's rules (W13.W3)", () => {
  it("English: wordy, redundant, action nouns with the right tense, doubled words", () => {
    expect(fixAll("We met in order to plan it. The end result was fine.", "en")).toBe("We met to plan it. The result was fine.");
    expect(fixAll("They made a decision. She makes a recommendation. We are making a change.", "en")).toBe("They decided. She recommends. We are changing.");
    expect(fixAll("In order to win, revert back the the code.", "en")).toBe("To win, revert the code.");
  });

  it("English passives are advice (no automatic fix); adjectives that look like participles are not passives", () => {
    const f = coachRules("The report was written by Dana. She is interested in art. We were tired.", "en", "professional");
    const passives = f.filter((s) => s.kind === "passive");
    expect(passives.map((s) => s.original)).toEqual(["was written by"]);
    expect(passives[0].replacement).toBeNull();
    expect(passives[0].confidence).toBeGreaterThan(0.7);
  });

  it("hedges and fillers: removed with their comma, and the next word capitalised at a sentence start", () => {
    expect(fixAll("Basically, the plan works. It is very good.", "en")).toBe("The plan works. It is good.");
    expect(fixAll("It was kind of slow, really.", "en")).toBe("It was slow.");
  });

  it("levels: everyday lets 'very' and 'really' pass; professional flags them; academic tolerates longer sentences", () => {
    expect(ids("It is very good and really fast.", "en", "everyday")).toEqual([]);
    expect(ids("It is very good and really fast.", "en", "professional").length).toBe(2);
    const long = `${"word ".repeat(30).trim()}.`;
    expect(ids(long, "en", "professional").some((x) => x.startsWith("en.longSentence"))).toBe(true);
    expect(ids(long, "en", "academic").some((x) => x.startsWith("en.longSentence"))).toBe(false);
  });

  it("Hebrew: ״על ידי״ passives, ״ביצוע של״, wordy phrases, redundancy, keeping the prefix letters", () => {
    const text = "הדוח נכתב על ידי דנה. ביצוע של הבדיקה נמשך שבוע. וחזרו שוב למשרד על מנת לבדוק באופן מיידי.";
    const found = coachRules(text, "he", "professional");
    expect(found.find((s) => s.kind === "passive")!.original).toBe("נכתב על ידי");
    expect(found.find((s) => s.ruleId === "he.actionNounOf")!.replacement).toBeNull();
    expect(fixAll(text, "he")).toBe("הדוח נכתב על ידי דנה. ביצוע של הבדיקה נמשך שבוע. וחזרו למשרד כדי לבדוק מיד.");
    expect(fixAll("הם קיבלו החלטה לעשות שימוש בכלי.", "he")).toBe("הם החליטו להשתמש בכלי.");
    expect(fixAll("כאילו, זה ממש טוב.", "he")).toBe("זה טוב.");
  });

  it("Hebrew doubled words: an error is flagged, ״לאט לאט״ and ״צעד צעד״ are not", () => {
    expect(ids("שלחו את את הקובץ.", "he")).toEqual(["he.double:את את"]);
    expect(ids("לאט לאט הבנו. צעד צעד התקדמנו.", "he")).toEqual([]);
  });

  it("Hebrew niqqud and a maqaf do not break the rules; sentences split on . ! ? but not on 3.5 or e.g.", () => {
    const pointed = "הֵם חָזְרוּ שׁוּב לַבַּיִת.";
    expect(ids(pointed, "he")).toEqual(["he.redundancy:חָזְרוּ שׁוּב"]);
    expect(fixAll(pointed, "he")).toBe("הֵם חזרו לַבַּיִת.");
    expect(sentences("It costs 3.5 shekels, e.g. today. Next one!").map((s) => s.text.trim())).toEqual(["It costs 3.5 shekels, e.g. today.", "Next one!"]);
  });

  it("clean text has no findings", () => {
    expect(ids("Dana wrote the report on Monday. The team shipped the update.", "en")).toEqual([]);
    expect(ids("דנה כתבה את הדוח ביום שני. הצוות שלח את העדכון.", "he")).toEqual([]);
  });
});

describe("ranking with a small local model (W13.W3)", () => {
  const text = "Basically, the report was written by Dana in order to explain it. It was very good.";

  it("drops the findings the model scores as false alarms and blends the others' confidence", async () => {
    const found = coachRules(text, "en", "professional");
    const model: LocalModel = async () => ({ text: JSON.stringify({ scores: found.map((_, i) => (i === 0 ? 0.1 : 0.9)) }), model: "qwen3:0.6b" });
    const ranked = await rankFindings(text, found, model, new AbortController().signal, "en");
    expect(ranked.length).toBe(found.length - 1);
    expect(ranked.every((s) => s.rationale.includes("ranked"))).toBe(true);
  });

  it("a model that answers garbage or fails leaves the findings as they are", async () => {
    const found = coachRules(text, "en", "professional");
    expect(await rankFindings(text, found, async () => ({ text: "no idea", model: "m" }), new AbortController().signal, "en")).toEqual(found);
    expect(await rankFindings(text, found, async () => Promise.reject(new Error("down")), new AbortController().signal, "en")).toEqual(found);
  });

  it("≤ 600 ms with the model: a slow model is cut off at the ranking budget and the findings come back unranked", async () => {
    const slow: LocalModel = (_req, signal) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ text: '{"scores":[0]}', model: "slow" }), 5000);
        signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
      });
    const t0 = performance.now();
    const out = await styleCoach.run({ text, lang: "en", level: "professional", signal: new AbortController().signal, model: slow });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(600);
    expect(ms).toBeGreaterThanOrEqual(RANK_BUDGET_MS - 20);
    expect(out.length).toBe(coachRules(text, "en", "professional").length);
  });

  it("the user's cancel stops the run", async () => {
    const c = new AbortController();
    c.abort();
    await expect(styleCoach.run({ text, lang: "en", level: "professional", signal: c.signal, model: null })).rejects.toThrow();
  });
});

describe("latency without a model (W13.W3)", () => {
  it("≤ 150 ms a paragraph, measured over 200 paragraphs in each language", () => {
    const en = "Basically, the report was written by Dana in order to explain the end result of the twelve tests that we ran. We made a decision to revert back, which was very sensible, and the team kind of agreed with it after a long discussion about the budget.";
    const he = "ביצוע של הבדיקה נעשה על ידי הצוות באופן מיידי, והם חזרו שוב למשרד על מנת לבדוק את כל התיקים. כאילו, זה ממש טוב, ובסופו של דבר קיבלו החלטה לעשות שימוש בכלי החדש שפותח על ידי חברה קטנה.";
    for (const [lang, p] of [["en", en], ["he", he]] as const) {
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) coachRules(`${p} ${i}`, lang, "professional");
      const per = (performance.now() - t0) / 200;
      expect(per, `${lang}: ${per.toFixed(2)} ms a paragraph`).toBeLessThan(150);
    }
  });

  it("a 10 000-paragraph note (the whole note at once) is checked in well under a second per thousand paragraphs", () => {
    const para = "We met in order to plan the launch. The end result was fine.\n\n";
    const doc = para.repeat(10_000);
    const t0 = performance.now();
    const found = coachRules(doc, "en", "professional");
    const ms = performance.now() - t0;
    expect(found.length).toBe(20_000);
    expect(ms / 10).toBeLessThan(1000);
  });
});
