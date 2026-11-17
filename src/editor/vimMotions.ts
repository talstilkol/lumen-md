/**
 * Vim motions that read Hebrew right (plan W13.E1), pure, so they are tested
 * without the Vim package.
 *
 * - `h` / `l` are visual in a right-to-left line, like Vim's 'rightleft':
 *   `h` goes to the character on the LEFT of the cursor — in a Hebrew line
 *   that is the next character in reading order — and `l` to the one on the
 *   right. In a left-to-right line they are the usual logical moves.
 * - `w` / `b` / `e` are logical (reading order) in every line.
 * - A letter with its niqqud or cantillation (or any combining mark) is one
 *   cell: the cursor never lands on a mark, `x` never orphans one.
 * - Word characters include every script's letters and digits, `_`, the
 *   combining marks, and geresh / gershayim / an apostrophe between letters
 *   (צה״ל, ג׳ירפה, don't are one word); other symbols are punctuation words.
 */
import { markdownLineDirection } from "../lib/bidiDirection";

export interface Pos {
  line: number;
  ch: number;
}
export interface LineSource {
  lineCount(): number;
  getLine(n: number): string;
}

const MARK = /\p{M}/u;
const WORD = /[\p{L}\p{N}_]/u;
const JOINER = /['’׳״"]/;

/** Does the line read right to left (its first strong character, Markdown syntax aside)? */
export function lineIsRtl(line: string): boolean {
  return markdownLineDirection(line) === "rtl";
}

/** The start of the cluster that holds `ch` (a mark belongs to the letter before it). */
export function clusterStart(line: string, ch: number): number {
  let i = Math.max(0, Math.min(ch, line.length));
  while (i > 0 && i < line.length && MARK.test(line[i])) i--;
  return i;
}

/** The start of the next cluster after the one at `ch` (line.length at the end). */
export function nextCluster(line: string, ch: number): number {
  let i = clusterStart(line, ch) + 1;
  // A surrogate pair is one character.
  if (i < line.length && /[\uDC00-\uDFFF]/.test(line[i])) i++;
  while (i < line.length && MARK.test(line[i])) i++;
  return Math.min(i, line.length);
}

export function prevCluster(line: string, ch: number): number {
  const s = clusterStart(line, ch);
  if (s === 0) return 0;
  let i = s - 1;
  if (i > 0 && /[\uDC00-\uDFFF]/.test(line[i])) i--;
  return clusterStart(line, i);
}

/** The last cluster's start: where normal mode's cursor sits at the line's end (0 on an empty line). */
export function lastCluster(line: string): number {
  return line.length ? clusterStart(line, line.length - 1) : 0;
}

/** Logical step by `n` clusters, clamped to [0, last cluster] as normal mode is. */
function stepLogical(line: string, ch: number, n: number): number {
  let c = clusterStart(line, ch);
  const last = lastCluster(line);
  for (let k = 0; k < Math.abs(n); k++) {
    const next = n > 0 ? nextCluster(line, c) : prevCluster(line, c);
    if (n > 0 && next > last) break;
    c = next;
  }
  return Math.min(c, last);
}

/** `h`: visually left. In an RTL line that is forward in the text. */
export function motionLeft(line: string, ch: number, count = 1): number {
  return stepLogical(line, ch, lineIsRtl(line) ? count : -count);
}

/** `l`: visually right. In an RTL line that is back in the text. */
export function motionRight(line: string, ch: number, count = 1): number {
  return stepLogical(line, ch, lineIsRtl(line) ? -count : count);
}

/* ─── Words (logical) ───────────────────────────────────────────────── */

/** 0 space, 1 word, 2 punctuation — for the cluster at `ch`. */
function cls(line: string, ch: number): 0 | 1 | 2 {
  const c = line[clusterStart(line, ch)];
  if (c === undefined || /\s/.test(c)) return 0;
  if (WORD.test(c)) return 1;
  // Geresh / gershayim / an apostrophe between two letters joins them.
  if (JOINER.test(c)) {
    const before = clusterStart(line, ch) > 0 ? line[clusterStart(line, clusterStart(line, ch) - 1)] : "";
    const after = line[nextCluster(line, ch)] ?? "";
    if (before && WORD.test(before) && (WORD.test(after) || c === "׳")) return 1;
  }
  return 2;
}

/** The position after `p`, across line ends (an empty line is one position); null at the document's end. */
function fwd(doc: LineSource, p: Pos): Pos | null {
  const line = doc.getLine(p.line);
  const n = nextCluster(line, p.ch);
  if (n < line.length) return { line: p.line, ch: n };
  if (p.line + 1 >= doc.lineCount()) return null;
  return { line: p.line + 1, ch: 0 };
}

function back(doc: LineSource, p: Pos): Pos | null {
  if (p.ch > 0) return { line: p.line, ch: prevCluster(doc.getLine(p.line), p.ch) };
  if (p.line === 0) return null;
  return { line: p.line - 1, ch: lastCluster(doc.getLine(p.line - 1)) };
}

const at = (doc: LineSource, p: Pos) => cls(doc.getLine(p.line), p.ch);
const emptyLine = (doc: LineSource, p: Pos) => doc.getLine(p.line).length === 0;

/** `w`: the start of the next word (an empty line counts as one). */
export function wordForward(doc: LineSource, from: Pos, count = 1): Pos {
  let p: Pos = { line: from.line, ch: clusterStart(doc.getLine(from.line), from.ch) };
  for (let k = 0; k < count; k++) {
    const start = at(doc, p);
    let q: Pos | null = p;
    // Off the current word.
    if (start !== 0 && !emptyLine(doc, p)) {
      while (q && q.line === p.line && at(doc, q) === start) q = fwd(doc, q);
    } else q = fwd(doc, q);
    // Over spaces; a line change stops on an empty line.
    while (q && at(doc, q) === 0 && !emptyLine(doc, q)) q = fwd(doc, q);
    if (!q) {
      const last = doc.lineCount() - 1;
      return { line: last, ch: lastCluster(doc.getLine(last)) };
    }
    p = q;
  }
  return p;
}

/** `e`: the end of the word (the next one when already at an end). */
export function wordEnd(doc: LineSource, from: Pos, count = 1): Pos {
  let p: Pos = { line: from.line, ch: clusterStart(doc.getLine(from.line), from.ch) };
  for (let k = 0; k < count; k++) {
    let q = fwd(doc, p);
    while (q && at(doc, q) === 0) q = fwd(doc, q);
    if (!q) return p;
    const c = at(doc, q);
    let n = fwd(doc, q);
    while (n && n.line === q.line && at(doc, n) === c) {
      q = n;
      n = fwd(doc, n);
    }
    p = q;
  }
  return p;
}

/** `b`: the start of this word, or of the previous one. */
export function wordBackward(doc: LineSource, from: Pos, count = 1): Pos {
  let p: Pos = { line: from.line, ch: clusterStart(doc.getLine(from.line), from.ch) };
  for (let k = 0; k < count; k++) {
    let q = back(doc, p);
    while (q && at(doc, q) === 0 && !emptyLine(doc, q)) q = back(doc, q);
    if (!q) return { line: 0, ch: 0 };
    if (emptyLine(doc, q)) {
      p = q;
      continue;
    }
    const c = at(doc, q);
    let b = back(doc, q);
    while (b && b.line === q.line && at(doc, b) === c) {
      q = b;
      b = back(doc, b);
    }
    p = q;
  }
  return p;
}

/** Lines of a string, as the motions read them (tests and the Vim adapter). */
export function linesOf(text: string): LineSource {
  const lines = text.split("\n");
  return { lineCount: () => lines.length, getLine: (n) => lines[n] ?? "" };
}
