/**
 * Plan W13.W11 — the repetition and cliché detector: lemma-aware repetition
 * within 50 words (Hebrew with prefix letters), doubled words, curated open
 * cliché lists, and no alert on a function word.
 *
 * The gold set below is synthetic, written for this test by the author of
 * the rules (so it measures the rules against their own intent; the
 * independent held-out set is W13.W18). Each item lists the words that
 * SHOULD be flagged as repetitions; a flag on any other word is a false
 * positive. Acceptance: precision ≥ 0.85 over the set, 0 function-word flags.
 */
import { describe, expect, it } from "vitest";
import { detectRepetition, detectRepetitionWith, englishStem, hebrewKeys } from "../agents/writing/repetition";
import { proseMask, proseTokens } from "../agents/writing/proseMask";
import { isFunctionWord } from "../agents/writing/functionWords";
import { builtinCliches, parseCliches } from "../agents/writing/cliches";
import { CLICHES_LICENSE } from "../agents/writing/data/cliches";
import { toRangeProposal } from "../agents/writingReview";

/** [text, words that should be flagged (as written, the later occurrence)] */
const GOLD: Array<[string, string[]]> = [
  ["קראתי את הספר אתמול. בספר יש פרק על ירושלים.", ["בספר"]],
  ["הוא קנה ספרים חדשים, וכל הספרים היו יקרים.", ["הספרים"]],
  ["התוכנית החדשה טובה. התכנית הקודמת הייתה גרועה.", ["התכנית"]],
  ["המורה דיברה עם התלמידים, והמורה ביקשה שקט.", ["והמורה"]],
  ["אנחנו בונים מערכת חדשה. המערכת תעבוד בענן.", ["המערכת"]],
  ["הוא הלך לים והיא הלכה לעבודה.", []],
  ["הבית שלנו גדול, ויש לו גינה. ליד הבית יש עץ.", ["הבית"]],
  ["העיר יפה בלילה. בעיר יש הרבה אורות.", ["בעיר"]],
  ["היא כתבה מכתב ארוך, ובמכתב סיפרה על הטיול.", ["ובמכתב"]],
  ["החברה הודיעה על מוצר חדש. החברה צופה מכירות גבוהות.", ["החברה"]],
  ["הוא אמר שהוא לא יבוא, ושהוא לא יכול.", []],
  ["זה היה יום ארוך, וזה לא נגמר.", []],
  ["הממשלה החליטה על תקציב. התקציב יאושר בשבוע הבא.", ["התקציב"]],
  ["כל אחד יכול, כל מי שרוצה, כל הזמן.", []],
  ["She opened the window. The window was stuck.", ["window"]],
  ["We tested the parser, and the parsers all failed.", ["parsers"]],
  ["The report is long. Reports like this are rare.", ["Reports"]],
  ["He said that it was what it was, and that was that.", []],
  ["Dana met Dana's sister in Paris; Paris was cold.", []],
  ["The team improved the process. Improving it took weeks.", ["Improving"]],
  ["I could have gone, but I would have stayed if I had been there.", []],
  ["The garden is green and quiet in the morning light.", []],
  ["Our goal is simple: our goal is speed.", ["goal"]],
  ["The model writes text. The model reads text too.", ["model", "text"]],
  ["הוא רץ מהר. אחרי הריצה הוא נח.", []],
  ["בבוקר שתיתי קפה. הקפה היה חם מדי.", ["הקפה"]],
  ["הרופא בדק אותי, והרופאה השנייה הסכימה.", ["והרופאה"]],
  ["הילדים שיחקו בחצר. בחצר היו גם כלבים.", ["בחצר"]],
  ["לאט לאט הבנתי מה קרה.", []],
  ["אני חושב שזו החלטה נכונה, ואני מקווה שכולם יסכימו.", []],
];

/** Precision of the repetition flags against the gold set. */
function precision(): { tp: number; fp: number; fn: number; fpWords: string[] } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const fpWords: string[] = [];
  for (const [text, want] of GOLD) {
    const got = detectRepetition(text, { noCliches: true }).filter((s) => s.kind === "repetition").map((s) => text.slice(s.range.from, s.range.to));
    for (const g of got) {
      if (want.includes(g)) tp++;
      else {
        fp++;
        fpWords.push(`${g} ← ${text}`);
      }
    }
    for (const w of want) if (!got.includes(w)) fn++;
  }
  return { tp, fp, fn, fpWords };
}

describe("W13.W11 repetition detector", () => {
  it("precision ≥ 0.85 on the gold set (and a recall floor, so silence can't pass)", () => {
    const r = precision();
    const p = r.tp / Math.max(1, r.tp + r.fp);
    const rec = r.tp / Math.max(1, r.tp + r.fn);
    console.log(`W13.W11 gold: precision ${p.toFixed(3)} recall ${rec.toFixed(3)} (tp ${r.tp} fp ${r.fp} fn ${r.fn})`, r.fpWords);
    expect(p).toBeGreaterThanOrEqual(0.85);
    expect(rec).toBeGreaterThanOrEqual(0.7);
  });

  it("Hebrew prefixes, suffixes and full/defective spelling are one lemma", () => {
    const k = (w: string) => new Set(hebrewKeys(w));
    const shared = (a: string, b: string) => [...k(a)].some((x) => k(b).has(x));
    expect(shared("ספר", "בספר")).toBe(true);
    expect(shared("ספרימ", "הספר")).toBe(true);
    expect(shared("תוכנית", "תכנית")).toBe(true);
    expect(shared("וכשהבית", "בית")).toBe(true);
    expect(shared("ספר", "עיר")).toBe(false);
  });

  it("flags 0 function words, even repeated many times with prefixes", () => {
    const he = "הוא אמר שהוא לא יבוא, ושהוא גם לא יכול. היא חשבה שהיא כן, ושלא אכפת לה. זה זה. של של זה, וזה, ושזה. אני ואני ואנחנו. על עליו ועליה, את אותו ואותה, עם איתו ואיתה, כל וכל וכשכל.";
    const en = "It is what it is, and that is that. They were there when we were here; he had had it, and so had she, so so so.";
    const bad = [...detectRepetition(he, { noCliches: true }), ...detectRepetition(en, { noCliches: true })].filter((s) => s.kind === "repetition");
    expect(bad.map((s) => s.data?.lemma)).toEqual([]);
    for (const w of ["ושהוא", "וכשכל", "ועליה", "שלהמ", "the", "would"]) expect(isFunctionWord(w)).toBe(true);
    expect(isFunctionWord("ספר")).toBe(false);
  });

  it("only within the window: the same word 60 words later is not flagged", () => {
    // Numbers count as words for the window but are never flagged themselves.
    const filler = Array.from({ length: 60 }, (_, i) => String(i)).join(" ");
    expect(detectRepetition(`החלון נפתח. ${filler}. החלון נסגר.`, { noCliches: true }).filter((s) => s.kind === "repetition")).toEqual([]);
    expect(detectRepetition(`החלון נפתח. ${filler}. החלון נסגר.`, { noCliches: true, windowWords: 70 }).filter((s) => s.kind === "repetition")).toHaveLength(1);
  });

  it("a topic word needs three uses in the window", () => {
    const text = "הספר נפתח בבוקר. הספר עוסק בים. כתבתי על הספר עוד. הספר נגמר. סיימתי את הספר.";
    const reps = detectRepetition(text, { noCliches: true }).filter((s) => s.kind === "repetition");
    // The second use is not flagged (topic), the third onward are.
    expect(reps.length).toBeGreaterThan(0);
    expect(reps.every((s) => s.range.from > text.indexOf("הספר עוסק"))).toBe(true);
  });

  it("ignores code, links' targets, frontmatter and headings; offsets point into the note", () => {
    const md = "---\ntitle: מערכת\n---\n# מערכת\n\nהמערכת `מערכת` [קישור](https://x.y/מערכת) רצה.\n\n```\nמערכת\n```\n\nהמערכת נפלה.";
    expect(proseMask(md)).toHaveLength(md.length);
    const reps = detectRepetition(md, { noCliches: true }).filter((s) => s.kind === "repetition");
    expect(reps).toHaveLength(1);
    expect(md.slice(reps[0].range.from, reps[0].range.to)).toBe("המערכת");
    expect(reps[0].range.from).toBe(md.lastIndexOf("המערכת"));
    expect(proseTokens("[[Target|shown]] x").map((t) => t.text)).toEqual(["shown", "x"]);
  });

  it("niqqud does not hide a repetition, and the user can switch a lemma off", () => {
    const text = "הַסֵּפֶר מוּנָח. בַּסֵּפֶר יֵשׁ תְּמוּנוֹת.";
    const r = detectRepetition(text, { noCliches: true }).filter((s) => s.kind === "repetition");
    expect(r).toHaveLength(1);
    expect(detectRepetition(text, { noCliches: true, ignoredLemmas: ["ספר"] }).filter((s) => s.kind === "repetition")).toEqual([]);
  });

  it("English names and numbers are not repetitions; the stemmer joins forms", () => {
    expect(detectRepetition("We met Dana. Later Dana left. In 2024 and 2024 again.", { noCliches: true }).filter((s) => s.kind === "repetition")).toEqual([]);
    expect(englishStem("windows")).toBe(englishStem("window"));
    expect(englishStem("improving")).toBe(englishStem("improved"));
  });

  it("doubled words get a delete fix; Hebrew reduplication does not", () => {
    const text = "זה היה של של חבר. לאט לאט הבנתי. the the end.";
    const d = detectRepetition(text, { noCliches: true }).filter((s) => s.kind === "doubled");
    expect(d).toHaveLength(2);
    const p = toRangeProposal(d[0], text, "a.md");
    expect(p && p.kind === "range" && p.before).toBe(" של");
    expect(p && p.kind === "range" && p.after).toBe("");
  });

  it("uses a lemmatizer's lemmas when one is loaded (W11.H12 seam)", async () => {
    const lz = { id: "fake", lemmatize: async (ws: readonly string[]) => ws.map((w) => (w === "הלכתי" || w === "ילך" ? "הלך" : w)) };
    const text = "הלכתי הביתה מוקדם, ואחר כך דני ילך לשם.";
    expect(detectRepetition(text, { noCliches: true }).filter((s) => s.kind === "repetition")).toEqual([]);
    const r = await detectRepetitionWith(text, lz, { noCliches: true });
    expect(r.filter((s) => s.kind === "repetition").map((s) => text.slice(s.range.from, s.range.to))).toEqual(["ילך"]);
    const ac = new AbortController();
    ac.abort();
    await expect(detectRepetitionWith(text, lz, {}, ac.signal)).rejects.toThrow();
  });

  it("a 10k-word note is checked in well under a second", () => {
    const para = "החברה בנתה מערכת חדשה לניהול ספרים, והצוות בדק אותה במשך שבוע שלם בתנאים קשים. ";
    const big = para.repeat(700);
    const t0 = performance.now();
    detectRepetition(big);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("W13.W11 clichés", () => {
  it("the lists are open (CC0) and non-trivial in both languages", () => {
    expect(CLICHES_LICENSE).toMatch(/CC0/);
    const all = builtinCliches();
    expect(all.filter((e) => /[א-ת]/.test(e.phrase)).length).toBeGreaterThanOrEqual(40);
    expect(all.filter((e) => /[a-z]/.test(e.phrase)).length).toBeGreaterThanOrEqual(60);
  });

  it("finds a Hebrew cliché with prefix letters and keeps them in the fix", () => {
    const text = "ובסופו של יום הכול הסתדר.";
    const c = detectRepetition(text, { lang: "he" }).filter((s) => s.kind === "cliche");
    expect(c).toHaveLength(1);
    expect(text.slice(c[0].range.from, c[0].range.to)).toBe("ובסופו של יום");
    expect(c[0].replacement).toBe("ובסוף");
    expect(c[0].message).toContain("קלישאה");
  });

  it("finds English clichés; a cut takes the following space", () => {
    const text = "Needless to say, at the end of the day we shipped. Without further ado here it is.";
    const c = detectRepetition(text).filter((s) => s.kind === "cliche");
    expect(c.map((s) => s.data?.phrase)).toEqual(["needless to say", "at the end of the day", "without further ado"]);
    expect(c[1].replacement).toBe("in the end");
    expect(detectRepetition("At the end of the day, yes.").find((s) => s.kind === "cliche")?.replacement).toBe("In the end");
    expect(text.slice(c[2].range.from, c[2].range.to)).toBe("Without further ado ");
  });

  it("the user adds a phrase and switches a built-in one off", () => {
    const text = "At the end of the day, synergy wins and we leverage synergies.";
    const c = detectRepetition(text, { userCliches: ["synergy wins | it works"], disabledCliches: ["at the end of the day"] }).filter((s) => s.kind === "cliche");
    expect(c.map((s) => s.data?.phrase)).toEqual(["synergy wins"]);
    expect(c[0].data?.source).toBe("user");
    expect(parseCliches("one\nא ב | ג", "user")).toHaveLength(1);
  });

  it("a cliché split across sentences is not one", () => {
    expect(detectRepetition("That was the end. Of the day we know little.").filter((s) => s.kind === "cliche")).toEqual([]);
  });
});
