/**
 * Arrow keys in the source editor (CodeMirror), in the cursor-movement mode
 * the user chose (plan W13.H1; ./cursorMovementSetting):
 *
 *   visual  — the default: the caret goes toward the side the key points to
 *             on screen, the way CodeMirror draws the line (its own UAX #9
 *             order, so the same in Chromium, Firefox and WebKit). Shift
 *             extends visually; Ctrl/⌥ moves by word visually.
 *   logical — plan 9.7: the key that points toward the end of the line (Left
 *             in an RTL line, Right in an LTR one) goes to the next character
 *             in the text, through runs of the other direction, numbers and
 *             brackets. Shift extends the same way; Ctrl/⌥ moves by word.
 *
 * A non-empty selection collapses to its side in both modes. Home and End are
 * CodeMirror's, the same in both modes: the start and end of the visual
 * (wrapped) line in text order, so Shift+End selects the whole line.
 * Switching the setting reconfigures every open editor at once.
 *
 * The caret is drawn by CodeMirror (drawSelection), not by the browser: a
 * position where an LTR and an RTL run meet has two places on screen, and
 * only CodeMirror knows which side the last move came from (the range's
 * bidiLevel). With the browser's caret, a visual move across "iPhone|חדש"
 * would be drawn on the far side of the run and jump.
 */
import { Direction, EditorView, ViewPlugin, drawSelection, keymap } from "@codemirror/view";
import { CharCategory, Compartment, EditorSelection, Prec, findClusterBreak, type EditorState, type Extension, type SelectionRange } from "@codemirror/state";
import { cursorMovement, onCursorMovementChange, type CursorMovement } from "./cursorMovementSetting";

/** One grapheme cluster forward or back in the text, across line breaks. */
export function charLogical(state: EditorState, pos: number, forward: boolean): number {
  const line = state.doc.lineAt(pos);
  if (forward ? pos === line.to : pos === line.from) return forward ? Math.min(state.doc.length, pos + 1) : Math.max(0, pos - 1);
  return line.from + findClusterBreak(line.text, pos - line.from, forward);
}

/** One word forward or back in the text: skip spaces, then a run of one character category. */
export function groupLogical(state: EditorState, pos: number, forward: boolean): number {
  const line = state.doc.lineAt(pos);
  if (forward ? pos === line.to : pos === line.from) return charLogical(state, pos, forward);
  const cat = state.charCategorizer(pos);
  const text = line.text;
  let at = pos - line.from;
  const next = () => (forward ? findClusterBreak(text, at, true) : findClusterBreak(text, at, false));
  const charAt = (i: number, j: number) => text.slice(Math.min(i, j), Math.max(i, j));
  // Spaces first.
  while (forward ? at < text.length : at > 0) {
    const n = next();
    if (cat(charAt(at, n)) !== CharCategory.Space) break;
    at = n;
  }
  let group: CharCategory | null = null;
  while (forward ? at < text.length : at > 0) {
    const n = next();
    const c = cat(charAt(at, n));
    if (c === CharCategory.Space || (group !== null && c !== group)) break;
    group = c;
    at = n;
  }
  return line.from + at;
}

type Step = (state: EditorState, pos: number, forward: boolean) => number;

/**
 * The command for a horizontal arrow: `towardRight` is the key's side.
 * Toward the end of the line is Left in an RTL line, Right in an LTR one.
 */
function arrow(towardRight: boolean, step: Step, extend: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const move = (r: SelectionRange): SelectionRange => {
      const rtl = view.textDirectionAt(r.head) === Direction.RTL;
      const forward = towardRight !== rtl;
      if (extend) return EditorSelection.range(r.anchor, step(state, r.head, forward));
      // A selection collapses to its start or end, the way the plain arrow keys do.
      if (!r.empty) return EditorSelection.cursor(forward ? r.to : r.from);
      return EditorSelection.cursor(step(state, r.head, forward));
    };
    view.dispatch(state.update({ selection: EditorSelection.create(state.selection.ranges.map(move), state.selection.mainIndex), scrollIntoView: true, userEvent: "select" }));
    return true;
  };
}

/**
 * Visual movement: `towardRight` is the key's side. CodeMirror's moveByChar /
 * moveByGroup take "forward" as away from the line's start, which is the
 * right edge in an RTL line — so Left is forward there.
 */
function visual(towardRight: boolean, byGroup: boolean, extend: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const move = (r: SelectionRange): SelectionRange => {
      const rtl = view.textDirectionAt(r.head) === Direction.RTL;
      const forward = towardRight !== rtl;
      const next = byGroup ? view.moveByGroup(r, forward) : view.moveByChar(r, forward);
      if (extend) return EditorSelection.range(r.anchor, next.head, next.goalColumn, next.bidiLevel ?? undefined);
      if (!r.empty) return EditorSelection.cursor(forward ? r.to : r.from);
      return next;
    };
    view.dispatch(state.update({ selection: EditorSelection.create(state.selection.ranges.map(move), state.selection.mainIndex), scrollIntoView: true, userEvent: "select" }));
    return true;
  };
}

function bindings(left: (extend: boolean) => (v: EditorView) => boolean, right: (extend: boolean) => (v: EditorView) => boolean, wordLeft: (extend: boolean) => (v: EditorView) => boolean, wordRight: (extend: boolean) => (v: EditorView) => boolean) {
  return [
    { key: "ArrowLeft", run: left(false), shift: left(true), preventDefault: true },
    { key: "ArrowRight", run: right(false), shift: right(true), preventDefault: true },
    { key: "Mod-ArrowLeft", mac: "Alt-ArrowLeft", run: wordLeft(false), shift: wordLeft(true), preventDefault: true },
    { key: "Mod-ArrowRight", mac: "Alt-ArrowRight", run: wordRight(false), shift: wordRight(true), preventDefault: true },
  ];
}

const LOGICAL = bindings(
  (x) => arrow(false, charLogical, x),
  (x) => arrow(true, charLogical, x),
  (x) => arrow(false, groupLogical, x),
  (x) => arrow(true, groupLogical, x),
);
const VISUAL = bindings(
  (x) => visual(false, false, x),
  (x) => visual(true, false, x),
  (x) => visual(false, true, x),
  (x) => visual(true, true, x),
);

/** The arrow-key bindings of one mode. */
export function cursorMovementKeymap(mode: CursorMovement): Extension {
  return Prec.high(keymap.of(mode === "logical" ? LOGICAL : VISUAL));
}

const modeCompartment = new Compartment();

/** The mode an editor runs in now (tests, the e2e). */
export function editorCursorMovement(state: EditorState): CursorMovement {
  const ext = modeCompartment.get(state);
  return ext === undefined ? "visual" : (ext as { mode?: CursorMovement }).mode ?? "visual";
}

function tagged(mode: CursorMovement): Extension {
  const ext = cursorMovementKeymap(mode) as Extension & { mode?: CursorMovement };
  return Object.assign([ext], { mode });
}

/**
 * The extension for the source editor: the bindings of the current mode in a
 * compartment, reconfigured when the setting changes.
 */
export function cursorMovementExtension(mode: CursorMovement = cursorMovement()): Extension {
  return [
    drawSelection(),
    modeCompartment.of(tagged(mode)),
    ViewPlugin.define((view) => {
      const off = onCursorMovementChange((m) => {
        if (editorCursorMovement(view.state) !== m) view.dispatch({ effects: modeCompartment.reconfigure(tagged(m)) });
      });
      return { destroy: off };
    }),
  ];
}
