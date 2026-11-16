/**
 * Bidi-correct graph labels (plan W13.G2). A canvas has no page around it:
 * `fillText` runs the Unicode bidi algorithm on one string with the
 * context's `direction` as the paragraph direction, so a label needs three
 * things the page would otherwise give it:
 *
 * 1. its own direction, from its first strong character (UAX #9 P2–P3, as
 *    `dir="auto"` does) — not "has any Hebrew letter": "Python מדריך" is a
 *    left-to-right label, "מדריך Python" a right-to-left one;
 * 2. FSI … PDI around each run in the other direction, so the neutrals at its
 *    edges stay with it: "C++" inside a Hebrew label is not drawn "++C",
 *    "R&D" not "D&R", "(v2)" keeps its brackets;
 * 3. shortening by grapheme (Intl.Segmenter), never by UTF-16 code unit: a
 *    letter keeps its niqqud and cantillation, an emoji its joiners and
 *    skin tone, a flag both halves; the ellipsis goes after the isolates, at
 *    the label's own end.
 *
 * Pure (no DOM); the canvas only sets `ctx.direction` and draws `text`.
 */

export const FSI = "⁨";
export const LRI = "⁦";
export const RLI = "⁧";
export const PDI = "⁩";
export const ELLIPSIS = "…";

export type LabelDir = "ltr" | "rtl";

/** Letters of the right-to-left scripts (Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan, Mandaic, Adlam, …). */
const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Mende_Kikakui}\p{Script=Imperial_Aramaic}\p{Script=Phoenician}]/u;
const LETTER = /\p{L}/u;
/** Explicit marks: RLM / ALM count as strong R, LRM as strong L (UAX #9 BD1). */
const RLM = /[‏؜]/;
const LRM = /‎/;
const ISOLATE_OPEN = /[⁦⁧⁨]/;

/** "R", "L" or null (weak or neutral) for one code point. */
export function strongOf(ch: string): "R" | "L" | null {
  const c = ch.charCodeAt(0);
  // Fast paths: ASCII, and the Hebrew letters (the marks before them are not strong).
  if (c < 0x80) return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ? "L" : null;
  if (c >= 0x05d0 && c <= 0x05ea) return "R";
  let s = strongCache.get(ch);
  if (s === undefined) {
    s = RLM.test(ch) ? "R" : LRM.test(ch) ? "L" : !LETTER.test(ch) ? null : RTL_LETTER.test(ch) ? "R" : "L";
    if (strongCache.size < 4096) strongCache.set(ch, s);
  }
  return s;
}
const strongCache = new Map<string, "R" | "L" | null>();

/**
 * The label's direction: its first strong character outside an isolate.
 * With none, a label with digits ("+972-3-555-1234", "2024–2025") is
 * left to right — numbers read that way in Hebrew too — and any other one
 * ("—", "?!") takes `fallback`, the UI's direction.
 */
export function labelDirection(text: string, fallback: LabelDir = "ltr"): LabelDir {
  let depth = 0;
  for (const ch of text) {
    if (ISOLATE_OPEN.test(ch)) depth++;
    else if (ch === PDI) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const s = strongOf(ch);
      if (s) return s === "R" ? "rtl" : "ltr";
    }
  }
  return /\p{Nd}/u.test(text) ? "ltr" : fallback;
}

const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{", "»": "«", "›": "‹", "”": "“" };
/** Neutrals that belong to the word before them ("C++", "C#", "50%", "3°", "it's"). */
const STICKY = /[\p{M}+#*%°'’"″′_\-/&.:@~^\u05F3\u05F4\u05BE]/u;
const SENTENCE = /[\s,;!?،؛؟]/u;
const OPENERS = new Set(Object.values(CLOSERS));
const DIGIT = /\p{Nd}/u;
const DIGIT_OR_MARK = /[\p{Nd}\p{M}]/u;
const GERESH = /[\u05F3\u05F4]/;
/** Anything that can join code points into one grapheme: marks, joiners, variation selectors, surrogates, CR LF. */
const CLUSTERING = /[\p{M}\u200C\u200D\uFE00-\uFE0F\uD800-\uDFFF\r\u1100-\u11FF]/u;

/**
 * Wrap every run in the direction opposite to `dir` in FSI … PDI. A run
 * starts at an opposite strong letter and takes everything up to the last
 * opposite letter, digit or mark before the next letter in `dir`, plus the
 * neutrals that stick to its end (`C++`, `50%`, a closing bracket whose
 * opening is inside). A label in one direction comes back unchanged.
 */
export function isolateRuns(text: string, dir: LabelDir): string {
  const cps = Array.from(text);
  const base = dir === "rtl" ? "R" : "L";
  const other = base === "R" ? "L" : "R";
  const cls = cps.map(strongOf);
  if (!cls.includes(other)) return text;
  const out: string[] = [];
  let i = 0;
  let depth = 0;
  while (i < cps.length) {
    const c = cps[i];
    if (ISOLATE_OPEN.test(c)) depth++;
    else if (c === PDI) depth = Math.max(0, depth - 1);
    if (depth > 0 || cls[i] !== other) {
      out.push(c);
      i++;
      continue;
    }
    // The run: up to the next letter in the label's own direction.
    let j = i + 1;
    let last = i;
    while (j < cps.length && cls[j] !== base && !ISOLATE_OPEN.test(cps[j])) {
      if (cls[j] === other || DIGIT_OR_MARK.test(cps[j])) last = j;
      j++;
    }
    // Neutrals that stick to the run's end.
    const opened: string[] = [];
    for (let k = i; k <= last; k++) if (OPENERS.has(cps[k])) opened.push(cps[k]);
    let end = last;
    for (let k = last + 1; k < j; k++) {
      const ch = cps[k];
      if (SENTENCE.test(ch)) break;
      if (CLOSERS[ch]) {
        const at = opened.lastIndexOf(CLOSERS[ch]);
        if (at < 0) break;
        opened.splice(at, 1);
        end = k;
        continue;
      }
      if (!STICKY.test(ch)) break;
      // A joiner between the run and a word in the label's direction ("ו-F#") belongs to neither: stop.
      let next = k + 1;
      while (next < cps.length && STICKY.test(cps[next])) next++;
      if (next < cps.length && (cls[next] === base || DIGIT.test(cps[next])) && !GERESH.test(ch)) break;
      // A trailing "." or ":" ends the sentence, not the word, unless more of the run follows.
      if (/[.:]/.test(ch) && !(k + 1 < j && !SENTENCE.test(cps[k + 1]))) break;
      end = k;
    }
    out.push(FSI, ...cps.slice(i, end + 1), PDI);
    i = end + 1;
  }
  return out.join("");
}

let segmenter: Intl.Segmenter | null | undefined;

/** User-perceived characters (extended grapheme clusters): Intl.Segmenter, else base + marks + joiners. */
export function graphemes(text: string): string[] {
  // Most labels have nothing that clusters: one code point is one grapheme.
  if (!CLUSTERING.test(text)) return Array.from(text);
  if (segmenter === undefined) segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return text.match(/(?:\p{RI}\p{RI})|(?:\P{M}(?:\p{M}|️|‍\P{M})*)|\p{M}+/gsu) ?? [];
}

export interface PreparedLabel {
  /** What to draw: isolated, shortened, with the ellipsis at its end. */
  text: string;
  dir: LabelDir;
  truncated: boolean;
}

export interface LabelOptions {
  /** Longest label, in graphemes (the ellipsis included). */
  maxGraphemes?: number;
  /** Longest label, in pixels, with `measure` (the canvas's measureText). */
  maxWidth?: number;
  measure?: (s: string) => number;
  /** The UI's direction, for a label with no strong character ("2024", "—"). */
  fallback?: LabelDir;
}

/** A label ready for `ctx.direction = dir; ctx.fillText(text, …)`. */
export function prepareLabel(raw: string, opts: LabelOptions = {}): PreparedLabel {
  const max = Math.max(2, opts.maxGraphemes ?? 40);
  const text = raw.replace(/[\r\n\t]+/g, " ").trim();
  const dir = labelDirection(text, opts.fallback ?? "ltr");
  const g = graphemes(text);
  let keep = g.length > max ? max - 1 : g.length;
  const build = (n: number) => {
    const cut = n < g.length;
    const body = g.slice(0, n).join("").replace(/[\s‍‌]+$/u, "");
    return isolateRuns(body, dir) + (cut ? ELLIPSIS : "");
  };
  let out = build(keep);
  if (opts.maxWidth !== undefined && opts.measure && opts.measure(out) > opts.maxWidth) {
    // The longest prefix that fits, by halving.
    let lo = 0;
    let hi = keep;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (opts.measure(build(mid)) <= opts.maxWidth) lo = mid;
      else hi = mid - 1;
    }
    keep = Math.max(1, lo);
    out = build(keep);
  }
  return { text: out, dir, truncated: keep < g.length };
}

/**
 * Broken clusters: graphemes of the drawn label (isolates and the ellipsis
 * left out) that are not the source's grapheme at the same place — a letter
 * that lost part of its niqqud, a mark on its own, half an emoji. 0 is the rule.
 */
export function orphanMarks(source: string, shown: string): number {
  const src = graphemes(source.replace(/[\r\n\t]+/g, " ").trim());
  const out = graphemes(shown.replace(/[\u2066-\u2069]/g, "").replace(/…$/, ""));
  let broken = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== src[i]) broken++;
  return broken;
}
