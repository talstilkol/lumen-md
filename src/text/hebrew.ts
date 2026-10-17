/**
 * Hebrew text core (MASTER_PLAN v3, T26).
 *
 * Small, dependency-free helpers every Hebrew-aware feature shares:
 * matching that ignores niqqud and final-letter forms, the prefix
 * letters (ו, ה, ב, ל, מ, ש, כ and their combinations) that glue onto a
 * word, and word counting that does not break a pointed word apart.
 */

/** Niqqud, cantillation and the other Hebrew combining marks. */
const HEBREW_MARKS = /[֑-ׇֽֿׁׂׅׄ]/g;
const FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const HEBREW_LETTER = /[א-ת]/;

export function hasHebrew(text: string): boolean {
  return HEBREW_LETTER.test(text);
}

/** Remove niqqud and cantillation (keeps the letters). */
export function stripNiqqud(text: string): string {
  return text.normalize("NFD").replace(HEBREW_MARKS, "").normalize("NFC");
}

/**
 * Comparison form: NFC, lower-case, niqqud removed, final letters folded
 * into their regular form, Hebrew punctuation (geresh, gershayim, maqaf)
 * mapped to ASCII. Two spellings a reader sees as the same word compare
 * equal.
 */
export function normalizeForMatch(text: string): string {
  return stripNiqqud(text)
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[׳’‘]/g, "'")
    .replace(/[״“”]/g, '"')
    .replace(/־/g, "-");
}

/** The letters that attach to the front of a Hebrew word (מש״ה וכל״ב). */
const PREFIX_LETTERS = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ"]);

/**
 * The word without its prefix letters, one letter at a time, at most
 * three, keeping at least three letters: `"והבית"` → `["והבית", "הבית",
 * "בית"]`. Longest form first, so a search tries the exact word before the
 * bare one. Used as extra search forms, never to rewrite the text.
 */
export function prefixVariants(word: string): string[] {
  const out = [word];
  if (!hasHebrew(word)) return out;
  let rest = [...word];
  for (let i = 0; i < 3 && rest.length > 3 && PREFIX_LETTERS.has(rest[0]); i++) {
    rest = rest.slice(1);
    out.push(rest.join(""));
  }
  return out;
}

/**
 * Words of a text: letters (any script) with their combining marks,
 * digits, and in-word apostrophes / gershayim / hyphens. A pointed Hebrew
 * word is one word, `צה״ל` is one word.
 */
export function words(text: string): string[] {
  return text.match(/[\p{L}\p{M}\p{N}]+(?:['’׳״"\-־][\p{L}\p{M}\p{N}]+)*[׳]?/gu) ?? [];
}

export function countWords(text: string): number {
  return words(text).length;
}

/**
 * `normalizeForMatch`, plus where every character of the result came
 * from in the original, so a match found in the normalized text can be
 * highlighted in the text the user sees.
 */
export function normalizeWithMap(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const folded = normalizeForMatch(ch);
    for (const c of folded) {
      out += c;
      map.push(i);
    }
    i += ch.length;
  }
  map.push(text.length);
  return { text: out, map };
}

/**
 * Find `needle` in `haystack` the way a Hebrew reader means it: niqqud-,
 * case- and final-letter-insensitive; when the needle is one Hebrew word
 * with prefix letters, its bare forms count too (searching "והבית" finds
 * "בית"). Returns the match as offsets in the *original* haystack, or null.
 */
export function hebrewFind(haystack: string, needle: string): { start: number; end: number } | null {
  const { text: h, map } = normalizeWithMap(haystack);
  const n = normalizeForMatch(needle.trim());
  if (!n) return null;
  const candidates = /\s/.test(n) ? [n] : prefixVariants(n);
  for (const c of candidates) {
    const at = h.indexOf(c);
    if (at >= 0) return { start: map[at], end: map[at + c.length] };
  }
  return null;
}
