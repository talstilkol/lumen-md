/**
 * Heading-aware chunks with a context prefix (W11.I14): contextual retrieval
 * without an LLM (Anthropic, "Contextual Retrieval", 2024: a chunk is
 * indexed with the context it lost when it was cut out; here the context
 * is the note's own structure instead of a model-written blurb).
 *
 *  - The note is cut at headings (not inside fenced code, where "# x" is a
 *    comment), into pieces of MIN–MAX tokens: a short section is joined with
 *    the next one under the same parent, a long one is cut at paragraph
 *    breaks with OVERLAP tokens carried into the next piece.
 *  - Each chunk gets a prefix: the note's title, the heading path down to
 *    the chunk, and the note's tags. `contextualText` (prefix + text) is
 *    what gets embedded, so "Budget" under "# Trip to Eilat › ## Costs"
 *    is found by a question about the trip.
 *  - Offsets (`start`, `end`) are the chunk's own text in the note, without
 *    the overlap, so a hit still points at the right place.
 *
 * Token counts use estimateTokens' weights (≈ 4 Latin characters, ≈ 2
 * Hebrew characters per token), summed once per note.
 */

import { noteParagraphs } from "./paragraphAnchors";

export const CHUNK_MIN_TOKENS = 200;
export const CHUNK_MAX_TOKENS = 400;
export const CHUNK_OVERLAP_TOKENS = 50;

export interface HeadingChunk {
  start: number;
  end: number;
  /** The chunk's text in the note (offsets above), without the overlap. */
  text: string;
  /** The end of the previous piece of the same section, when it was cut (for the embedding only). */
  overlap: string;
  /** Headings from the top of the note down to this chunk. */
  headings: string[];
  /** "Title › Heading › Sub · #tag #tag" */
  prefix: string;
  /** W12.A1: the anchors (`^id` or virtual `p-…`, ./paragraphAnchors) of the paragraphs that start in this chunk. */
  paragraphs: string[];
}

interface Section {
  start: number;
  end: number;
  depth: number;
  headings: string[];
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/;

/** Tags from YAML frontmatter (`tags: [a, b]`, `tags: a, b` or a `- a` list). */
export function frontmatterTags(text: string): string[] {
  const fm = FRONTMATTER.exec(text)?.[1];
  if (!fm) return [];
  const inline = /^tags:[ \t]*\[?([^\n\]]*)\]?[ \t]*$/m.exec(fm);
  if (inline && inline[1]!.trim()) return inline[1]!.split(",").map((t) => t.trim().replace(/^["'#]|["']$/g, "")).filter(Boolean);
  const block = /^tags:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m.exec(fm);
  return block ? block[1]!.split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/^["'#]|["']$/g, "")).filter(Boolean) : [];
}

/** The sections of a note: cut at ATX headings outside fenced code; the text before the first heading is a section too. */
function sections(text: string): Section[] {
  const out: Section[] = [];
  const stack: Array<{ depth: number; title: string }> = [];
  let fence: string | null = null;
  let pos = 0;
  let cur: Section = { start: 0, end: 0, depth: 0, headings: [] };
  const fmEnd = FRONTMATTER.exec(text)?.[0].length ?? 0;
  if (fmEnd) {
    pos = fmEnd;
    cur.start = fmEnd;
  }
  const body = text.slice(pos);
  for (const line of body.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (f && (!fence || f[0] === fence[0])) fence = fence ? null : f;
    const h = !fence && !f ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h) {
      cur.end = pos;
      if (text.slice(cur.start, cur.end).trim()) out.push(cur);
      const depth = h[1]!.length;
      while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
      stack.push({ depth, title: h[2]! });
      cur = { start: pos, end: pos, depth, headings: stack.map((s) => s.title) };
    }
    pos += line.length + 1;
  }
  cur.end = Math.min(pos, text.length);
  if (text.slice(cur.start, cur.end).trim()) out.push(cur);
  return out;
}

/**
 * Cumulative token cost per UTF-16 index, with estimateTokens' weights
 * (Latin 1/4, CJK 1, other scripts 1/2 per character), so the tokens of any
 * slice are one subtraction: cutting stays linear on long notes.
 */
function costs(text: string): Float64Array {
  const c = new Float64Array(text.length + 1);
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!;
    const w = code < 0x250 ? 0.25 : (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff) || code >= 0x20000 ? 1 : 0.5;
    c[i + 1] = c[i]! + w;
    if (code > 0xffff) {
      c[i + 2] = c[i + 1]!; // the low surrogate adds nothing
      i++;
    }
  }
  return c;
}

/** Cut [start, end) at paragraph (else line, sentence, word, else hard) breaks into pieces of at most `max` tokens. */
function cut(text: string, cost: Float64Array, start: number, end: number, max: number): Array<[number, number]> {
  const tok = (a: number, b: number) => Math.ceil(cost[b]! - cost[a]!);
  const pieces: Array<[number, number]> = [];
  let s = start;
  while (s < end) {
    if (tok(s, end) <= max) {
      pieces.push([s, end]);
      break;
    }
    // The furthest point that keeps the piece under max, then the last break before it.
    let limit = s + 1;
    let lo = s + 1;
    let hi = end;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tok(s, mid) <= max) {
        limit = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    // A break counts only past half the maximum, so no piece is a stub (a heading line alone).
    let best = -1;
    for (const sep of ["\n\n", "\n", ". ", " "]) {
      const i = text.lastIndexOf(sep, limit - sep.length);
      if (i > s && tok(s, i + sep.length) >= max / 2) {
        best = i + sep.length;
        break;
      }
    }
    if (best <= s) best = limit; // one unbroken run: a hard cut
    pieces.push([s, best]);
    s = best;
  }
  return pieces;
}

/** The last `tokens` tokens of [a, b), starting at a word. */
function tail(text: string, cost: Float64Array, a: number, b: number, tokens: number): string {
  let i = b;
  while (i > a && cost[b]! - cost[i]! < tokens) i--;
  const sp = text.indexOf(" ", i);
  return text.slice(sp > i && sp < b ? sp + 1 : i, b);
}

export function headingChunks(text: string, opts: { title?: string; min?: number; max?: number; overlap?: number } = {}): HeadingChunk[] {
  const min = opts.min ?? CHUNK_MIN_TOKENS;
  const max = opts.max ?? CHUNK_MAX_TOKENS;
  const overlapTokens = opts.overlap ?? CHUNK_OVERLAP_TOKENS;
  const tags = frontmatterTags(text);
  const secs = sections(text);
  const cost = costs(text);
  const tokens = (a: number, b: number) => Math.ceil(cost[b]! - cost[a]!);
  const h1 = secs.find((s) => s.depth === 1)?.headings[0];
  const title = opts.title ?? h1 ?? "";
  const prefixOf = (headings: string[]) => {
    const path = [title, ...headings.filter((h, i) => !(i === 0 && h === title))].filter(Boolean).join(" › ");
    return [path, tags.length ? tags.map((t) => `#${t}`).join(" ") : ""].filter(Boolean).join(" · ");
  };

  // Join short sections with the next one while they share a parent and stay under max.
  const groups: Section[] = [];
  for (const s of secs) {
    const last = groups[groups.length - 1];
    const lastTokens = last ? tokens(last.start, last.end) : Infinity;
    const sameParent = last && last.headings.slice(0, -1).join("\u0000") === s.headings.slice(0, -1).join("\u0000");
    const nested = last && s.headings.length > last.headings.length && s.headings.slice(0, last.headings.length).join("\u0000") === last.headings.join("\u0000");
    if (last && lastTokens < min && (sameParent || nested) && lastTokens + tokens(s.start, s.end) <= max) {
      last.end = s.end;
      // The group keeps the shallower path (the parent both share).
      if (!nested) last.headings = last.headings.slice(0, -1).length ? last.headings.slice(0, -1) : last.headings;
    } else groups.push({ ...s, headings: [...s.headings] });
  }

  const paras = noteParagraphs(text);
  const out: HeadingChunk[] = [];
  for (const g of groups) {
    const pieces = cut(text, cost, g.start, g.end, max);
    pieces.forEach(([s, e], i) => {
      const body = text.slice(s, e);
      if (!body.trim()) return;
      const prev = i > 0 ? pieces[i - 1]! : null;
      out.push({ start: s, end: e, text: body, overlap: prev ? tail(text, cost, prev[0], prev[1], overlapTokens) : "", headings: g.headings, prefix: prefixOf(g.headings), paragraphs: paras.filter((p) => p.start >= s && p.start < e).map((p) => p.anchor) });
    });
  }
  return out;
}

/** What is embedded (and what a chunk-level BM25 indexes): the prefix, the overlap, then the chunk. */
export function contextualText(c: HeadingChunk): string {
  return [c.prefix, c.overlap ? `… ${c.overlap}` : "", c.text].filter(Boolean).join("\n");
}
