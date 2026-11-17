/**
 * Smart lists in the source editor (plan W13.E2): the operations of
 * smartLists.ts on CodeMirror keys. Each key runs the pure operation on the
 * document and dispatches the difference as one change (one undo step);
 * when the operation does not apply (not a list line), the key falls
 * through to the editor's own binding.
 *
 *   Enter            continue / split / end the item
 *   Shift+Enter      a line break inside the item
 *   Tab / Shift+Tab  indent / outdent the item with its children
 *   Alt+↑ / Alt+↓    move the item with its children among its siblings
 *   Backspace        at the start of the item's text: remove the marker
 *   Mod+Enter        cycle the task box
 *   Mod+B            bold, with the 1.14 partial-selection rules
 *   paste            a list pasted into an item (no doubled marker, levels re-based)
 *
 * The keys are in lib/shortcuts.ts (the conflict check). Loaded with the
 * source editor; nothing here touches the startup bundle on its own.
 */
import { EditorSelection, Prec, type EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { runSmartList, type ListState, type SmartListOp } from "./smartLists";

/** The transaction for `op` on this state, or null when the operation does not apply. */
export function smartListTransaction(state: EditorState, op: SmartListOp, arg?: string): TransactionSpec | null {
  // One cursor only: with several, each needs its own list context (the editor's own keys do that).
  if (state.selection.ranges.length > 1) return null;
  const doc = state.doc.toString();
  const { anchor, head } = state.selection.main;
  const r = runSmartList(op, { doc, sel: { anchor, head } }, arg);
  if (!r) return null;
  return { ...diff(doc, r), scrollIntoView: true, userEvent: op === "paste" ? "input.paste" : op === "enter" || op === "shiftEnter" ? "input" : "input.list" };
}

/** The smallest single change from `before` to `r.doc`, with the new selection. */
function diff(before: string, r: ListState): TransactionSpec {
  const after = r.doc;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before.charCodeAt(endB - 1) === after.charCodeAt(endA - 1)) {
    endB--;
    endA--;
  }
  const selection = EditorSelection.single(r.sel.anchor, r.sel.head);
  if (start === endB && start === endA) return { selection };
  return { changes: { from: start, to: endB, insert: after.slice(start, endA) }, selection };
}

function command(op: SmartListOp) {
  return (view: EditorView): boolean => {
    const tr = smartListTransaction(view.state, op);
    if (!tr) return false;
    view.dispatch(tr);
    return true;
  };
}

export function smartListKeymap(): Extension {
  return [
    Prec.high(
      keymap.of([
        { key: "Enter", run: command("enter") },
        { key: "Shift-Enter", run: command("shiftEnter") },
        { key: "Tab", run: command("tab") },
        { key: "Shift-Tab", run: command("shiftTab") },
        { key: "Alt-ArrowUp", run: command("moveUp") },
        { key: "Alt-ArrowDown", run: command("moveDown") },
        { key: "Backspace", run: command("backspace") },
        { key: "Mod-Enter", run: command("toggleTask") },
        { key: "Mod-b", run: command("toggleBold") },
      ]),
    ),
    EditorView.domEventHandlers({
      paste(e, view) {
        const text = e.clipboardData?.getData("text/plain");
        if (!text || e.clipboardData?.types.includes("text/html")) return false;
        const tr = smartListTransaction(view.state, "paste", text);
        if (!tr) return false;
        e.preventDefault();
        view.dispatch(tr);
        return true;
      },
    }),
  ];
}
