/**
 * Hebrew typography as you type (plan W2.9). After each typed character,
 * the rules of text/hebrewTypography run on its line and fix only what the
 * character just completed: צה"ל becomes צה״ל when the ל is typed, a
 * closing " becomes ” as it is typed. The fix is its own undo step, so
 * Ctrl+Z right after it gives back the character as typed — and it is not
 * redone, because later keystrokes only fix what they themselves complete
 * and never a fix the key before them already offered (keystrokeEdits).
 * Code, links and the frontmatter are never touched.
 */

import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { keystrokeEdits, loadTypographySettings, onTypographySettings, type TypoEdit, type TypographySettings } from "../text/hebrewTypography";

const HEBREW = /[א-ת]/;

export function hebrewTypographyExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      settings: TypographySettings = loadTypographySettings();
      /** The fix dispatched at the last keystroke that had one (review 11, L3): [] when its dispatch was dropped. */
      private made: TypoEdit[] = [];
      private off: () => void;
      constructor(readonly view: EditorView) {
        this.off = onTypographySettings((s) => {
          this.settings = s;
        });
      }
      update(u: ViewUpdate) {
        if (!this.settings.asYouType || !u.docChanged) return;
        if (!u.transactions.some((tr) => tr.isUserEvent("input.type"))) return;
        const sel = u.state.selection.main;
        if (!sel.empty) return;
        const head = sel.head;
        const line = u.state.doc.lineAt(head);
        if (head === line.from || !HEBREW.test(line.text)) return;
        const doc = u.state.doc;
        // A fix the previous key already offered and that is still to make was undone: it is not made again.
        const edits = keystrokeEdits(doc.toString(), this.settings.rules, { from: line.from, to: line.to }, head, this.made);
        this.made = [];
        if (!edits.length) return;
        // Dispatching inside an update is not allowed: right after it, if nothing changed meanwhile.
        setTimeout(() => {
          if (this.view.state.doc !== doc) return;
          this.made = edits;
          this.view.dispatch({
            changes: edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })),
            annotations: isolateHistory.of("full"),
            userEvent: "input.typography",
          });
        }, 0);
      }
      destroy() {
        this.off();
      }
    },
  );
}
