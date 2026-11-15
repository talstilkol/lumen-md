/**
 * W12.S2 — put one restored paragraph into the open editor as a single
 * transaction, so Ctrl+Z (CodeMirror's history) takes it back out.
 *
 * The hunk was computed against the note's latest saved text. It applies
 * only when the editor still holds that text at those offsets; otherwise
 * nothing changes and the caller says so (never a silent overwrite).
 */
import { EditorView } from "@codemirror/view";
import type { RestoreHunk } from "../storage/asOfRestore";

/** Apply `h` to `view`. Returns false (and changes nothing) when the editor's text moved on. */
export function restoreInView(view: EditorView, h: Pick<RestoreHunk, "from" | "to" | "now" | "insert">): boolean {
  if (h.to > view.state.doc.length || view.state.sliceDoc(h.from, h.to) !== h.now) return false;
  view.dispatch({ changes: { from: h.from, to: h.to, insert: h.insert }, userEvent: "input.restore", scrollIntoView: true });
  return true;
}

/** The source editor on the page, if one is mounted. */
export function activeSourceView(doc: Document = document): EditorView | null {
  const el = doc.querySelector<HTMLElement>(".cm-editor");
  return el ? EditorView.findFromDOM(el) : null;
}
