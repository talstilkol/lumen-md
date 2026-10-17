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
 * frontmatter) get `dir="ltr"`; everything else `dir="auto"`, unless the
 * note's frontmatter pins a direction (`dir: rtl` / `dir: ltr`).
 */

import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type Dir = "auto" | "ltr" | "rtl";

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ぀-ヿ一-鿿가-힯]/;

/**
 * The base direction a block of text would get from its first strong
 * character (what `dir="auto"` resolves to), or null when there is none.
 */
export function firstStrongDirection(text: string): "ltr" | "rtl" | null {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return "rtl";
    if (LTR_CHAR.test(ch)) return "ltr";
  }
  return null;
}

/** `dir: rtl|ltr|auto` from a note's YAML frontmatter, else null. */
export function frontmatterDir(doc: string): Dir | null {
  if (!doc.startsWith("---")) return null;
  const end = doc.indexOf("\n---", 3);
  if (end < 0) return null;
  const m = /^dir:\s*["']?(auto|ltr|rtl)["']?\s*$/m.exec(doc.slice(3, end));
  return m ? (m[1] as Dir) : null;
}

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

function build(view: EditorView): DecorationSet {
  const pinned = frontmatterDir(view.state.sliceDoc(0, Math.min(view.state.doc.length, 2000)));
  const ranges: ReturnType<typeof ATTR.auto.range>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const ltr = pinned === "auto" || pinned === null ? ltrRanges(view.state, from, to) : [];
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const inCode = ltr.some(([a, b]) => line.from >= a && line.from < b);
      const dir: Dir = inCode ? "ltr" : (pinned ?? "auto");
      ranges.push(ATTR[dir].range(line.from));
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

/**
 * The extension: per-line direction, decided by the browser from each
 * line's own text. Code and frontmatter stay LTR; a frontmatter `dir:` key
 * pins the whole note.
 */
export function bidiExtension() {
  return [
    EditorView.perLineTextDirection.of(true),
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
