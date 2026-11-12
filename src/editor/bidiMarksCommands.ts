/**
 * Palette commands for direction controls (plan W5.4):
 *   - "Show direction marks" / "Hide direction marks";
 *   - "Clean direction marks and fix brackets": one undoable change in
 *     whichever editor is open; in the preview the note text is rewritten
 *     and the toast offers Undo.
 */
import type { EditorView } from "@codemirror/view";
import { t } from "../i18n";
import { fixBidi, applyEdits } from "../lib/bidiMarks";
import { firstStrong } from "../lib/bidiDirection";
import { useToastStore } from "../store/useToastStore";
import { bidiMarksShown, proseBidiFixer, toggleBidiMarks } from "./bidiMarksSetting";

export interface BidiMarksCommandDeps {
  getView: () => EditorView | null;
  getContent: () => string;
  setContent: (s: string) => void;
}

export interface BidiMarksPaletteCommand {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  action: () => void | Promise<void>;
}

/** The note's direction for lines with no strong character: its first line that has one. */
function noteDir(text: string): "ltr" | "rtl" {
  for (const line of text.split("\n")) {
    const d = firstStrong(line);
    if (d) return d;
  }
  return "ltr";
}

function report(removed: number, swapped: number, undo?: () => void): void {
  const push = useToastStore.getState().push;
  if (!removed && !swapped) {
    push({ kind: "info", title: t("bidi.fix.none") });
    return;
  }
  push({
    kind: "success",
    title: t("bidi.fix.done"),
    body: t("bidi.fix.counts", { removed, swapped }),
    ...(undo ? { action: { label: t("bidi.fix.undo"), run: undo }, ttlMs: 8000 } : {}),
  });
}

/** Run the fix on whatever editor is mounted; returns the counts. */
export async function runBidiFix(deps: BidiMarksCommandDeps): Promise<{ removed: number; swapped: number }> {
  const view = deps.getView();
  if (view) {
    const text = view.state.doc.toString();
    const { edits, removed, swapped } = fixBidi(text, { noteDir: noteDir(text) });
    if (edits.length) view.dispatch({ changes: edits, userEvent: "input.bidifix", scrollIntoView: false });
    report(removed, swapped);
    view.focus();
    return { removed, swapped };
  }
  const prose = proseBidiFixer();
  if (prose) {
    const r = prose();
    report(r.removed, r.swapped);
    return r;
  }
  const before = deps.getContent();
  const { edits, removed, swapped } = fixBidi(before, { noteDir: noteDir(before) });
  if (edits.length) deps.setContent(applyEdits(before, edits));
  report(removed, swapped, edits.length ? () => deps.setContent(before) : undefined);
  return { removed, swapped };
}

export function buildBidiMarksCommands(deps: BidiMarksCommandDeps): BidiMarksPaletteCommand[] {
  const group = t("group.edit");
  const shown = bidiMarksShown();
  return [
    {
      id: "view.bidiMarks",
      label: shown ? t("cmd.view.bidiMarks.off") : t("cmd.view.bidiMarks.on"),
      hint: t("cmd.view.bidiMarks.hint"),
      group: t("group.view"),
      action: () => {
        toggleBidiMarks();
      },
    },
    {
      id: "edit.bidiFix",
      label: t("cmd.edit.bidiFix"),
      hint: t("cmd.edit.bidiFix.hint"),
      group,
      action: async () => {
        await runBidiFix(deps);
      },
    },
  ];
}
