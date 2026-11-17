/**
 * Plan W13.R3 — RSVP with rewind: the recognition point (from the right
 * in Hebrew, prefixes counted off), pauses at punctuation, rewind a
 * sentence, keys that follow the text's direction, and the reader UI.
 */
import { describe, it, expect } from "vitest";
import { graphemes, hebrewPrefixLength, keyAction, orpIndex, plainForRsvp, rewindSentence, rsvpWords, sentenceAround, wordDuration, WPM } from "../reading/rsvp";

const pivot = (w: string) => graphemes(w)[orpIndex(w)].normalize("NFD")[0];

// 50 English words: Spritz's table (1 → 1st letter, 2–5 → 2nd, 6–9 → 3rd, 10–13 → 4th, longer → 5th), punctuation not counted.
const EN: Array<[string, string]> = [
  ["a", "a"], ["I", "I"], ["an", "n"], ["the", "h"], ["word", "o"], ["house", "o"], ["reader", "a"], ["reading", "a"], ["comprehension", "p"], ["recognition", "o"],
  ["internationalization", "r"], ["backtrack", "c"], ["speed", "p"], ["apps", "p"], ["may", "a"], ["impair", "p"], ["by", "y"], ["limiting", "m"], ["ability", "i"], ["to", "o"],
  ["(hello,", "e"], ["world.", "o"], ["“quoted”", "o"], ["don't", "o"], ["e-mail", "m"], ["2026", "0"], ["x", "x"], ["psychological", "c"], ["science", "i"], ["Rayner", "y"],
  ["Schotter", "h"], ["comprehensively", "r"], ["fixation", "x"], ["saccade", "c"], ["regression", "r"], ["eye", "y"], ["movements", "v"], ["Spritz", "r"], ["optimal", "t"], ["point", "o"],
  ["Markdown", "r"], ["editor", "i"], ["local", "o"], ["first", "i"], ["lumen", "u"], ["notes", "o"], ["focus", "o"], ["sentence", "n"], ["paragraph", "r"], ["rewind", "w"],
];

// 50 Hebrew words: the same table counted from the word's start (its right), from the stem in words of 5+ letters.
const HE: Array<[string, string]> = [
  ["של", "ל"], ["את", "ת"], ["ו", "ו"], ["בית", "י"], ["שלום", "ל"], ["ספר", "פ"], ["ילדים", "ל"], ["הבית", "ב"], ["בבית", "ב"], ["ובבית", "י"],
  ["וכשהבית", "ב"], ["מחשבה", "ש"], ["ירושלים", "ו"], ["לירושלים", "ו"], ["תודה", "ו"], ["ממשלה", "ל"], ["הממשלה", "ל"], ["אהבה", "ה"], ["כתיבה", "י"], ["שמחה", "מ"],
  ["עברית", "ב"], ["בעברית", "ב"], ["המחשב", "ש"], ["תלמידים", "מ"], ["והתלמידים", "מ"], ["אני", "נ"], ["אתה", "ת"], ["הוא", "ו"], ["היא", "י"], ["אנחנו", "נ"],
  ["בְּרֵאשִׁית", "א"], ["בָּרָא", "ר"], ["אֱלֹהִים", "ל"], ["הַשָּׁמַיִם", "י"], ["וְאֵת", "א"], ["הָאָרֶץ", "א"], ["צה״ל", "ה"], ["ע״י", "י"], ["(שלום,", "ל"], ["סוף.", "ו"],
  ["מה?", "ה"], ["לכן", "כ"], ["כשהגעתי", "ע"], ["שהספר", "פ"], ["ספרייה", "ר"], ["ההחלטה", "ל"], ["התפתחות", "ת"], ["מדע", "ד"], ["כנסת", "נ"], ["בכנסת", "ס"],
];

describe("recognition point", () => {
  it("50 English words", () => {
    expect(EN.length).toBe(50);
    expect(EN.map(([w]) => `${w}:${pivot(w)}`)).toEqual(EN.map(([w, p]) => `${w}:${p}`));
  });

  it("50 Hebrew words — from the right, prefixes counted off, niqqud kept on its letter", () => {
    expect(HE.length).toBe(50);
    expect(HE.map(([w]) => `${w}:${pivot(w)}`)).toEqual(HE.map(([w, p]) => `${w}:${p}`));
    // The pivot is a whole grapheme: a letter with its marks.
    const g = graphemes("בָּרָא");
    expect(g[orpIndex("בָּרָא")]).toBe("רָ");
    expect(hebrewPrefixLength([..."וכשהבית"])).toBe(3);
    expect(hebrewPrefixLength([..."הבית"])).toBe(0);
  });
});

describe("words, sentences and timing", () => {
  const md = "---\ntitle: x\n---\n# Title\n\nFirst sentence, with a comma. Second one!\n\n```\ncode is skipped\n```\nשלום עולם. מה שלומך?";
  const words = rsvpWords(md);

  it("Markdown and code are not read; sentences end at punctuation and paragraph ends", () => {
    expect(plainForRsvp("**bold** [link](http://x) `code` [[Note|alias]]").trim()).toBe("bold link code alias");
    expect(words.map((w) => w.text)).toEqual(["Title", "First", "sentence,", "with", "a", "comma.", "Second", "one!", "שלום", "עולם.", "מה", "שלומך?"]);
    expect(words.map((w) => w.sentence)).toEqual([0, 1, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(words.filter((w) => w.rtl).map((w) => w.text)).toEqual(["שלום", "עולם.", "מה", "שלומך?"]);
  });

  it("stops longer at punctuation and paragraph ends; 150–600 wpm", () => {
    const at = (text: string, paragraphEnd = false) => wordDuration({ text, paragraphEnd }, 300);
    expect(at("word")).toBe(200);
    expect(at("word,")).toBe(300);
    expect(at("word.")).toBe(440);
    expect(at("word", true)).toBe(520);
    expect(at("internationalization")).toBe(260);
    expect(wordDuration({ text: "x", paragraphEnd: false }, 10_000)).toBe(60_000 / WPM.max);
    expect(wordDuration({ text: "x", paragraphEnd: false }, 1)).toBe(60_000 / WPM.min);
  });

  it("rewind: to the sentence's start, then to the one before", () => {
    expect(rewindSentence(words, 4)).toBe(1);
    expect(rewindSentence(words, 1)).toBe(0);
    expect(rewindSentence(words, 7)).toBe(6);
    expect(rewindSentence(words, 6)).toBe(1);
    expect(rewindSentence(words, 0)).toBe(0);
    expect(sentenceAround(words, 3)).toEqual({ from: 1, to: 6 });
  });

  it("keys follow the text's direction", () => {
    expect(keyAction("ArrowLeft", { rtl: false })).toBe("back");
    expect(keyAction("ArrowRight", { rtl: false })).toBe("forward");
    expect(keyAction("ArrowRight", { rtl: true })).toBe("back");
    expect(keyAction("ArrowLeft", { rtl: true })).toBe("forward");
    expect(keyAction("ArrowRight", { rtl: true, shift: true })).toBe("sentenceBack");
    expect(keyAction(" ", { rtl: true })).toBe("toggle");
    expect(keyAction("ArrowUp", { rtl: false })).toBe("faster");
    expect(keyAction("q", { rtl: false })).toBeNull();
  });
});
