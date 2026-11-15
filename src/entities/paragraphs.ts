/**
 * Paragraphs of a note, each with its `^id` anchor (plan 4.8) and a hash
 * (plan W12.E1). An edge's provenance points at one paragraph by anchor
 * and remembers its hash; when the hash no longer matches, the edge is
 * "source changed" (`staleness.ts`).
 *
 * A paragraph here is what "Copy link to block" anchors: a run of text
 * lines, one list item, one heading, a quote run or a table. Front matter
 * and fenced code are not paragraphs (nothing is extracted from code).
 * The hash covers the text without its ` ^id` mark, so adding the anchor
 * does not change it; it is NFC with trailing spaces of each line dropped.
 */
import { blockIdEdit, newBlockId } from "../editor/blockLink";
import { BLOCK_MARK } from "../renderer/remarkBlockIds";
import { sha256Hex } from "./sha256";

export interface Paragraph {
  /** Offset of the first character in the note. */
  start: number;
  /** Offset after the last character (before any own-line `^id`). */
  end: number;
  text: string;
  anchor: string | null;
  hash: string;
  /** A heading has no `^id` (it is linked by its text), so no edge cites one. */
  kind: "heading" | "text" | "list" | "quote" | "table";
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HEADING = /^ {0,3}#{1,6}[ \t]+/;
const OWN_LINE = /^\s*\^([A-Za-z0-9-]+)\s*$/;
const QUOTE = /^\s{0,3}>/;
const TABLE = /^\s*\|/;

export function paragraphHash(text: string): string {
  const norm = text
    .normalize("NFC")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .trim();
  return `sha256:${sha256Hex(norm)}`;
}

/** Every paragraph of `content`, in order. */
export function splitParagraphs(content: string): Paragraph[] {
  const lines = content.split("\n");
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) {
    starts.push(off);
    off += l.length + 1;
  }
  const clean = (i: number) => (lines[i] ?? "").replace(/\r$/, "");
  let i = 0;
  // Front matter.
  if (/^---\s*$/.test(clean(0))) {
    const close = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l.replace(/\r$/, "")));
    if (close > 0) i = close + 1;
  }
  const out: Paragraph[] = [];
  const kindOf = (l: string) => (QUOTE.test(l) ? "quote" : TABLE.test(l) ? "table" : "text");
  while (i < lines.length) {
    const line = clean(i);
    const fence = FENCE.exec(line);
    if (fence) {
      let j = i + 1;
      while (j < lines.length) {
        const m = FENCE.exec(clean(j));
        if (m && m[1][0] === fence[1][0] && m[1].length >= fence[1].length && !clean(j).slice(m[0].length).trim()) break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (!line.trim() || OWN_LINE.test(line)) {
      i++;
      continue;
    }
    let last = i;
    if (!HEADING.test(line)) {
      const kind = kindOf(line);
      while (last + 1 < lines.length) {
        const n = clean(last + 1);
        if (!n.trim() || HEADING.test(n) || FENCE.test(n) || OWN_LINE.test(n)) break;
        if (kind === "text" && (LIST.test(n) || QUOTE.test(n) || TABLE.test(n))) break;
        if (kind !== "text" && kindOf(n) !== kind) break;
        last++;
      }
    }
    const raw = content.slice(starts[i], starts[last] + clean(last).length);
    let anchor: string | null = null;
    let text = raw;
    const mark = BLOCK_MARK.exec(clean(last));
    if (mark) {
      anchor = mark[2];
      text = raw.slice(0, raw.length - (clean(last).length - clean(last).replace(BLOCK_MARK, "").length)).replace(/\s+$/, "");
    } else {
      for (const j of [last + 1, last + 2]) {
        const m = OWN_LINE.exec(clean(j));
        if (m) {
          anchor = m[1];
          break;
        }
        if (j === last + 1 && clean(j).trim()) break;
      }
    }
    const kind = HEADING.test(line) ? "heading" : LIST.test(line) ? "list" : QUOTE.test(line) ? "quote" : TABLE.test(line) ? "table" : "text";
    out.push({ start: starts[i], end: starts[last] + clean(last).length, text, anchor, hash: paragraphHash(text), kind });
    i = last + 1;
  }
  return out;
}

/** The paragraph containing offset `pos`, or null. */
export function paragraphAt(content: string, pos: number): Paragraph | null {
  return splitParagraphs(content).find((p) => pos >= p.start && pos <= p.end) ?? null;
}

export function paragraphByAnchor(content: string, anchor: string): Paragraph | null {
  return splitParagraphs(content).find((p) => p.anchor === anchor) ?? null;
}

/**
 * The note with an anchor on the paragraph at `pos` (the same edit "Copy
 * link to block" makes), and the anchor. The note is unchanged when the
 * paragraph has one. This is the only text change the extractor may cause,
 * and it is applied only on approval (W12.E5).
 */
export function ensureAnchor(content: string, pos: number, makeId: (taken: ReadonlySet<string>) => string = (t) => newBlockId(t)): { content: string; anchor: string } | null {
  const p = paragraphAt(content, pos);
  if (!p) return null;
  if (p.anchor) return { content, anchor: p.anchor };
  const edit = blockIdEdit(content, p.start, makeId);
  if (edit.kind !== "block") return null;
  const next = edit.change ? content.slice(0, edit.change.from) + edit.change.insert + content.slice(edit.change.from) : content;
  return { content: next, anchor: edit.id };
}
