/**
 * Plan W13.W4 — the tone and register shifter: a prompt per tone and
 * Hebrew register (with the user's style profile when on), three versions
 * from the local model, the meaning check (numbers, names, negations the
 * same — facts.ts) deciding which versions can be accepted, and a diff
 * against the source in the card. The guard's numbers on 352 rewrites are
 * in writingEval.test.ts and the card (npm run eval:card -- --agent toneShifter).
 */
import { describe, expect, it } from "vitest";
import { tonePrompt, toneShifter, toneSuggestion, versionsOf, VERSIONS } from "../agents/writing/agents/toneShifter";
import { checkFacts, namesIn, negationsIn, numbersIn } from "../agents/writing/facts";
import type { LocalModel } from "../agents/writing/model";
import { validateSuggestion } from "../agents/writing/suggestion";
import { planChanges, applyPlan } from "../agents/writing/engine";

describe("the fact guard (W13.W4)", () => {
  it("numbers: digits, thousands separators, number words in Hebrew and English", () => {
    expect(numbersIn("We sold 1,200 units for 3.5 each, three times.", "en")).toEqual(["1200", "3", "3.5"]);
    expect(numbersIn("מכרנו שלושה ספרים ב־40 שקלים", "he")).toEqual(["3", "40"]);
    expect(checkFacts("We need 3 chairs.", "We need three chairs.", "en").ok).toBe(true);
    expect(checkFacts("We need 3 chairs.", "We need four chairs.", "en").addedNumbers).toEqual(["4"]);
  });

  it("names: capitalised names in English, the Hebrew gazetteer, prefixes, titles, acronyms, Latin words in Hebrew", () => {
    expect(namesIn("Yesterday Dana met Tel Aviv's mayor.", "en")).toEqual(expect.arrayContaining(["dana", "tel aviv"]));
    expect(namesIn("Yesterday we met.", "en")).toEqual([]);
    expect(namesIn("ד״ר כהן נפגש עם יוסי בחיפה, ליד צה״ל ו־Google.", "he")).toEqual(expect.arrayContaining(["כהן", "יוסי", "חיפה", "צה״ל", "google"]));
    // "לדנה" still has "דנה"; "Aviv" does not have "Avi".
    expect(checkFacts("דנה שלחה את הדוח.", "הדוח נשלח לדנה.", "he").ok).toBe(true);
    expect(checkFacts("Avi lives in Tel Aviv.", "He lives in Tel Aviv.", "en").lostNames).toEqual(["avi"]);
    expect(checkFacts("דנה שלחה את הדוח.", "שירה שלחה את הדוח.", "he")).toMatchObject({ ok: false, lostNames: ["דנה"], addedNames: ["שירה"] });
  });

  it("negation: a dropped or added 'not' / ״לא״ is caught; לא → אינו and cannot → unable are not", () => {
    expect(checkFacts("We did not approve it.", "We approved it.", "en").negationDelta).toBe(-1);
    expect(checkFacts("We cannot come.", "We are unable to come.", "en").ok).toBe(true);
    expect(checkFacts("הוא לא מוכן.", "הוא אינו מוכן.", "he").ok).toBe(true);
    expect(checkFacts("אי אפשר לפתוח.", "לא ניתן לפתוח.", "he").ok).toBe(true);
    expect(checkFacts("הוא לא הגיע.", "הוא הגיע.", "he").ok).toBe(false);
    expect(negationsIn("I don't know, and I never did.", "en")).toBe(2);
  });

  it("a name the app's NER finds counts too (the W11.H11 hook)", () => {
    const ner = (t: string) => (t.includes("מרקוביץ") ? ["מרקוביץ"] : []);
    expect(checkFacts("מרקוביץ חתם.", "החוזה נחתם.", "he", { entities: ner }).lostNames).toEqual(["מרקוביץ"]);
  });
});

describe("prompts and versions (W13.W4)", () => {
  it("each tone and Hebrew register has its instruction; the style profile is added when given", () => {
    const f = tonePrompt("שלום", "he", { tone: "formal", register: "high", styleInstruction: "Short sentences." });
    expect(f.user).toMatch(/formal/);
    expect(f.user).toMatch(/עברית גבוהה/);
    expect(f.user).toMatch(/Short sentences/);
    expect(f.system).toMatch(/number, name, date and negation/);
    expect(tonePrompt("hi", "en", { tone: "friendly" }).user).not.toMatch(/Register/);
    expect(tonePrompt("שלום", "he", { tone: "neutral", register: "spoken" }).user).toMatch(/מדוברת/);
  });

  it("versions: JSON or numbered lines, distinct, never the source, at most three", () => {
    expect(versionsOf('{"versions": ["a", "b", "a", "src", "c", "d"]}', "src")).toEqual(["a", "b", "c"]);
    expect(versionsOf("1. one\n2. two\n3. three", "x")).toEqual(["one", "two", "three"]);
    expect(VERSIONS).toBe(3);
  });

  it("the versions that keep the facts are offered; the first is the replacement, the rest are alternatives", () => {
    const src = "Dana did not send the 3 reports to Haifa.";
    const s = toneSuggestion(src, ["Dana has not sent the three reports to Haifa.", "Dana sent the 3 reports to Haifa.", "Dana hasn't sent the 3 reports to Haifa yet."], "en", { tone: "formal" }, "qwen3:4b")!;
    expect(s.replacement).toBe("Dana has not sent the three reports to Haifa.");
    expect(s.alternatives).toEqual(["Dana hasn't sent the 3 reports to Haifa yet."]);
    expect(s.blocked).toBeUndefined();
    expect(s.aiAuthored).toBe(true);
    expect(validateSuggestion(s, src)).toEqual([]);
  });

  it("when no version keeps the facts, the card is blocked and says what changed", () => {
    const src = "יוסי שילם 40 שקלים.";
    const s = toneSuggestion(src, ["יוסי שילם 45 שקלים.", "דנה שילמה 40 שקלים."], "he", { tone: "friendly" }, "m")!;
    expect(s.blocked).toMatch(/מספרים/);
    expect(planChanges(src, [s], [{ id: s.id }]).skipped[0].reason).toBe("blocked");
    // The user may still edit it and accept their own text.
    expect(applyPlan(src, planChanges(src, [s], [{ id: s.id, text: "יוסי שילם 40 ש״ח." }]))).toBe("יוסי שילם 40 ש״ח.");
  });
});

describe("the agent on a local model (W13.W4)", () => {
  const fake = (versions: string[]): LocalModel => async (req) => ({ text: JSON.stringify({ versions }), model: "fake-local:1b" + (req.system.includes("ONLY JSON") ? "" : "?") });

  it("asks once for three versions and returns one suggestion over the passage (leading space kept out)", async () => {
    const text = "  Please send Noa the 2 files today.";
    const out = await toneShifter.run({ text, lang: "en", level: "professional", signal: new AbortController().signal, model: fake(["Kindly send Noa the 2 files today.", "Could you send Noa the two files today?", "Send Noa 5 files."]), options: { tone: "formal" } });
    expect(out).toHaveLength(1);
    expect(out[0].range).toEqual({ from: 2, to: text.length });
    expect(out[0].alternatives).toEqual(["Could you send Noa the two files today?"]);
    expect(out[0].kind).toBe("tone");
  });

  it("Hebrew register: the suggestion is a register change", async () => {
    const out = await toneShifter.run({ text: "איך דנה לא הגיעה?", lang: "he", level: "professional", signal: new AbortController().signal, model: fake(["כיצד דנה לא הגיעה?"]), options: { tone: "formal", register: "high" } });
    expect(out[0]).toMatchObject({ kind: "register", replacement: "כיצד דנה לא הגיעה?" });
  });

  it("no model: nothing (the command explains it needs one); cancel: rejects", async () => {
    expect(await toneShifter.run({ text: "hi", lang: "en", level: "everyday", signal: new AbortController().signal, model: null })).toEqual([]);
    const c = new AbortController();
    c.abort();
    await expect(toneShifter.run({ text: "hi", lang: "en", level: "everyday", signal: c.signal, model: fake(["hey"]) })).rejects.toThrow();
  });
});
