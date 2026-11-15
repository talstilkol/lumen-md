/**
 * Quote alignment for the cite-or-delete gate (R12.9).
 *
 * A quote is shown as a quote only when it is found in its source at exact
 * offsets. "Found" is containment after one fixed normalisation, the one a
 * Hebrew reader would not notice: niqqud and cantillation out, final
 * letters folded, case folded, every kind of quotation mark and apostrophe
 * mapped to one form, Markdown emphasis marks ignored, and runs of white
 * space read as one space. Nothing else is forgiven: a dropped word, a
 * changed number or a missing "not" is not found.
 *
 * The result is the span of the *original* source text (start, end) and
 * that exact slice, so what the user sees in quotation marks is always the
 * source's own characters, never the model's.
 *
 * Clean reimplementation; design reference only: israelconnect's
 * quote_align (AGPL), no code copied.
 */
import { normalizeWithMap } from "../../text/hebrew";

export interface Alignment {
  /** Offsets in the original source text, end exclusive. */
  start: number;
  end: number;
  /** `source.slice(start, end)`: the source's own characters. */
  text: string;
}

/** Quote marks the normaliser leaves alone: mapped here so „x“ and "x" align. */
const EXTRA_QUOTES: Record<string, string> = { "„": '"', "«": '"', "»": '"', "‚": "'", "`": "" };
const EMPHASIS = /[*_~]/;

/**
 * The comparison form of a text and, for each of its characters, the offset
 * in the original it came from (plus one entry for the end).
 */
export function alignForm(text: string): { text: string; map: number[] } {
  const base = normalizeWithMap(text);
  let out = "";
  const map: number[] = [];
  let space = true; // leading white space is dropped
  for (let i = 0; i < base.text.length; i++) {
    let c = base.text[i];
    if (c in EXTRA_QUOTES) c = EXTRA_QUOTES[c];
    if (!c || EMPHASIS.test(c)) continue;
    if (/\s/.test(c)) {
      if (space) continue;
      space = true;
      out += " ";
      map.push(base.map[i]);
      continue;
    }
    space = false;
    out += c;
    map.push(base.map[i]);
  }
  if (out.endsWith(" ")) {
    out = out.slice(0, -1);
    map.pop();
  }
  map.push(base.map[base.text.length] ?? text.length);
  return { text: out, map };
}

/** The end offset in the original of a match ending at normalised position `endN` (exclusive). */
function originalEnd(source: string, map: number[], endN: number): number {
  // map[endN - 1] is where the last matched character starts; step over it
  // (a surrogate pair, or a letter with the niqqud that followed it).
  let end = map[endN - 1] + 1;
  if (end < source.length && /[\uDC00-\uDFFF]/.test(source[end])) end++;
  while (end < source.length && /\p{M}/u.test(source[end])) end++;
  return end;
}

/** Shortest quote that may stand as evidence: three words, or twelve letters in one or two words. */
export function longEnough(quote: string): boolean {
  const n = alignForm(quote).text;
  const words = n.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length >= 3 || n.replace(/[^\p{L}\p{N}]/gu, "").length >= 12;
}

/**
 * Where `quote` sits in `source`, at exact offsets, or null. The first
 * occurrence wins; `from` (an original offset) skips earlier ones.
 */
export function alignQuote(quote: string, source: string, from = 0): Alignment | null {
  const q = alignForm(quote).text.replace(/^["']+|["']+$/g, "").trim();
  if (!q || !longEnough(q)) return null;
  const s = alignForm(source);
  let startN = 0;
  while (startN < s.map.length - 1 && s.map[startN] < from) startN++;
  const at = s.text.indexOf(q, startN);
  if (at < 0) return null;
  // Whole words only: "ate" is not found in "late".
  const before = s.text[at - 1];
  const after = s.text[at + q.length];
  const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  if ((wordChar(before) && wordChar(q[0])) || (wordChar(after) && wordChar(q[q.length - 1]))) {
    return alignQuote(quote, source, s.map[at] + 1);
  }
  const start = s.map[at];
  const end = originalEnd(source, s.map, at + q.length);
  return { start, end, text: source.slice(start, end) };
}

/** Is the shown text really the source's slice at those offsets? The last check before a quote is displayed. */
export function alignmentHolds(a: Alignment, source: string): boolean {
  return a.start >= 0 && a.end <= source.length && a.start < a.end && source.slice(a.start, a.end) === a.text;
}
