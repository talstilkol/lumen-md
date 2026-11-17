/**
 * The prose of a Markdown note, at its own offsets (W13.W11, W13.W15).
 *
 * The rule-based writing checks read only what a reader reads, like the
 * word counter (book/wordCount.ts, W5.8): frontmatter, code, math,
 * comments, link targets, embeds, footnote markers, block ids and HTML tags
 * are not prose. Unlike `proseOf`, every character that is not prose is
 * replaced by a space (newlines kept), so an offset into the mask is the
 * same offset into the note — a finding points at the note's own text.
 *
 * `proseTokens` then cuts the mask into words with their offsets, the
 * sentence and heading they belong to, and the Hebrew comparison form.
 */
import { normalizeForMatch } from "../../text/hebrew";

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/** Replace every match of `re` (global) by spaces, keeping the groups listed in `keep` as text. */
function maskRe(s: string, re: RegExp, keep?: (m: RegExpExecArray) => Array<[number, number]>): string {
  let out = "";
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    let seg = blank(m[0]);
    for (const [a, b] of keep?.(m) ?? []) seg = seg.slice(0, a - start) + s.slice(a, b) + seg.slice(b - start);
    out += s.slice(last, start) + seg;
    last = end;
  }
  return out + s.slice(last);
}

/** The offsets of group `g` of a match made with the `d` flag. */
const group = (m: RegExpExecArray, g: number): Array<[number, number]> => {
  const r = (m as RegExpExecArray & { indices?: Array<[number, number] | undefined> }).indices?.[g];
  return r ? [r] : [];
};

/** The note with everything that is not prose blanked out; same length, same newlines. */
export function proseMask(markdown: string): string {
  let s = markdown.replace(/^﻿/, " ");
  s = maskRe(s, /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/g);
  s = maskRe(s, /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[`~]*[ \t]*$|(?![\s\S]))/gm);
  s = maskRe(s, /^\$\$[\s\S]*?^\$\$[ \t]*$/gm);
  s = maskRe(s, /%%[\s\S]*?(?:%%|$)/g);
  s = maskRe(s, /<!--[\s\S]*?(?:-->|$)/g);
  s = maskRe(s, /`+[^`\n]*`+/g);
  s = maskRe(s, /\$[^$\n]+\$/g);
  s = maskRe(s, /!\[\[[^\]\n]*\]\]/g);
  s = maskRe(s, /!\[[^\]\n]*\]\([^)\n]*\)/g);
  s = maskRe(s, /\[\[(?:[^\]|\n]*)\|([^\]\n]*)\]\]/dg, (m) => group(m, 1));
  s = maskRe(s, /\[\[([^\]#|\n]*)(?:#[^\]\n]*)?\]\]/dg, (m) => group(m, 1));
  s = maskRe(s, /\[([^\]\n]*)\]\([^)\n]*\)/dg, (m) => group(m, 1));
  s = maskRe(s, /<https?:[^>\s]*>|\bhttps?:\/\/\S+/g);
  s = maskRe(s, /\[\^[^\]\n]*\]:?/g);
  s = maskRe(s, /(?<=^|\s)\^[A-Za-z0-9-]+(?=\s|$)/gm);
  s = maskRe(s, /<\/?[A-Za-z][^>\n]*>/g);
  s = maskRe(s, /\[![\w-]+\][+-]?/g);
  return s;
}

export interface ProseToken {
  /** The word as written (niqqud kept). */
  text: string;
  /** Comparison form: niqqud stripped, finals folded, lower case. */
  norm: string;
  from: number;
  to: number;
  /** Index of the sentence it is in (0-based, over the whole note). */
  sentence: number;
  /** In a heading line. */
  heading: boolean;
  /** First word of its sentence (an English capital there says nothing about a name). */
  sentenceStart: boolean;
}

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’׳״"\-־][\p{L}\p{M}\p{N}]+)*/gu;
const SENTENCE_END = /[.!?。！？؟]|\n\s*\n/;

/** Words of the note's prose with their offsets. */
export function proseTokens(markdown: string): ProseToken[] {
  const mask = proseMask(markdown);
  const out: ProseToken[] = [];
  let sentence = 0;
  let last = 0;
  let startNext = true;
  const headingLines: Array<[number, number]> = [];
  for (const m of mask.matchAll(/^ {0,3}#{1,6}[ \t][^\n]*/gm)) headingLines.push([m.index, m.index + m[0].length]);
  let h = 0;
  for (const m of mask.matchAll(WORD)) {
    const from = m.index;
    const gap = mask.slice(last, from);
    if (out.length && SENTENCE_END.test(gap)) {
      sentence++;
      startNext = true;
    }
    while (h < headingLines.length && headingLines[h][1] < from) h++;
    const heading = h < headingLines.length && headingLines[h][0] <= from && from <= headingLines[h][1];
    if (out.length && out[out.length - 1].heading !== heading && out[out.length - 1].sentence === sentence) {
      sentence++;
      startNext = true;
    }
    out.push({ text: m[0], norm: normalizeForMatch(m[0]).replace(/['"]/g, ""), from, to: from + m[0].length, sentence, heading, sentenceStart: startNext });
    startNext = false;
    last = from + m[0].length;
  }
  return out;
}
