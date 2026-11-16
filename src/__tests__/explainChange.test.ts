/**
 * Plan W13.W13 — "explain my change": a word diff of two versions, meaning
 * changes found by rule before any model (numbers, negation, names), and a
 * summary of 3–5 lines that never mentions a change that did not happen.
 *
 * Acceptance: 100% of the number and negation changes of the set below are
 * found; a summary line about a change that did not happen is dropped.
 * The set is synthetic, written for this test (HE and EN).
 */
import { describe, expect, it, vi } from "vitest";
import { changeHunks, entitiesIn, explainChange, explainChangeAgent, lineGrounded, meaningChanges, negationsIn, numbersIn } from "../agents/writing/explainChange";

/** [older, newer, expected kinds with before→after] */
const SET: Array<[string, string, string[]]> = [
  ["התקציב הוא 15 מיליון ש״ח.", "התקציב הוא 150 מיליון ש״ח.", ["number:15→150"]],
  ["The rate rose by 3.5% last year.", "The rate rose by 3.7% last year.", ["number:3.5%→3.7%"]],
  ["הוא יבוא מחר לישיבה.", "הוא לא יבוא מחר לישיבה.", ["negation:→לא"]],
  ["We will ship on Monday.", "We will not ship on Monday.", ["negation:→not"]],
  ["She didn't sign the contract.", "She signed the contract.", ["negation:not→"]],
  ["אמרתי שאין לנו זמן.", "אמרתי שיש לנו זמן.", ["negation:אין→"]],
  ["נפגשנו שלוש פעמים.", "נפגשנו ארבע פעמים.", ["number:שלוש→ארבע"]],
  ["The team has twelve members.", "The team has ten members.", ["number:twelve→ten"]],
  ["The meeting moved to 12.3.2026.", "The meeting moved to 14.3.2026.", ["number:12.3.2026→14.3.2026", "entity:12.3.2026→14.3.2026"]],
  ["The report was written by Dana Levi.", "The report was written by Moshe Cohen.", ["entity:Dana Levi→Moshe Cohen"]],
  ["ההחלטה התקבלה עם ד״ר כהן.", "ההחלטה התקבלה עם ד״ר לוי.", ["entity:כהן→לוי"]],
  ["ראו [[Project Alpha]] לפרטים.", "ראו [[Project Beta]] לפרטים.", ["entity:Project Alpha→Project Beta"]],
  ["Sales grew in 2024.", "Sales fell in 2024.", []],
  ["הפרויקט הצליח מאוד.", "הפרויקט הצליח.", []],
  ["We never use cookies.", "We use cookies.", ["negation:never→"]],
  ["The fee is $20 per month.", "The fee is $25 per month, without tax.", ["number:20→25", "negation:→without"]],
  ["ההרשמה פתוחה ללא תשלום.", "ההרשמה פתוחה בתשלום.", ["negation:ללא→"]],
  ["Only 40% agreed.", "Only 4% agreed.", ["number:40%→4%"]],
  ["נדרשים 1,000 משתתפים.", "נדרשים 10,000 משתתפים.", ["number:1000→10000"]],
  ["This is allowed.", "This isn't allowed.", ["negation:→not"]],
];

function found(older: string, newer: string): string[] {
  return meaningChanges(changeHunks(older, newer)).map((m) => `${m.kind}:${m.before}→${m.after}`);
}

describe("W13.W13 meaning changes by rule", () => {
  it("100% of the number and negation changes in the set are found, and nothing else of those kinds", () => {
    let want = 0;
    let hit = 0;
    for (const [o, n, exp] of SET) {
      const got = found(o, n);
      const strict = exp.filter((e) => /^(number|negation):/.test(e));
      want += strict.length;
      hit += strict.filter((e) => got.includes(e)).length;
      expect(got.filter((g) => /^(number|negation):/.test(g)).sort(), `${o} → ${n}`).toEqual(strict.sort());
    }
    expect(hit / want).toBe(1);
    expect(want).toBeGreaterThanOrEqual(15);
  });

  it("names, links and dates that changed are found", () => {
    for (const [o, n, exp] of SET) for (const e of exp.filter((x) => x.startsWith("entity:"))) expect(found(o, n), `${o} → ${n}`).toContain(e);
  });

  it("number words, digits with separators and Hebrew prefixes", () => {
    expect(numbersIn("בשלושה מקרים, 1,500 איש ו-40%")).toEqual(["שלושה", "1500", "40%"]);
    expect(numbersIn("twenty-one people")).toContain("twenty");
    expect(negationsIn("ושלא ידע, ואין מה לעשות; he can't")).toEqual(["לא", "אין", "not"]);
    expect(entitiesIn("Yesterday we met Dana in Haifa.")).toEqual(["Dana", "Haifa"]);
  });

  it("two changes in one sentence report a changed name once; the context is the whole sentence", () => {
    const h = changeHunks("הצוות יבוא עם ד״ר כהן.", "הצוות לא יבוא עם ד״ר לוי.");
    const m = meaningChanges(h);
    expect(m.filter((x) => x.kind === "entity")).toHaveLength(1);
    expect(h[0].context).toBe("הצוות לא יבוא עם ד״ר לוי.");
  });

  it("hunks carry offsets into both versions", () => {
    const o = "אחת שתיים שלוש";
    const n = "אחת ארבע שלוש";
    const h = changeHunks(o, n);
    expect(h).toHaveLength(1);
    expect(o.slice(h[0].old.from, h[0].old.to)).toBe("שתיים");
    expect(n.slice(h[0].new.from, h[0].new.to)).toBe("ארבע");
    expect(changeHunks("same", "same")).toEqual([]);
  });
});

describe("W13.W13 the summary", () => {
  it("without a model: 3–5 lines from the rules, every meaning change named", async () => {
    const o = "התקציב הוא 15 מיליון. הוא יבוא מחר. הדוח נכתב בשבוע שעבר. הצוות גדל.";
    const n = "התקציב הוא 150 מיליון. הוא לא יבוא מחר. הדוח נכתב השבוע. הצוות קטן.";
    const r = await explainChange(o, n, { lang: "he" });
    expect(r.engine).toBe("rules");
    expect(r.summary.length).toBeGreaterThanOrEqual(3);
    expect(r.summary.length).toBeLessThanOrEqual(5);
    expect(r.summary.join("\n")).toContain("150");
    expect(r.summary.join("\n")).toContain("לא");
  });

  it("a model line about a change that did not happen is dropped (grounding check)", async () => {
    const o = "The budget is 15 million. We will ship on Monday.";
    const n = "The budget is 150 million. We will not ship on Monday.";
    const model = vi.fn(async () => [
      "The budget grew from 15 to 150 million.",
      "Shipping on Monday is now cancelled: not shipping.",
      "The deadline moved to 2027.",
      "The marketing team was renamed to Growth.",
    ].join("\n"));
    const r = await explainChange(o, n, { lang: "en", model });
    expect(r.engine).toBe("model");
    expect(r.dropped).toEqual(["The deadline moved to 2027.", "The marketing team was renamed to Growth."]);
    expect(r.summary[0]).toContain("150");
    // The prompt carries the rule-found meaning changes, and no tool is offered to the model.
    const input = model.mock.calls[0][0] as unknown as { text: string; extra: { meaning: string } };
    expect(input.extra.meaning).toContain("number");
    expect(input.extra.meaning).toContain("negation");
    expect(explainChangeAgent.tools).toBeUndefined();
    expect(explainChangeAgent.executorPreference).toEqual(["ollama", "webllm"]);
  });

  it("a meaning change the model left out is added from the rules", async () => {
    const r = await explainChange("We will ship 5 boxes.", "We will not ship 6 boxes.", { lang: "en", model: async () => "The wording was tightened." });
    const all = r.summary.join("\n");
    expect(all).toContain("6");
    expect(all.toLowerCase()).toContain("not");
  });

  it("lineGrounded: numbers must be changed numbers; content must touch the change", () => {
    const h = changeHunks("Pay 10 now.", "Pay 12 now.");
    expect(lineGrounded("The amount went from 10 to 12.", h)).toBe(true);
    expect(lineGrounded("The amount went from 10 to 13.", h)).toBe(false);
    expect(lineGrounded("Ownership was transferred to Acme.", h)).toBe(false);
  });

  it("honours the AbortSignal before calling the model", async () => {
    const ac = new AbortController();
    ac.abort();
    const model = vi.fn(async () => "x");
    await expect(explainChange("a b", "a c", { lang: "en", model, signal: ac.signal })).rejects.toThrow();
    expect(model).not.toHaveBeenCalled();
  });
});
