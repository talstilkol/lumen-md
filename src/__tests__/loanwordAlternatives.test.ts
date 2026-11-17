/**
 * Plan W13.W15 — Hebrew alternatives to loanwords: suggestions only in the
 * academic register (0 in the everyday default), the note's frontmatter
 * register wins, every term can be switched off, prefix letters are kept,
 * and the list's source and licence are documented.
 */
import { describe, expect, it } from "vitest";
import { detectLoanwords, loanwordEntries, noteRegister, parseLoanwords } from "../agents/writing/loanwords";
import { LOANWORDS_LICENSE } from "../agents/writing/data/loanwords";
import { toRangeProposal } from "../agents/writingReview";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEXT = "שלחתי אימייל לצוות עם פידבק על הפרויקט. באפליקציה יש פיצ'ר חדש, והדדליין קרוב.";

describe("W13.W15 loanword alternatives", () => {
  it("0 suggestions in the everyday register — the default", () => {
    expect(detectLoanwords(TEXT)).toEqual([]);
    expect(detectLoanwords(TEXT, { register: "everyday", lang: "he" })).toEqual([]);
    // A long everyday text full of loanwords: still none.
    expect(detectLoanwords(TEXT.repeat(200), { lang: "he" })).toEqual([]);
  });

  it("academic register: every loanword gets its Hebrew alternative, prefix letters kept", () => {
    const s = detectLoanwords(TEXT, { register: "academic", lang: "he" });
    expect(s.map((x) => [TEXT.slice(x.range.from, x.range.to), x.replacement])).toEqual([
      ["אימייל", "דוא״ל"],
      ["פידבק", "משוב"],
      ["הפרויקט", "המיזם"],
      ["באפליקציה", "ביישום"],
      ["פיצ'ר", "תכונה"],
      ["והדדליין", "והמועד האחרון"],
    ]);
    expect(s.every((x) => x.kind === "loanword" && x.agentId === "loanwords" && x.model === "rules")).toBe(true);
  });

  it("an inflected form gets the matching inflection; agreement and compounds lower the confidence and say why", () => {
    const s = detectLoanwords("הפרויקטים היו אופטימליים.", { register: "academic", lang: "he" });
    expect(s.map((x) => x.replacement)).toEqual(["המיזמים", "מיטביים"]);
    const a = detectLoanwords("האפליקציה חדשה.", { register: "academic", lang: "he" })[0];
    expect(a.confidence).toBeLessThan(0.8);
    expect(a.rationale).toContain("התאמה");
  });

  it("the article goes where Hebrew puts it on a two-word alternative", () => {
    const r = (t: string) => detectLoanwords(t, { register: "academic" }).map((x) => x.replacement);
    expect(r("הסטארטאפ גדל")).toEqual(["חברת ההזנק"]);
    expect(r("בסטארטאפ")).toEqual(["בחברת הזנק"]);
    expect(r("הסמארטפון")).toEqual(["הטלפון החכם"]);
    expect(r("וכשהסמארטפונים")).toEqual(["וכשהטלפונים החכמים"]);
    expect(r("הריברנדינג")).toEqual([null]);
  });

  it("the note's frontmatter register wins over the setting", () => {
    expect(noteRegister("---\nregister: academic\n---\nx")).toBe("academic");
    expect(noteRegister("---\nמשלב: משפטי\n---\nx")).toBe("academic");
    expect(noteRegister("---\nregister: everyday\n---\nx")).toBe("everyday");
    expect(noteRegister("no frontmatter")).toBeNull();
    expect(detectLoanwords(`---\nregister: academic\n---\n${TEXT}`).length).toBe(6);
    expect(detectLoanwords(`---\nregister: everyday\n---\n${TEXT}`, { register: "academic" })).toEqual([]);
  });

  it("the user switches a term off; the others stay", () => {
    const s = detectLoanwords(TEXT, { register: "academic", disabledTerms: ["אימייל", "פידבק"] });
    expect(s.map((x) => x.data?.term)).not.toContain("אימייל");
    expect(s.map((x) => x.data?.term)).not.toContain("פידבק");
    expect(s).toHaveLength(4);
    // Switching off by the term covers every form of it (מייל, מיילים).
    expect(detectLoanwords("שלחתי מיילים", { register: "academic", disabledTerms: ["אימייל"] })).toEqual([]);
  });

  it("not in code, links' targets or headings; Hebrew words that merely contain a loanword are left alone", () => {
    const md = "# פרויקט\n\n`אימייל` [קישור](https://x/פידבק) מיילדת ומיזם.";
    expect(detectLoanwords(md, { register: "academic" })).toEqual([]);
  });

  it("a fix is a proposal for the review queue, never a write", () => {
    const s = detectLoanwords(TEXT, { register: "academic" });
    const p = toRangeProposal(s[0], TEXT, "a.md");
    expect(p).toMatchObject({ kind: "range", before: "אימייל", after: "דוא״ל", path: "a.md" });
    const src = readFileSync(join(__dirname, "../agents/writing/loanwords.ts"), "utf8");
    expect(src).not.toMatch(/setContent|writeFile|dispatch\(|fetch\(/);
  });

  it("source and licence of the list are documented; the list is clean", () => {
    expect(LOANWORDS_LICENSE).toMatch(/CC0/);
    expect(LOANWORDS_LICENSE).toMatch(/Academy/);
    const all = loanwordEntries();
    expect(all.length).toBeGreaterThanOrEqual(60);
    for (const e of all) expect(e.alternatives).not.toContain(e.term);
    // No form maps to two terms.
    const forms = all.flatMap((e) => e.forms);
    expect(new Set(forms).size).toBe(forms.length);
    expect(parseLoanwords("א | א |")).toEqual([]);
  });
});
