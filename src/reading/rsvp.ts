/**
 * RSVP — one word at a time at a fixed place (plan W13.R3). Experimental.
 *
 * Spritz and its kin are popular, but the research is clear that removing
 * the reader's own look-backs costs comprehension (Schotter, Tran & Rayner,
 * Psychological Science 2014; Rayner, Schotter, Masson, Potter & Treiman,
 * Psychological Science in the Public Interest 2016). So this reader has
 * rewind built in — back a word, back to the start of the sentence, and the
 * sentence shown around the word whenever it is paused — and it slows down
 * where reading slows down: at punctuation, long words and paragraph ends.
 *
 * The optimal recognition point (ORP) is the letter the eye fixates. In
 * Latin script it is a little left of the middle (Spritz's table: 1 letter →
 * 1st, 2–5 → 2nd, 6–9 → 3rd, 10–13 → 4th, longer → 5th). Hebrew reads right
 * to left, so the same count runs from the right — the word's start — and it
 * counts from the stem: the one-letter prefixes (ו ה ב כ ל מ ש, up to three
 * of them, as in ״וכשהבית״) are skipped in words of five letters or more,
 * leaving a stem of at least three, so the point lands in the word's body
 * rather than on a particle (a design decision; `hebrewPrefixLength`).
 * Positions are in grapheme clusters, so a letter keeps its niqqud.
 */

export interface RsvpWord {
  /** As shown (with its punctuation and niqqud). */
  text: string;
  /** Grapheme clusters of `text`. */
  graphemes: string[];
  /** Index into `graphemes` of the recognition point. */
  orp: number;
  /** Index of the sentence this word belongs to. */
  sentence: number;
  /** Ends a paragraph. */
  paragraphEnd: boolean;
  rtl: boolean;
}

const HEBREW = /[֐-׿]/;
const LETTER = /[\p{L}\p{N}]/u;
/** Which prefix letter may follow which (text/hebrewPrefix's table, kept here: this module loads nothing). */
const PREFIX_NEXT: Record<string, string> = { "ו": "שהבכלמ", "ש": "הבכלמ", "כ": "ש", "מ": "הש", "ה": "", "ב": "", "ל": "" };

let graphemeSeg: Intl.Segmenter | null | undefined;
/** Grapheme clusters: a Hebrew letter with its niqqud and cantillation is one. */
export function graphemes(s: string): string[] {
  if (graphemeSeg === undefined) {
    try {
      graphemeSeg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    } catch {
      graphemeSeg = null;
    }
  }
  if (graphemeSeg) return [...graphemeSeg.segment(s)].map((g) => g.segment);
  // Fallback: a base character with the combining marks after it.
  return s.match(/\P{M}\p{M}*/gu) ?? [];
}

/** Spritz's table: the recognition point's position (0-based) in a word of `n` letters. */
export function orpOffset(n: number): number {
  if (n <= 1) return 0;
  if (n <= 5) return 1;
  if (n <= 9) return 2;
  if (n <= 13) return 3;
  return 4;
}

/**
 * How many prefix letters a Hebrew word's stem starts after (0–3). A
 * heuristic without a lexicon: only words of five letters or more, and a
 * stem of three letters or more is always left; each next prefix letter
 * must be one that may follow the last (וכש, מה, שה — never ה then ב).
 * Audit r4 A1.4: מ and ש start so many nouns (משפחה, ממשלה, מלכות, שולחן,
 * שמשון) that they count as a prefix only before the article ה (מהבית,
 * שהספר). Its known error is then a word that merely starts with ו, ה, ב,
 * כ or ל (״לימודים״ read as ל + ימודים): the point lands one letter later,
 * inside the tolerance of a fixation.
 */
export function hebrewPrefixLength(letters: string[]): number {
  if (letters.length < 5) return 0;
  let n = 0;
  while (n < 3 && letters.length - (n + 1) >= 3) {
    const c = letters[n];
    if (!(c in PREFIX_NEXT)) break;
    if (n > 0 && !PREFIX_NEXT[letters[n - 1]].includes(c)) break;
    if ((c === "מ" || c === "ש") && letters[n + 1] !== "ה") break;
    n++;
  }
  return n;
}

/** The ORP of a word, as an index into its graphemes (punctuation around the word does not count). */
export function orpIndex(word: string): number {
  const g = graphemes(word);
  const letterIdx = g.map((x, i) => (LETTER.test(x) ? i : -1)).filter((i) => i >= 0);
  if (!letterIdx.length) return Math.floor((g.length - 1) / 2);
  const rtl = HEBREW.test(word);
  // Hebrew: the base letters, without marks, for the prefix test.
  const letters = letterIdx.map((i) => g[i].normalize("NFD")[0]);
  const skip = rtl ? hebrewPrefixLength(letters) : 0;
  const stem = letterIdx.length - skip;
  return letterIdx[skip + orpOffset(stem)];
}

/** A note's text as words: Markdown syntax, code, frontmatter, link targets and HTML are dropped. */
export function plainForRsvp(md: string): string {
  return md
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>\n]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s.,;:!?)]|$)/g, "$1$2")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\|/g, " ");
}

const SENTENCE_END = /[.!?׃…]["'”״’)\]]*$/;

/** The note as RSVP words, with sentence and paragraph boundaries. */
export function rsvpWords(md: string): RsvpWord[] {
  const out: RsvpWord[] = [];
  let sentence = 0;
  const paragraphs = plainForRsvp(md).split(/\n\s*\n/);
  for (const para of paragraphs) {
    const tokens = para.split(/\s+/).filter((w) => w && /[\p{L}\p{N}]/u.test(w));
    tokens.forEach((text, i) => {
      out.push({ text, graphemes: graphemes(text), orp: orpIndex(text), sentence, paragraphEnd: i === tokens.length - 1, rtl: HEBREW.test(text) });
      // A sentence ends at its punctuation, and always at the end of a paragraph (a heading, a list item).
      if (SENTENCE_END.test(text) || i === tokens.length - 1) sentence++;
    });
  }
  return out;
}

export const WPM = { min: 150, max: 600, step: 10 } as const;

/**
 * How long a word stays, in ms, at `wpm`: longer at the end of a sentence
 * (×2.2) and a paragraph (×2.6), after a comma, colon or semicolon (×1.5),
 * and for a long word (×1.3 over 8 letters, as the eye needs it).
 */
export function wordDuration(w: Pick<RsvpWord, "text" | "paragraphEnd">, wpm: number): number {
  const base = 60_000 / Math.min(WPM.max, Math.max(WPM.min, wpm));
  let k = 1;
  if (w.paragraphEnd) k = 2.6;
  else if (SENTENCE_END.test(w.text)) k = 2.2;
  else if (/[,;:־–—]["'”״’)]*$/.test(w.text)) k = 1.5;
  const letters = w.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (letters > 8) k *= 1.3;
  return Math.round(base * k);
}

/** Where "back a sentence" goes from word `i`: the sentence's first word, or the one before when already there. */
export function rewindSentence(words: readonly RsvpWord[], i: number): number {
  if (!words.length) return 0;
  const at = Math.min(Math.max(0, i), words.length - 1);
  let start = at;
  while (start > 0 && words[start - 1].sentence === words[at].sentence) start--;
  if (start < at) return start;
  if (start === 0) return 0;
  const prev = words[start - 1].sentence;
  let p = start - 1;
  while (p > 0 && words[p - 1].sentence === prev) p--;
  return p;
}

/** The words of the sentence holding word `i` (the context shown on pause). */
export function sentenceAround(words: readonly RsvpWord[], i: number): { from: number; to: number } {
  if (!words.length) return { from: 0, to: 0 };
  const s = words[Math.min(Math.max(0, i), words.length - 1)].sentence;
  let from = i;
  while (from > 0 && words[from - 1].sentence === s) from--;
  let to = i;
  while (to < words.length - 1 && words[to + 1].sentence === s) to++;
  return { from, to: to + 1 };
}

export type RsvpAction = "toggle" | "back" | "forward" | "sentenceBack" | "faster" | "slower" | "close" | null;

/**
 * The key's action. Arrows follow the text: in Hebrew → is back and ← is
 * forward, as a page turns. Space plays or pauses; Shift+arrow or Backspace
 * goes back a sentence; ↑ / ↓ change the speed; Escape closes.
 */
export function keyAction(key: string, opts: { rtl: boolean; shift?: boolean }): RsvpAction {
  if (key === " " || key === "Spacebar" || key === "k") return "toggle";
  if (key === "Escape") return "close";
  if (key === "Backspace") return "sentenceBack";
  if (key === "ArrowUp") return "faster";
  if (key === "ArrowDown") return "slower";
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const towardStart = (key === "ArrowLeft") !== opts.rtl;
    if (towardStart) return opts.shift ? "sentenceBack" : "back";
    return "forward";
  }
  return null;
}

/** Minutes left at `wpm` from word `i` (for the progress line). */
export function minutesLeft(words: readonly RsvpWord[], i: number, wpm: number): number {
  let ms = 0;
  for (let k = Math.max(0, i); k < words.length; k++) ms += wordDuration(words[k], wpm);
  return ms / 60_000;
}

/** The research the "experimental" label links to. */
export const RSVP_RESEARCH = "https://www.psychologicalscience.org/news/releases/speed-reading-apps-may-impair-reading-comprehension-by-limiting-ability-to-backtrack.html";

/**
 * Each word's paragraph direction (audit r4 A1.2): the majority of the paragraph's words. The keys and the
 * arrow buttons follow it, so a Latin word inside a Hebrew paragraph does not flip ← and → under the reader.
 */
export function paragraphDirections(words: readonly RsvpWord[]): boolean[] {
  const out: boolean[] = new Array(words.length);
  let start = 0;
  for (let k = 0; k < words.length; k++) {
    if (!words[k].paragraphEnd && k < words.length - 1) continue;
    const para = words.slice(start, k + 1);
    const rtl = para.filter((w) => w.rtl).length * 2 >= para.length && para.some((w) => w.rtl);
    out.fill(rtl, start, k + 1);
    start = k + 1;
  }
  return out;
}

