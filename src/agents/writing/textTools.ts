/**
 * Small text tools the L5 writing checkers share (W13.W6–W10): words with
 * offsets (Hebrew with niqqud and geresh, Latin, digits), sentences with
 * offsets, a crude comparison stem for Hebrew and English, and the word
 * count rule (a word has a letter or a digit; maqaf joins, as in W5.8).
 *
 * No model, no network, no dependencies: these run on every keystroke.
 */

export interface Word {
  text: string;
  start: number;
  end: number;
  script: "he" | "la" | "num";
}

const NIQQUD = /[֑-ׇ]/g;
/** A Hebrew word may carry niqqud, and geresh / gershayim inside (״דוא״ל״, ״ג׳ירפה״). */
const WORD_RE = /[א-ת][א-ת֑-ׇ'"׳״]*|[A-Za-z][A-Za-z'’-]*|\d+(?:[.,]\d+)*/g;

export function words(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    let w = m[0];
    // A closing quote is punctuation, not a gershayim: trim quote marks at the end.
    while (/['"׳״’-]$/.test(w)) w = w.slice(0, -1);
    if (!w) continue;
    const start = m.index ?? 0;
    const script = /^\d/.test(w) ? "num" : /^[A-Za-z]/.test(w) ? "la" : "he";
    out.push({ text: w, start, end: start + w.length, script });
  }
  return out;
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

/**
 * Sentences of a paragraph. Ends at . ! ? … (and their runs) followed by
 * space or the end; a decimal point ("3.5") and an initial ("א. ב.") are not
 * an end; a line break inside a list is.
 */
export function sentences(text: string, base = 0): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ text: t, start: base + start + lead, end: base + start + lead + t.length });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" && (text[i + 1] === "\n" || /^\s*(?:[-*+]|\d+[.)])\s/.test(text.slice(i + 1)))) {
      push(i + 1);
      continue;
    }
    if (!".!?…".includes(c)) continue;
    let j = i;
    while (j + 1 < text.length && ".!?…\"'”״)".includes(text[j + 1])) j++;
    const next = text[j + 1];
    if (next !== undefined && !/\s/.test(next)) continue;
    // "א." or "A." alone (an initial or a list letter) is not a sentence end.
    const before = text.slice(Math.max(0, i - 2), i);
    if (c === "." && /(^|\s)\S$/.test(before) && !/\d/.test(before)) continue;
    push(j + 1);
    i = j;
  }
  push(text.length);
  return out;
}

const FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

/** Niqqud out, finals folded, quotes out, lower case. */
export function plain(w: string): string {
  return w
    .normalize("NFC")
    .replace(NIQQUD, "")
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/['"׳״’]/g, "")
    .toLowerCase();
}

const HE_PREFIX = "ובהלמשכ";

/**
 * A comparison stem: for Hebrew, up to two prefix letters off (when at least
 * three letters stay), a final ה/ת/ו/י off and inner ו/י dropped, so
 * ״נולד״, ״נולדה״ and ״שנולד״ meet; for English, a plural or tense ending off.
 */
export function stem(w: string): string {
  let s = plain(w);
  if (/^[א-ת]/.test(s)) {
    for (let k = 0; k < 2 && s.length >= 5 && HE_PREFIX.includes(s[0]); k++) s = s.slice(1);
    if (s.length >= 4 && "התוי".includes(s[s.length - 1])) s = s.slice(0, -1);
    if (s.length > 2) s = s[0] + s.slice(1, -1).replace(/[וי]/g, "") + s.slice(-1);
    return s;
  }
  if (s.length > 5 && s.endsWith("ing")) return s.slice(0, -3);
  if (s.length > 4 && s.endsWith("ed")) return s.slice(0, -2);
  if (s.length > 4 && s.endsWith("es")) return s.slice(0, -2);
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) return s.slice(0, -1);
  return s;
}

/** Function words (plain forms) that never carry a fact's meaning. */
export const STOP = new Set(
  [
    "של", "את", "על", "עם", "זה", "זו", "זאת", "הוא", "היא", "הם", "הן", "כי", "גם", "אבל", "או", "אם", "לא", "יש", "אין", "היה", "היתה", "הייתה", "היו", "כל",
    "מה", "מי", "אשר", "עד", "בין", "לפי", "אל", "כמו", "רק", "עוד", "כבר", "אחרי", "לפני", "שנת", "בשנת", "שנה", "כך", "ככה", "אז", "אך", "אף", "הזה", "הזו", "כ",
    "ב", "ל", "ה", "ו", "מ", "ש", "לו", "לה", "בו", "בה", "שלו", "שלה", "אותו", "אותה", "פי", "ידי", "כדי", "יותר", "מאוד", "כן", "אלה", "אלו", "ישנם", "נמצא",
    "the", "a", "an", "of", "in", "on", "at", "to", "was", "is", "were", "are", "and", "or", "by", "for", "with", "as", "that", "this", "it", "its", "from", "has",
    "had", "have", "been", "be", "year", "years", "which", "who", "also", "there", "than", "then", "into", "about", "some", "very",
  ].map(plain),
);

/** Words of a text (W5.8: a word has a letter or a digit). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

/** True when most letters are Hebrew. */
export function isHebrewText(text: string): boolean {
  const he = (text.match(/[א-ת]/g) ?? []).length;
  const la = (text.match(/[A-Za-z]/g) ?? []).length;
  return he > 0 && he >= la;
}

/** Share of Hebrew letters that carry niqqud (0..1). A fully pointed text is poetry, a prayer, a children's book. */
export function niqqudShare(text: string): number {
  const letters = (text.match(/[א-ת]/g) ?? []).length;
  if (!letters) return 0;
  const pointed = (text.match(/[א-ת][ְ-ׇּׁׂ]/g) ?? []).length;
  return pointed / letters;
}

/** Throws the platform AbortError when the signal is aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

/** Lets the UI breathe between chunks of a long run. */
export const breathe = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
