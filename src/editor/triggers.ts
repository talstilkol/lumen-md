/**
 * Typed triggers in the source editor (plan W7.24, W10.C28): "@מקור" or
 * "@source", typed as a word, opens the open-sources dialog (Sefaria, the
 * Knesset, data.gov.il, Ben-Yehuda) and the trigger text is removed. Only
 * typing fires it: pasted text, undo and remote edits never do. The dialog
 * itself searches on the device first and asks before anything goes online.
 */
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const OPEN_SOURCES_TRIGGERS = ["@מקור", "@source"] as const;

/** The trigger that ends `before` (the line up to the cursor) as a word of its own, or null. */
export function triggerAtEnd(before: string): string | null {
  for (const t of OPEN_SOURCES_TRIGGERS) {
    if (!before.endsWith(t)) continue;
    const prev = before.slice(0, -t.length).slice(-1);
    if (prev === "" || /[\s([{«"'״]/.test(prev)) return t;
  }
  return null;
}

export function openSourcesTrigger(open: () => void = () => void import("../sources/open/OpenSourcesDialog").then((m) => m.openSourcesDialog())): Extension {
  return EditorView.updateListener.of((u) => {
    if (!u.docChanged || !u.transactions.some((tr) => tr.isUserEvent("input.type"))) return;
    const { state } = u;
    const sel = state.selection.main;
    if (!sel.empty) return;
    const line = state.doc.lineAt(sel.head);
    const t = triggerAtEnd(line.text.slice(0, sel.head - line.from));
    if (!t) return;
    // A listener may not dispatch during the update: remove the trigger next, then open the dialog.
    queueMicrotask(() => {
      const from = sel.head - t.length;
      if (u.view.state.sliceDoc(from, sel.head) === t) u.view.dispatch({ changes: { from, to: sel.head, insert: "" }, userEvent: "delete" });
      open();
    });
  });
}
