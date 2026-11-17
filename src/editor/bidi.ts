/**
 * Per-line text direction for the source editor (MASTER_PLAN v3, T25).
 *
 * A note mixing Hebrew and English must read correctly line by line: a
 * Hebrew paragraph aligned to the right, an English one to the left, code
 * always left-to-right. The browser already knows how to do that for an
 * element with `dir="auto"` (first strong character, UAX #9), and
 * CodeMirror can follow it per line when `perLineTextDirection` is on and
 * every line element carries that attribute — it reads the line's
 * computed `direction` for cursor movement and selection drawing.
 *
 * So the extension is small and deterministic: a line decoration with
 * `dir` on every line in the viewport. Lines inside fenced code (and the
 * frontmatter) get `dir="ltr"`; a frontmatter `dir: rtl` / `dir: ltr` pins
 * the rest. Otherwise (plan 9.7) each line gets the direction of its first
 * strong character AFTER its Markdown markers, ignoring link URLs and code
 * spans (lib/bidiDirection, the golden set's rule) — `dir="auto"` would
 * let "> `iPhone` שלום" run left-to-right. A line with no strong character
 * (a time, a number) takes the note's direction.
 *
 * Arrow keys follow the cursor-movement setting (W13.H1, ./cursorMovement):
 * visual by default, or logical (plan 9.7) — the key that points toward
 * the end of the line goes to the next character in the text.
 */

import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { markdownLineDirection } from "../lib/bidiDirection";
import { explicitDirection, frontmatterDir, frontmatterEnd, type Dir } from "../lib/paragraphDirection";
import { displayMathLines } from "../lib/mathIsolate";
import { cursorMovementExtension } from "./cursorMovement";

export { firstStrongDirection } from "../lib/textDirection";

export type { Dir };

// Moved to lib/paragraphDirection (W11.H4), re-exported for existing importers.
export { frontmatterEnd, frontmatterDir } from "../lib/paragraphDirection";

const ATTR = {
  auto: Decoration.line({ attributes: { dir: "auto" } }),
  ltr: Decoration.line({ attributes: { dir: "ltr" } }),
  rtl: Decoration.line({ attributes: { dir: "rtl" } }),
};

/** Positions of fenced code blocks and the frontmatter: always LTR. */
function ltrRanges(state: EditorState, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (n) => {
      if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "Frontmatter" || n.name === "HTMLBlock") {
        out.push([n.from, n.to]);
        return false;
      }
      return undefined;
    },
  });
  return out;
}

/**
 * The note's own direction, for lines without a strong character: the
 * first line outside fenced code and the frontmatter that has one, over
 * the whole note (fences are tracked textually: the syntax tree of a long
 * note may not be parsed that far yet). LTR otherwise. Cached per document.
 */
const noteDirCache = new WeakMap<object, "ltr" | "rtl">();
export function noteDirection(state: EditorState, fm: number): "ltr" | "rtl" {
  const doc = state.doc;
  const cached = noteDirCache.get(doc);
  if (cached) return cached;
  let fence: string | null = null;
  let found: "ltr" | "rtl" = "ltr";
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.from < fm) continue;
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line.text);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !line.text.trim().slice(open[1].length).length) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    const d = markdownLineDirection(line.text);
    if (d) {
      found = d;
      break;
    }
  }
  noteDirCache.set(doc, found);
  return found;
}

/** Lines (1-based) of `$$` display-math blocks: TeX, laid out left to right like code (W5.14). Cached per document. */
const mathLinesCache = new WeakMap<object, Set<number>>();
function mathLines(state: EditorState): Set<number> {
  const doc = state.doc;
  let set = mathLinesCache.get(doc);
  if (!set) {
    const lines: string[] = [];
    for (let n = 1; n <= doc.lines; n++) lines.push(doc.line(n).text);
    set = new Set([...displayMathLines(lines)].map((i) => i + 1));
    mathLinesCache.set(doc, set);
  }
  return set;
}

function build(view: EditorView): DecorationSet {
  const head = view.state.sliceDoc(0, Math.min(view.state.doc.length, 2000));
  const pinned = frontmatterDir(head);
  // The editor's markdown parser has no frontmatter node (the block parses
  // as a rule and a heading), so the YAML block is found textually.
  const fm = frontmatterEnd(head);
  let base: "ltr" | "rtl" | null = null;
  const ranges: ReturnType<typeof ATTR.auto.range>[] = [];
  for (const { from, to } of view.visibleRanges) {
    // Code and the frontmatter are LTR even when the note pins a
    // direction: a `dir: rtl` author still reads code left-to-right.
    const ltr = ltrRanges(view.state, from, to);
    if (fm > 0) ltr.push([0, fm]);
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const inCode = ltr.some(([a, b]) => line.from >= a && line.from < b) || mathLines(view.state).has(line.number);
      let dir: Dir;
      if (inCode) dir = "ltr";
      // A paragraph switched with "Switch paragraph direction" (W11.H4) wins over the note's pin.
      else if (explicitDirection(line.text)) dir = explicitDirection(line.text)!;
      else if (pinned && pinned !== "auto") dir = pinned;
      else dir = markdownLineDirection(line.text) ?? (base ??= noteDirection(view.state, fm));
      ranges.push(ATTR[dir].range(line.from));
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

/**
 * The extension: per-line direction from each line's own text, arrow keys
 * in the cursor-movement mode the user chose (W13.H1: visual by default,
 * logical as plan 9.7 built it). Code and frontmatter stay LTR; a frontmatter `dir:` key pins
 * the whole note.
 */
export function bidiExtension() {
  return [
    EditorView.perLineTextDirection.of(true),
    cursorMovementExtension(),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    ),
  ];
}
