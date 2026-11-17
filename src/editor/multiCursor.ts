/**
 * Multiple cursors and rectangular selection in the source editor (plan
 * W13.E5), checked on right-to-left and mixed lines.
 *
 *   Alt + drag      a rectangular (column) selection; the pointer turns to a
 *                   crosshair while Alt is held. Not Ctrl/⌘ + Alt: those
 *                   combinations stay free for the Hebrew-layout shortcuts (W2.8).
 *   Mod + click     another cursor (CodeMirror's own binding)
 *   Mod+D           select the next occurrence of the selection (from an
 *                   empty cursor: the word under it — a Hebrew word with its
 *                   niqqud and geresh is one word; a prefix-joined word is
 *                   not a match for the bare one)
 *   Esc             back to one cursor (only when there are several; else
 *                   Esc goes on to its other uses)
 *
 * Every selection is drawn by CodeMirror (drawSelection), so several cursors
 * show, and a selection in an RTL line is painted where its characters are.
 */
import { EditorSelection, EditorState, Prec, type Extension, type StateCommand } from "@codemirror/state";
import { EditorView, crosshairCursor, drawSelection, keymap, rectangularSelection } from "@codemirror/view";

/** Letters of every script, digits, combining marks (niqqud), `_`, and geresh / gershayim inside a word. */
const WORD = /[\p{L}\p{N}\p{M}_׳״'’]/u;
const isWordAt = (text: string, i: number) => i >= 0 && i < text.length && WORD.test(text[i]);

/** The word around `pos` (empty range when the cursor is not on a word). */
export function wordAt(state: EditorState, pos: number): { from: number; to: number } {
  const line = state.doc.lineAt(pos);
  const t = line.text;
  let a = pos - line.from;
  let b = a;
  while (a > 0 && isWordAt(t, a - 1)) a--;
  while (b < t.length && isWordAt(t, b)) b++;
  // Geresh at a word's edge is punctuation (a quote), not part of it.
  while (a < b && /['’״]/.test(t[a])) a++;
  return { from: line.from + a, to: line.from + b };
}

/** Is [from, to) a whole word (no word character just outside it)? */
function wholeWord(doc: string, from: number, to: number): boolean {
  return !isWordAt(doc, from - 1) && !isWordAt(doc, to);
}

/**
 * Mod+D: add the next occurrence of the main selection. From a cursor, the
 * word under it is selected first and later matches must be whole words;
 * from a selection, any exact match. Wraps around the document; stops when
 * every occurrence is selected.
 */
export const selectNextOccurrence: StateCommand = ({ state, dispatch }) => {
  const main = state.selection.main;
  if (main.empty) {
    const w = wordAt(state, main.head);
    if (w.from === w.to) return false;
    dispatch(state.update({ selection: state.selection.replaceRange(EditorSelection.range(w.from, w.to), state.selection.mainIndex), scrollIntoView: true, userEvent: "select" }));
    return true;
  }
  const doc = state.doc.toString();
  const needle = state.sliceDoc(main.from, main.to);
  // Word mode when every selection so far is a whole word (as it is after a cursor's first Mod+D).
  const words = state.selection.ranges.every((r) => wholeWord(doc, r.from, r.to));
  const taken = (from: number) => state.selection.ranges.some((r) => r.from === from);
  const last = state.selection.ranges.reduce((m, r) => (r.to > m ? r.to : m), main.to);
  const find = (start: number, end: number): number => {
    for (let i = doc.indexOf(needle, start); i >= 0 && i < end; i = doc.indexOf(needle, i + 1)) {
      if (taken(i)) continue;
      if (words && !wholeWord(doc, i, i + needle.length)) continue;
      return i;
    }
    return -1;
  };
  let at = find(last, doc.length);
  if (at < 0) at = find(0, last);
  if (at < 0) return false;
  dispatch(
    state.update({
      selection: state.selection.addRange(EditorSelection.range(at, at + needle.length)),
      effects: EditorView.scrollIntoView(at),
      userEvent: "select",
    }),
  );
  return true;
};

/** Esc with several cursors: keep the main one. With one, Esc is not ours. */
export const singleCursor: StateCommand = ({ state, dispatch }) => {
  if (state.selection.ranges.length < 2) return false;
  dispatch(state.update({ selection: EditorSelection.create([state.selection.main]), userEvent: "select" }));
  return true;
};

/** Alt alone (not with Ctrl or ⌘, which the Hebrew-layout shortcuts use) starts a rectangle. */
export const rectangleFilter = (e: MouseEvent) => e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

export function multiCursorExtension(): Extension {
  return [
    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    rectangularSelection({ eventFilter: rectangleFilter }),
    crosshairCursor({ key: "Alt" }),
    Prec.high(
      keymap.of([
        { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
        { key: "Escape", run: singleCursor },
      ]),
    ),
  ];
}
