/**
 * The note's saved AI spans drawn in the WYSIWYG editor after it is built
 * from the store (plan 5.9, W10.E37). The spans are offsets into the note's
 * Markdown (written by the source editor, by AI commands through the store,
 * or by this editor's last emission); the editor needs document positions.
 *
 * The inverse of `markdownAiSpans`: two private-use brackets go around each
 * span in a copy of the Markdown, the copy is parsed with the editor's own
 * parser, and the brackets' places in that document are the ranges. The
 * brackets are then deleted from the parsed copy, and it must come out equal
 * to the editor's document; a span whose brackets change the parse (one in a
 * link's URL, say) is left out rather than guessed.
 */
import { parserCtx, editorViewCtx, type Editor } from "@milkdown/core";
import type { Node as PMNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { Transform } from "@milkdown/prose/transform";
import { authorshipKey } from "../ai/aiWrites";
import { loadSpans, type Span } from "../ai/authorship";
import { useAppStore } from "../store/useStore";
import { log } from "../lib/logger";
import { restoreAiRanges } from "./wysiwygAiAuthorship";

const OPEN = "";
const CLOSE = "";
// Block syntax at the start of a line: a bracket before it would turn a heading or a list item into a paragraph.
const BLOCK_PREFIX = /^(?:[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))*/;

/** A span moved past the block syntax it starts on and the line breaks it ends on (neither is text in the editor). */
export function snapSpan(md: string, [a, b]: Span): Span | null {
  let from = Math.max(0, a);
  let to = Math.min(md.length, b);
  if (from === 0 || md[from - 1] === "\n") from += BLOCK_PREFIX.exec(md.slice(from, to))?.[0].length ?? 0;
  while (to > from && /\s/.test(md[to - 1])) to--;
  while (from < to && /\s/.test(md[from])) from++;
  return to > from ? [from, to] : null;
}

/** The document ranges of `spans`, or null when the brackets do not come out cleanly. */
function tryRanges(md: string, spans: readonly Span[], parse: (md: string) => PMNode | null, doc: PMNode, prepare: (md: string) => string): Array<[number, number]> | null {
  let marked = md;
  for (const [a, b] of [...spans].sort((x, y) => y[0] - x[0])) marked = marked.slice(0, a) + OPEN + marked.slice(a, b) + CLOSE + marked.slice(b);
  let parsed: PMNode | null;
  try {
    parsed = parse(prepare(marked));
  } catch {
    return null;
  }
  if (!parsed) return null;
  const at: Array<{ pos: number; open: boolean }> = [];
  parsed.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (let i = 0; i < node.text.length; i++) {
      const ch = node.text[i];
      if (ch === OPEN || ch === CLOSE) at.push({ pos: pos + i, open: ch === OPEN });
    }
  });
  if (at.length !== spans.length * 2) return null;
  const tr = new Transform(parsed);
  for (const { pos } of [...at].reverse()) tr.delete(pos, pos + 1);
  if (!tr.doc.eq(doc)) return null;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < at.length; i += 2) {
    const o = at[i];
    const c = at[i + 1];
    if (!o.open || c.open) return null;
    // Each bracket before a position moved it one place on: OPEN of pair k has 2k before it, its CLOSE 2k + 1.
    const from = o.pos - i;
    const to = c.pos - i - 1;
    if (to > from) out.push([from, to]);
  }
  return out;
}

/**
 * The document ranges of the Markdown spans `spans` (pure part; tests).
 * All at once first; if that parse does not come back clean, span by span,
 * keeping only the ones that do.
 */
export function docAiRanges(md: string, spans: readonly Span[], parse: (md: string) => PMNode | null, doc: PMNode, prepare: (md: string) => string = (s) => s): Array<[number, number]> {
  const snapped = spans.map((s) => snapSpan(md, s)).filter((s): s is Span => s !== null);
  if (!snapped.length) return [];
  const all = tryRanges(md, snapped, parse, doc, prepare);
  if (all) return all;
  return snapped.flatMap((s) => tryRanges(md, [s], parse, doc, prepare) ?? []);
}

/** Draw the note's saved spans in `view` (the part after Milkdown's context; tests). `full` is the note as given (frontmatter + body), `prepare` what the body went through before `parse`. */
export function drawSavedAiSpans(view: EditorView, parse: (md: string) => PMNode | null, full: string, frontmatter: string, prepare: (md: string) => string): number {
  const saved = loadSpans(authorshipKey(useAppStore.getState().doc), full);
  const body = full.slice(frontmatter.length);
  const spans = saved.map(([a, b]): Span => [Math.max(0, a - frontmatter.length), b - frontmatter.length]).filter(([a, b]) => b > a);
  if (!spans.length) return 0;
  const ranges = docAiRanges(body, spans, parse, view.state.doc, prepare);
  if (ranges.length) view.dispatch(restoreAiRanges(view.state.tr, ranges));
  return ranges.length;
}

/** After a build: draw the note's saved spans with the editor's own parser. */
export function restoreWysiwygAiSpans(editor: Editor, full: string, frontmatter: string, prepare: (md: string) => string): void {
  try {
    editor.action((ctx) => drawSavedAiSpans(ctx.get(editorViewCtx), ctx.get(parserCtx), full, frontmatter, prepare));
  } catch (e) {
    log.warn("[wysiwyg] saved AI marks not drawn", e);
  }
}
