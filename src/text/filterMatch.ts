/**
 * One normalisation for every filter box (plan W13.E3, Obsidian 1.15.1's
 * accent-insensitive filters, done for Hebrew first).
 *
 * `normalizeForFilter` is `normalizeForMatch` (./hebrew: niqqud and
 * cantillation U+0591–U+05C7 out, final letters folded, Arabic tashkeel and
 * hamza seats folded, lower case) plus what a *filter* may forget and a
 * link key may not:
 *   - compatibility forms (NFKD): Hebrew presentation forms (שּׁ U+FB2C,
 *     the wide letters), ligatures (ﬁ), full-width letters, superscripts;
 *   - Latin, Greek and Cyrillic diacritics (café → cafe, Ñandú → nandu,
 *     Ελλάδα → ελλαδα, ё → е), keeping the Cyrillic short i (й ≠ и);
 *   - the letters that carry no combining mark: Ł → l, ß → ss, Æ → ae,
 *     Ø → o, Đ/Ð → d, Œ → oe, Þ → th, ı → i, Ħ → h, ς → σ;
 *   - geresh and gershayim (׳ ״ and their ASCII stand-ins ' "), so צהל,
 *     צה"ל and צה״ל are one word, and the maqaf (־) as a plain hyphen;
 *   - invisible format characters (bidi marks and embeddings, ZWJ/ZWNJ,
 *     soft hyphen, BOM) that RTL copy-paste leaves behind.
 *
 * Link keys (lib/slug `noteKey`) and the BM25 index keep the stricter
 * `normalizeForMatch`, so `[[résumé]]` still opens résumé.md and not
 * resume.md. Filters only narrow a list the person is looking at; there a
 * false hit costs nothing and a miss hides the item.
 *
 * `filterMatch` returns the match as a range in the ORIGINAL string (with
 * its niqqud and accents), so a filter can highlight what the person sees.
 *
 * Dependency-light: the structure test
 * (filterNormalize.test.ts) fails on a filter box that compares with a raw
 * `toLowerCase().includes()` instead of this module.
 */

import { normalizeForMatch } from "./hebrew";

/** Letters with no canonical decomposition, folded the way a reader types them. */
const LETTERS: Record<string, string> = {
  "ł": "l", "ß": "ss", "ẞ": "ss", "æ": "ae", "ø": "o", "đ": "d", "ð": "d",
  "œ": "oe", "þ": "th", "ı": "i", "ħ": "h", "ŧ": "t", "ŀ": "l", "ĸ": "k",
  // Final sigma: lower-casing a whole word gives ς, one letter at a time σ.
  "ς": "σ",
};
const LETTER_RE = /[łßẞæøđðœþıħŧŀĸς]/g;

/** Combining diacritics (Latin, Greek, Cyrillic): U+0300–U+036F. */
const DIACRITIC = /[̀-ͯ]/;
/** Format characters a filter never wants to match on. */
const INVISIBLE = /[­؜​-‏‪-‮⁠-⁩﻿]/g;

/** Strip Latin/Greek/Cyrillic diacritics from NFKD text, keeping Cyrillic й/Й (и + U+0306). */
function stripDiacritics(nfkd: string): string {
  if (!/[̀-ͯ]/.test(nfkd)) return nfkd;
  let out = "";
  let prev = "";
  for (const ch of nfkd) {
    if (DIACRITIC.test(ch)) {
      if (ch === "̆" && (prev === "и" || prev === "И")) out += ch;
    } else out += ch;
    prev = ch;
  }
  return out;
}

/**
 * The comparison form for a filter box. Pure; the same input always folds
 * the same way, so callers may fold their list once and the query per key.
 */
export function normalizeForFilter(text: string): string {
  if (!text) return "";
  const nfkd = text.normalize("NFKD").replace(INVISIBLE, "");
  // normalizeForMatch re-composes (NFC) after dropping the Hebrew marks; strip the
  // Latin diacritics first, on the decomposed text, so é is e + U+0301 when we look.
  const folded = normalizeForMatch(stripDiacritics(nfkd));
  return folded
    .replace(LETTER_RE, (c) => LETTERS[c])
    .replace(/['"]/g, "");
}

/** `normalizeForFilter` of one character, memoised (a text repeats few distinct characters). */
const charCache = new Map<string, string>();
function foldChar(ch: string): string {
  let f = charCache.get(ch);
  if (f === undefined) {
    f = normalizeForFilter(ch);
    if (charCache.size < 8192) charCache.set(ch, f);
  }
  return f;
}

/**
 * `normalizeForFilter(text)` plus, for every character of the result, the
 * offset in `text` it came from (one past the end at index `length`), so a
 * hit in the folded text maps back to what is on screen.
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    for (const c of foldChar(ch)) {
      folded += c;
      map.push(i);
    }
    i += ch.length;
  }
  map.push(text.length);
  return { folded, map };
}

/** Extend `end` over the combining marks that follow it, so a highlight keeps the niqqud of its last letter. */
function swallowMarks(text: string, end: number): number {
  while (end < text.length && /\p{M}/u.test(text[end])) end++;
  return end;
}

export interface FilterRange {
  start: number;
  end: number;
}

/**
 * Where `query` occurs in `text`, ignoring niqqud, accents, case, final
 * letters and geresh, as a range of `text` itself; null when it does not.
 * An empty query matches nothing (callers show the whole list for it).
 */
export function filterMatch(text: string, query: string): FilterRange | null {
  const q = normalizeForFilter(query.trim());
  if (!q || !text) return null;
  const { folded, map } = foldWithMap(text);
  const at = folded.indexOf(q);
  if (at < 0) return null;
  return { start: map[at], end: swallowMarks(text, map[at + q.length]) };
}

/** Does `text` contain `query` (filter semantics)? An empty query matches everything. */
export function matchesFilter(text: string | null | undefined, query: string): boolean {
  const q = normalizeForFilter(query.trim());
  if (!q) return true;
  return !!text && normalizeForFilter(text).includes(q);
}

/** Does any of `texts` match? For an item searched by name, description, tags… */
export function matchesAnyFilter(texts: ReadonlyArray<string | null | undefined>, query: string): boolean {
  const q = normalizeForFilter(query.trim());
  if (!q) return true;
  return texts.some((t) => !!t && normalizeForFilter(t).includes(q));
}

/**
 * A filter over a list: the query is folded once, every item's text once
 * per call. `get` returns the strings an item is searched by.
 */
export function filterList<T>(items: readonly T[], query: string, get: (item: T) => ReadonlyArray<string | null | undefined> | string): T[] {
  const q = normalizeForFilter(query.trim());
  if (!q) return [...items];
  return items.filter((item) => {
    const v = get(item);
    const texts = typeof v === "string" ? [v] : v;
    return texts.some((t) => !!t && normalizeForFilter(t).includes(q));
  });
}

/** Split `text` into plain and highlighted parts around the first match of `query`, for rendering. */
export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const r = filterMatch(text, query);
  if (!r) return [{ text, hit: false }];
  const parts: Array<{ text: string; hit: boolean }> = [];
  if (r.start > 0) parts.push({ text: text.slice(0, r.start), hit: false });
  parts.push({ text: text.slice(r.start, r.end), hit: true });
  if (r.end < text.length) parts.push({ text: text.slice(r.end), hit: false });
  return parts;
}
