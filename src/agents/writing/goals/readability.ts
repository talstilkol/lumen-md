/**
 * Readability and tone estimates for writing goals (W13.W14).
 *
 * English: Flesch–Kincaid grade level (syllables by vowel groups). Hebrew:
 * no standard formula exists yet; W13.W9 builds and calibrates one. Until it
 * lands, a provisional estimate stands in — mean word length in letters
 * (the syllable proxy of Elek-BenMoshe & Rafaeli 2025) and mean sentence
 * length — and is labelled provisional in the UI. `setReadabilityEngine`
 * is the seam W13.W9 plugs into.
 *
 * Tone: rule markers, not a model. Formal (passive and impersonal forms,
 * "יש ל", connectives such as "לפיכך", "אולם", no first-person chat) against
 * casual (slang, "אחלה", "סבבה", contractions, exclamation runs, emoji).
 */
import { proseOf } from "../../../book/wordCount";

export type Level = "easy" | "medium" | "hard";
export type Tone = "formal" | "neutral" | "casual";

export interface Readability {
  level: Level;
  /** Grade-like number (English: Flesch–Kincaid grade). */
  score: number;
  /** The Hebrew stand-in until W13.W9. */
  provisional: boolean;
}

type Engine = (text: string) => Readability | null;
let hebrewEngine: Engine | null = null;
/** W13.W9 registers the calibrated Hebrew index here. */
export function setReadabilityEngine(fn: Engine | null): void {
  hebrewEngine = fn;
}

const sentences = (s: string) => s.split(/(?<=[.!?؟。])\s+|\n\s*\n/).map((x) => x.trim()).filter((x) => /\p{L}/u.test(x));
const wordsOf = (s: string) => s.match(/[\p{L}\p{M}]+(?:['’׳״"-][\p{L}\p{M}]+)*/gu) ?? [];

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function fleschKincaid(text: string): number {
  const ss = sentences(text);
  const ws = wordsOf(text);
  if (!ss.length || !ws.length) return 0;
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  return Math.round((0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59) * 10) / 10;
}

export function readabilityOf(markdown: string): Readability | null {
  const text = proseOf(markdown);
  const ws = wordsOf(text);
  if (ws.length < 30) return null;
  const hebrew = ws.filter((w) => /[א-ת]/.test(w)).length / ws.length >= 0.5;
  if (hebrew) {
    const engine = hebrewEngine?.(text);
    if (engine) return engine;
    const ss = sentences(text);
    const letters = ws.reduce((a, w) => a + w.replace(/[^א-ת]/g, "").length, 0) / ws.length;
    const perSentence = ws.length / Math.max(1, ss.length);
    // Provisional: scaled so a children's text (≈4 letters, ≈8 words) is ~3 and dense prose (≈5.5, ≈25) ~14.
    const score = Math.round((4.2 * (letters - 3.6) + 0.33 * perSentence + 0.5) * 10) / 10;
    return { level: score < 7 ? "easy" : score < 11 ? "medium" : "hard", score, provisional: true };
  }
  const score = fleschKincaid(text);
  return { level: score < 7 ? "easy" : score < 11 ? "medium" : "hard", score, provisional: false };
}

const CASUAL = /(?:^|[\s"'(])(?:אחלה|סבבה|יאללה|וואלה|בקיצר|כאילו|חבל"?״?על הזמן|תכלס|אחי|לול|lol|gonna|wanna|gotta|kinda|yeah|hey|awesome|cool|stuff)(?=$|[\s.,!?)"'])/giu;
const FORMAL = /(?:^|[\s(])(?:לפיכך|אולם|ברם|יתר על כן|כמו כן|בהתאם ל|על פי|לאור|יש ל|נדרש|מתבקש|הנ"ל|הנ״ל|therefore|however|moreover|furthermore|accordingly|pursuant|whereas|hereby|thus|consequently)(?=$|[\s.,;:)])/giu;
const EMOJI = /\p{Extended_Pictographic}/gu;

export interface ToneEstimate {
  tone: Tone;
  /** Markers found, for the explanation. */
  formal: number;
  casual: number;
}

export function toneOf(markdown: string): ToneEstimate | null {
  const text = proseOf(markdown);
  const n = wordsOf(text).length;
  if (n < 30) return null;
  const casual = (text.match(CASUAL)?.length ?? 0) + (text.match(EMOJI)?.length ?? 0) + (text.match(/!{2,}|\?!|\b\w+n't\b|\bI'm\b/g)?.length ?? 0);
  const formal = text.match(FORMAL)?.length ?? 0;
  const per100 = (k: number) => (k * 100) / n;
  const tone: Tone = per100(casual) >= 1 && casual > formal ? "casual" : per100(formal) >= 0.8 && formal > casual ? "formal" : "neutral";
  return { tone, formal, casual };
}
