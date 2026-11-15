/**
 * AI text that reaches a note through the store (plan 5.9, W10.E37): an AI
 * command that sets the document's content (append a diagram, translate
 * the note, merge tags…) says so with `writeAiContent`, and what that write
 * inserted is AI text, tagged at the write. Nothing is found by matching
 * recent answers:
 *
 * - the open source editor gets the write as one whole-document change and
 *   takes the pending tag for exactly that text (`takeAiWrite`, read by
 *   editor/aiAuthorship.ts);
 * - the note's saved spans are updated as well, so a note shown in WYSIWYG
 *   or preview (no source editor) keeps the marks for the next source view
 *   and for the export with marks.
 *
 * What a write inserted: a word-level diff of the text before and after
 * (`insertedSpans`), so links put inside the user's sentences mark the
 * links, not the sentences between them. Pure: no store, no editor.
 */
import { diffMiddle, loadSpans, normalize, saveSpans, type Span } from "./authorship";

/** How long a pending tag waits for its editor change (the store's sync is synchronous; this is a margin). */
const PENDING_MS = 10_000;
/** Above this many token pairs the diff stops at the changed middle (a whole-note rewrite). */
const MAX_CELLS = 4_000_000;

let pending: { after: string; at: number } | null = null;

/** The key a note's saved spans live under (the source editor's own). */
export function authorshipKey(doc: { name: string; workspaceName?: string | null }): string {
  return doc.workspaceName ?? `file:${doc.name}`;
}

/** An AI command is about to set the content to `after`. */
export function noteAiWrite(after: string, now = Date.now()): void {
  pending = { after, at: now };
}

/** Is the change to `after` the pending AI write? Consumes it when it is. */
export function takeAiWrite(after: string, now = Date.now()): boolean {
  if (!pending || now - pending.at > PENDING_MS || pending.after !== after) return false;
  pending = null;
  return true;
}

/** Test hook. */
export function __clearAiWrite(): void {
  pending = null;
}

const tokens = (s: string, from: number, to: number) => {
  const out: Array<[number, number]> = [];
  const re = /\s+|[^\s]+/g;
  re.lastIndex = from;
  for (let m = re.exec(s); m && m.index < to; m = re.exec(s)) out.push([m.index, Math.min(m.index + m[0].length, to)]);
  return out;
};

/**
 * The ranges of `after` that are not in `before`: the common prefix and
 * suffix, then a word-level LCS of the middle. Whitespace between two
 * inserted words is inserted too; inserted whitespace alone is not text.
 */
export function insertedSpans(before: string, after: string): Span[] {
  const { start, endBefore, endAfter } = diffMiddle(before, after);
  if (endAfter <= start) return [];
  const a = tokens(before, start, endBefore);
  const b = tokens(after, start, endAfter);
  const word = (s: string, [x, y]: [number, number]) => s.slice(x, y);
  let keep: boolean[];
  if (!a.length || a.length * b.length > MAX_CELLS) keep = b.map(() => false);
  else {
    // LCS table over tokens (rows: before, columns: after).
    const w = b.length + 1;
    const t = new Uint32Array((a.length + 1) * w);
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--) t[i * w + j] = word(before, a[i]) === word(after, b[j]) ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    keep = b.map(() => false);
    for (let i = 0, j = 0; i < a.length && j < b.length; ) {
      if (word(before, a[i]) === word(after, b[j])) {
        keep[j] = true;
        i++;
        j++;
      } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
      else j++;
    }
  }
  const out: Span[] = [];
  b.forEach(([x, y], j) => {
    if (keep[j]) return;
    const text = after.slice(x, y);
    if (/\S/.test(text)) out.push([x, y]);
    else if (j > 0 && j < b.length - 1 && !keep[j - 1] && !keep[j + 1]) out.push([x, y]);
  });
  return normalize(out);
}

/**
 * Spans of `before` carried into `after` across one rewrite: those in the
 * unchanged prefix and suffix stay (shifted), those in the changed middle
 * are dropped (the user's edit made them the user's, or they were replaced).
 */
export function carrySpans(before: string, after: string, spans: readonly Span[]): Span[] {
  const { start, endBefore, endAfter } = diffMiddle(before, after);
  const delta = endAfter - endBefore;
  return spans.flatMap(([a, b]): Span[] => {
    if (b <= start) return [[a, b]];
    if (a >= endBefore) return [[a + delta, b + delta]];
    const head: Span[] = a < start ? [[a, start]] : [];
    const tail: Span[] = b > endBefore ? [[endBefore + delta, b + delta]] : [];
    return [...head, ...tail];
  });
}

/**
 * Set the content to an AI command's result: tag the write for the open
 * source editor and record what it inserted in the note's saved spans.
 */
export function writeAiContent(doc: { name: string; content: string; workspaceName?: string | null }, after: string, setContent: (s: string) => void): void {
  const before = doc.content;
  if (after !== before) {
    const key = authorshipKey(doc);
    saveSpans(key, after, normalize([...carrySpans(before, after, loadSpans(key, before)), ...insertedSpans(before, after)]));
    noteAiWrite(after);
  }
  setContent(after);
}
