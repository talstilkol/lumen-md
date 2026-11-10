/**
 * The sentence being read aloud (T32), highlighted as a decoration — never
 * as the editor selection, so typing during playback can't replace it —
 * and, when the voice reports word boundaries, the word being read (W2.6).
 */
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";

export interface SpokenRange {
  from: number;
  to: number;
  /** The word being read, inside the sentence. */
  word?: { from: number; to: number };
}

export const setSpokenRange = StateEffect.define<SpokenRange | null>();

const spokenMark = Decoration.mark({ class: "cm-spoken-sentence" });
const spokenWord = Decoration.mark({ class: "cm-spoken-word" });

export const spokenRangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setSpokenRange)) continue;
      const len = tr.state.doc.length;
      const from = e.value ? Math.max(0, Math.min(e.value.from, len)) : 0;
      const to = e.value ? Math.max(from, Math.min(e.value.to, len)) : 0;
      if (!e.value || to <= from) {
        next = Decoration.none;
        continue;
      }
      const marks = [spokenMark.range(from, to)];
      const w = e.value.word;
      if (w) {
        const wf = Math.max(from, Math.min(w.from, to));
        const wt = Math.max(wf, Math.min(w.to, to));
        if (wt > wf) marks.push(spokenWord.range(wf, wt));
      }
      next = Decoration.set(marks, true);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function speechHighlightExtension(): Extension {
  return [
    spokenRangeField,
    EditorView.baseTheme({
      ".cm-spoken-sentence": { backgroundColor: "rgba(250, 204, 21, 0.35)", borderRadius: "2px" },
      "&dark .cm-spoken-sentence": { backgroundColor: "rgba(250, 204, 21, 0.25)" },
      ".cm-spoken-word": { backgroundColor: "rgba(250, 204, 21, 0.6)", borderRadius: "2px" },
      "&dark .cm-spoken-word": { backgroundColor: "rgba(250, 204, 21, 0.5)" },
    }),
  ];
}

/** Highlight (or, with null, clear) the spoken range and scroll it into view. */
export function showSpokenRange(view: EditorView, range: SpokenRange | null): void {
  const effects: StateEffect<unknown>[] = [setSpokenRange.of(range)];
  // Scroll for a new sentence, not for every word in it.
  if (range && !range.word) effects.push(EditorView.scrollIntoView(Math.max(0, Math.min(range.from, view.state.doc.length)), { y: "center" }));
  view.dispatch({ effects });
}
