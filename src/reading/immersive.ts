/**
 * The immersive reader's text model (plan W13.R5): the note as paragraphs
 * of words, each word with its part of speech (src/text/hebrewPos.ts,
 * src/text/englishPos.ts — on this device), its syllables (English) and a
 * word-level translation from the offline lexicon when there is one. Pure;
 * the view is src/ui/ImmersiveReader.tsx. Nothing here reads the network.
 */
import { plainForRsvp } from "./rsvp";
import { tagHebrew, plainHebrew, peel, type Pos } from "../text/hebrewPos";
import { tagEnglish } from "../text/englishPos";

export interface ImmersiveToken {
  text: string;
  /** null for spaces and punctuation between words. */
  pos: Pos | null;
  rtl: boolean;
}

const HEBREW = /[֐-׿]/;

/** One paragraph's tokens: words tagged by their script's tagger, the text between them kept as is. */
export function tokenizeParagraph(text: string): ImmersiveToken[] {
  const tagged = [...tagHebrew(text), ...tagEnglish(text).filter((w) => !HEBREW.test(w.word))].sort((a, b) => a.from - b.from);
  const out: ImmersiveToken[] = [];
  let at = 0;
  for (const w of tagged) {
    if (w.from < at) continue;
    if (w.from > at) out.push({ text: text.slice(at, w.from), pos: null, rtl: false });
    out.push({ text: text.slice(w.from, w.to), pos: w.pos, rtl: HEBREW.test(w.word) });
    at = w.to;
  }
  if (at < text.length) out.push({ text: text.slice(at), pos: null, rtl: false });
  return out;
}

/** The note as paragraphs (Markdown and code dropped, as the RSVP reader reads it). */
export function immersiveParagraphs(md: string): ImmersiveToken[][] {
  return plainForRsvp(md)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter((p) => /[\p{L}\p{N}]/u.test(p))
    .map(tokenizeParagraph);
}

const VOWEL = /[aeiouy]/;
const KEEP = new Set(["th", "ch", "sh", "ph", "wh", "ck", "ng", "qu", "gh", "wr", "kn"]);

/**
 * English syllables, by rule (vowel groups; V-CV; VC-CV with digraphs kept
 * whole; a final silent e and a final consonant + le). Good enough to see
 * a word's beats, which is the reading aid; a dictionary would be exact.
 */
export function syllables(word: string): string[] {
  const w = word.toLowerCase();
  if (w.length <= 3 || !/^[a-z]+$/.test(w)) return [word];
  // -ing is its own syllable (read·ing, run·ning).
  if (/[^aeiou]ing$/.test(w) && w.length > 5 && /[aeiouy]/.test(w.slice(0, -3))) return [...syllables(word.slice(0, -3)), word.slice(-3)];
  // So are -ment, -ness, -ful and -less (gov·ern·ment, kind·ness).
  const suffix = /(ment|ness|ful|less)$/.exec(w);
  if (suffix && w.length - suffix[0].length >= 3 && /[aeiouy]/.test(w.slice(0, -suffix[0].length))) return [...syllables(word.slice(0, -suffix[0].length)), word.slice(-suffix[0].length)];
  const isV = (i: number) => VOWEL.test(w[i]) && !(w[i] === "y" && i === 0);
  const groups: Array<[number, number]> = [];
  for (let i = 0; i < w.length; ) {
    if (isV(i)) {
      let j = i;
      while (j < w.length && isV(j)) j++;
      groups.push([i, j]);
      i = j;
    } else i++;
  }
  // A final silent e is not a syllable (make, little has its own rule).
  if (groups.length > 1 && w.endsWith("e") && !w.endsWith("le") && groups[groups.length - 1][0] === w.length - 1) groups.pop();
  if (groups.length > 1 && /(es|ed)$/.test(w) && !/(ted|ded|ses|zes|ces|ges|xes|shes|ches)$/.test(w) && groups[groups.length - 1][0] === w.length - 2) groups.pop();
  if (groups.length < 2) return [word];
  const cuts: number[] = [];
  for (let g = 0; g < groups.length - 1; g++) {
    const end = groups[g][1];
    const next = groups[g + 1][0];
    const cons = next - end;
    let cut: number;
    if (cons <= 1) cut = end;
    else if (cons === 2) cut = KEEP.has(w.slice(end, next)) ? end : end + 1;
    else cut = KEEP.has(w.slice(next - 2, next)) ? next - 2 : end + 1;
    // A consonant + le at the end is its own syllable (lit-tle, ta-ble).
    if (g === groups.length - 2 && /[^aeiou]le$/.test(w) && next === w.length - 1) cut = w.length - 3;
    cuts.push(cut);
  }
  const out: string[] = [];
  let at = 0;
  for (const c of cuts) {
    if (c > at && c < word.length) {
      out.push(word.slice(at, c));
      at = c;
    }
  }
  out.push(word.slice(at));
  return out;
}

const FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const fold = (w: string) => w.replace(/[ךםןףץ]/g, (c) => FINALS[c]);

/**
 * A word's English from the offline lexicon (src/text/hebrewMorph.ts), with
 * its prefix letters peeled. Empty when the lexicon has no entry — the view
 * then offers the on-device translation model (plan 6.4), which asks before
 * it downloads anything.
 */
export async function lexiconTranslation(word: string): Promise<string[]> {
  if (!HEBREW.test(word)) return [];
  const { englishOf } = await import("../text/hebrewMorph");
  for (const { stem } of peel(plainHebrew(word))) {
    const hit = englishOf(fold(stem));
    if (hit.length) return hit;
  }
  return [];
}

/** Colours per part of speech, light and dark theme: text on the page keeps ≥ 4.5:1. */
export const POS_COLORS: Record<Exclude<Pos, "other">, { light: string; dark: string; label: string }> = {
  noun: { light: "#6d28d9", dark: "#c4b5fd", label: "n" },
  verb: { light: "#b91c1c", dark: "#fca5a5", label: "v" },
  adj: { light: "#15803d", dark: "#86efac", label: "adj" },
};
