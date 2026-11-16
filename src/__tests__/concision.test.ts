/**
 * Plan W13.W5 — shorten and expand: the length target in Hebrew words as
 * W5.8 counts them, the ±10 % range with retries, the "nothing invented,
 * nothing lost" check on numbers and names, and the AI mark on an
 * expansion. The checks' numbers on 320 results are in writingEval.test.ts
 * and the card (npm run eval:card -- --agent concision).
 */
import { describe, expect, it } from "vitest";
import { bulletsOf, checkResult, concise, concisionAgent, inRange, MAX_ATTEMPTS, targetWords } from "../agents/writing/agents/concision";
import type { LocalModel, ModelRequest } from "../agents/writing/model";
import { validateSuggestion } from "../agents/writing/suggestion";
import { planChanges } from "../agents/writing/engine";

const SRC_EN = "In order to finish the 12 reports for Dana before the trip to Haifa, the whole team basically stayed late every single night for a week, and in the end we did manage to send all of them on time.";
const SRC_HE = "על מנת לסיים את 12 הדוחות של דנה לפני הנסיעה לחיפה, כל הצוות בעצם נשאר מאוחר בכל ערב במשך שבוע שלם, ובסופו של דבר הצלחנו לשלוח את כולם בזמן.";

/** A model that answers in turn with each of `answers`, and records the prompts. */
function scripted(answers: string[]) {
  const asked: ModelRequest[] = [];
  const model: LocalModel = async (req) => {
    asked.push(req);
    return { text: answers[Math.min(asked.length - 1, answers.length - 1)], model: "fake-local:3b" };
  };
  return { model, asked };
}

describe("length (W13.W5)", () => {
  it("the target is 70 % of the words, counted the Hebrew way (W5.8: ה-CNN, צה״ל and ב־1948 are one word each)", () => {
    expect(targetWords("one two three four five six seven eight nine ten")).toBe(7);
    expect(targetWords("ראיתי את ה-CNN ואת צה״ל ב־1948 בבית", 50)).toBe(4);
    expect(targetWords(SRC_HE)).toBe(20); // 29 words
  });

  it("±10 % of the target, at least one word of slack", () => {
    expect(inRange(27, 30)).toBe(true);
    expect(inRange(26, 30)).toBe(false);
    expect(inRange(4, 5)).toBe(true);
    expect(inRange(3, 5)).toBe(false);
  });
});

describe("no invented or lost facts (W13.W5)", () => {
  const good = "To finish the 12 reports for Dana before the trip to Haifa, the team stayed late every night for a week, and we sent all of them on time.";
  it("a faithful shortening passes both checks", () => {
    const c = checkResult(SRC_EN, good, "en", { mode: "shorten" });
    expect(c).toMatchObject({ lengthOk: true, ok: true });
  });
  it("an invented number, an invented name, a lost name or a flipped negation is caught", () => {
    expect(checkResult(SRC_EN, `${good} It cost 400 shekels.`, "en", { mode: "shorten" }).facts.addedNumbers).toEqual(["400"]);
    expect(checkResult(SRC_EN, good.replace("Dana", "Noa"), "en", { mode: "shorten" }).facts.addedNames).toEqual(["noa"]);
    expect(checkResult(SRC_EN, good.replace("for Dana ", ""), "en", { mode: "shorten" }).facts.lostNames).toEqual(["dana"]);
    expect(checkResult("We did not go to Eilat.", "We went to Eilat.", "en", { mode: "shorten", percent: 10 }).facts.negationDelta).toBe(-1);
    expect(checkResult(SRC_HE, "כדי לסיים את 12 הדוחות של שירה לפני הנסיעה לחיפה, הצוות נשאר מאוחר כל ערב שבוע ושלח הכול בזמן.", "he", { mode: "shorten" }).facts.addedNames).toEqual(["שירה"]);
  });
});

describe("the agent (W13.W5)", () => {
  it("retries with the count it got until the result is in range, then offers it", async () => {
    const tooLong = SRC_EN.replace("basically ", "");
    const ok = "To finish the 12 reports for Dana before the trip to Haifa, the team stayed late every night for a week, and we sent all of them on time.";
    const { model, asked } = scripted([tooLong, ok]);
    const out = await concise(SRC_EN, "en", { mode: "shorten", percent: 30 }, model, new AbortController().signal);
    expect(out!.attempts).toBe(2);
    expect(out!.check.ok).toBe(true);
    expect(asked[1].user).toMatch(/had \d+ words; the target is \d+/);
  });

  it("an invention is retried with what was wrong, and blocked when the model keeps it", async () => {
    const bad = "To finish the 12 reports for Dana before the trip to Haifa, the team stayed late every night for 9 days, and we sent all of them on time.";
    const { model, asked } = scripted([bad]);
    const [s] = await concisionAgent.run({ text: SRC_EN, lang: "en", level: "professional", signal: new AbortController().signal, model, options: { mode: "shorten" } });
    expect(asked).toHaveLength(MAX_ATTEMPTS);
    expect(asked[1].user).toMatch(/changed facts/);
    expect(s.blocked).toMatch(/numbers added: 9/);
    expect(planChanges(SRC_EN, [s], [{ id: s.id }]).skipped[0].reason).toBe("blocked");
  });

  it("Hebrew shortening: in range, facts kept, a suggestion over the paragraph", async () => {
    const ok = "כדי לסיים את 12 הדוחות של דנה לפני הנסיעה לחיפה, הצוות נשאר מאוחר כל ערב במשך שבוע ושלח את כולם בזמן.";
    const { model } = scripted([ok]);
    const [s] = await concisionAgent.run({ text: SRC_HE, lang: "he", level: "professional", signal: new AbortController().signal, model, options: { mode: "shorten" } });
    expect(s.blocked).toBeUndefined();
    expect(s.message).toMatch(/קיצור ב־30%/);
    expect(validateSuggestion(s, SRC_HE)).toEqual([]);
  });

  it("bullets → paragraph: every bullet's facts kept, nothing added, and the text is marked as AI text", async () => {
    const bullets = "- Dana booked 3 rooms in Eilat\n- The flight leaves at 7:00\n- We do not need a car";
    expect(bulletsOf(bullets)).toEqual(["Dana booked 3 rooms in Eilat", "The flight leaves at 7:00", "We do not need a car"]);
    const para = "Dana booked 3 rooms in Eilat, and since the flight leaves at 7:00 and we do not need a car, the trip is set.";
    const { model, asked } = scripted([para]);
    const [s] = await concisionAgent.run({ text: bullets, lang: "en", level: "professional", signal: new AbortController().signal, model, options: { mode: "expand" } });
    expect(asked[0].system).toMatch(/add no facts/);
    expect(s).toMatchObject({ kind: "expansion", aiAuthored: true, replacement: para });
    expect(s.blocked).toBeUndefined();
    const { model: m2 } = scripted([`${para} It costs 900 shekels.`]);
    const [b] = await concisionAgent.run({ text: bullets, lang: "en", level: "professional", signal: new AbortController().signal, model: m2, options: { mode: "expand" } });
    expect(b.blocked).toMatch(/900/);
  });

  it("no model: nothing; cancelled: rejects", async () => {
    expect(await concisionAgent.run({ text: SRC_EN, lang: "en", level: "everyday", signal: new AbortController().signal, model: null })).toEqual([]);
    const c = new AbortController();
    c.abort();
    await expect(concisionAgent.run({ text: SRC_EN, lang: "en", level: "everyday", signal: c.signal, model: scripted(["x"]).model })).rejects.toThrow();
  });
});
