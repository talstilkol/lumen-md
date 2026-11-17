/**
 * Paragraph anchors for "Ask the vault" citations (W12.A1).
 *
 * A citation used to resolve to a *line* (T29). A line number moves with
 * every edit above it, and it says nothing about where the cited thought
 * starts and ends. Here a note is cut into paragraphs — the blocks an
 * Obsidian block id (` ^id`, plan 4.8) can sit on — and each one gets an
 * anchor:
 *
 *  - a real `^id` when the paragraph already has one (on its last line, or
 *    on a `^id` line of its own right after it), which survives any edit;
 *  - otherwise a *virtual* anchor, `p-` + an FNV-1a hash of the paragraph's
 *    normalised text, so it stays put while that paragraph is unchanged,
 *    and nothing is written to the note.
 *
 * A real `^id` is written only when the user asks for a lasting link
 * ("Pin link", `pinParagraphAnchor` in ./paragraphPin), through the same
 * edit as "Copy link to block" (editor/blockLink.ts), so the id is
 * Obsidian-compatible.
 *
 * Blocks: blank lines separate paragraphs; a heading is a block of its
 * own; a list item starts a new block; a fenced code block is one block;
 * front matter is not a block.
 */
import { normalizeForMatch } from "../text/hebrew";
import { BLOCK_MARK } from "../renderer/remarkBlockIds";

export interface Paragraph {
  /** 0-based position among the note's paragraphs. */
  index: number;
  /** 1-based first and last line of the paragraph in the note (a trailing `^id` line included). */
  startLine: number;
  endLine: number;
  /** Character offsets of the paragraph's text in the note. */
  start: number;
  end: number;
  /** The paragraph's text, without its ` ^id` marker. */
  text: string;
  /** The Obsidian block id, when the paragraph has one. */
  blockId: string | null;
  /** `^<id>` for a real block id, `p-<hash>` for a virtual anchor. */
  anchor: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}[ \t]+/;
const LIST = /^\s*(?:[-*+]|\d+[.)])\s+/;
const OWN_LINE = /^\s*\^([A-Za-z0-9-]+)\s*$/;

/** FNV-1a, 32 bits, as 8 hex digits: small, stable and good enough to tell paragraphs apart. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const squash = (s: string) => normalizeForMatch(s).replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();

/** The virtual anchor of a paragraph text: unchanged text, unchanged anchor. */
export const virtualAnchor = (text: string) => `p-${fnv1a(squash(text))}`;

/** Every paragraph of a note, in order. */
export function noteParagraphs(content: string): Paragraph[] {
  const lines = content.split("\n");
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) {
    starts.push(off);
    off += l.length + 1;
  }
  const clean = (i: number) => (lines[i] ?? "").replace(/\r$/, "");
  let i = 0;
  // Front matter is no block.
  if (/^---\s*$/.test(clean(0))) {
    const close = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l.replace(/\r$/, "")));
    if (close > 0) i = close + 1;
  }
  type Raw = { from: number; to: number; code: boolean };
  const raw: Raw[] = [];
  let cur: Raw | null = null;
  const flush = () => {
    if (cur) raw.push(cur);
    cur = null;
  };
  for (; i < lines.length; i++) {
    const l = clean(i);
    const fence = FENCE.exec(l);
    if (fence) {
      flush();
      const mark = fence[1];
      let j = i + 1;
      while (j < lines.length) {
        const m = FENCE.exec(clean(j));
        if (m && m[1][0] === mark[0] && m[1].length >= mark.length && !clean(j).slice(m[0].length).trim()) break;
        j++;
      }
      raw.push({ from: i, to: Math.min(j, lines.length - 1), code: true });
      i = j;
      continue;
    }
    if (!l.trim()) {
      flush();
      continue;
    }
    // A `^id` line of its own belongs to the block before it (directly, or after one blank line).
    if (OWN_LINE.test(l) && !cur && raw.length) {
      const prev = raw[raw.length - 1];
      if (i - prev.to <= 2) {
        prev.to = i;
        continue;
      }
    }
    if (HEADING.test(l)) {
      flush();
      raw.push({ from: i, to: i, code: false });
      continue;
    }
    if (cur && LIST.test(l)) flush();
    if (!cur) cur = { from: i, to: i, code: false };
    else (cur as Raw).to = i;
  }
  flush();

  const out: Paragraph[] = [];
  const seen = new Map<string, number>();
  for (const r of raw) {
    let last = r.to;
    let blockId: string | null = null;
    const own = OWN_LINE.exec(clean(last));
    if (own && last > r.from) {
      blockId = own[1];
      last--;
      while (last > r.from && !clean(last).trim()) last--;
    }
    const body: string[] = [];
    for (let k = r.from; k <= last; k++) body.push(clean(k));
    if (!blockId && !r.code) {
      const m = BLOCK_MARK.exec(body[body.length - 1]);
      if (m) {
        blockId = m[2];
        body[body.length - 1] = body[body.length - 1].slice(0, m.index + m[1].length).trimEnd();
      }
    }
    const text = body.join("\n");
    let anchor = blockId ? `^${blockId}` : virtualAnchor(text);
    if (!blockId) {
      // Two identical paragraphs: the second one is `p-<hash>-2`, and so on.
      const n = (seen.get(anchor) ?? 0) + 1;
      seen.set(anchor, n);
      if (n > 1) anchor = `${anchor}-${n}`;
    }
    out.push({
      index: out.length,
      startLine: r.from + 1,
      endLine: r.to + 1,
      start: starts[r.from],
      end: starts[last] + clean(last).length,
      text,
      blockId,
      anchor,
    });
  }
  return out;
}

/**
 * The paragraph that holds `quote`, word for word, or null. `contains` is
 * the word-for-word test (research/citations `quoteContained`), passed in
 * so the rule is the one citations use everywhere.
 */
export function paragraphOfQuote(content: string, quote: string, contains: (quote: string, page: string) => boolean): Paragraph | null {
  if (!quote.trim()) return null;
  for (const p of noteParagraphs(content)) if (contains(quote, p.text)) return p;
  return null;
}

/** The paragraph an anchor names (`^id` or `p-…`), or null when it is gone (its text changed). */
export function resolveParagraphAnchor(content: string, anchor: string): Paragraph | null {
  const a = anchor.replace(/^#/, "");
  return noteParagraphs(content).find((p) => p.anchor === a || (p.blockId !== null && `^${p.blockId}` === a)) ?? null;
}

/** The wiki link to a paragraph, `[[note#^id]]`, when it has a real block id; null for a virtual anchor. */
export function paragraphLink(path: string, p: Pick<Paragraph, "blockId">): string | null {
  return p.blockId ? `[[${path.replace(/\.(md|markdown)$/i, "")}#^${p.blockId}]]` : null;
}
