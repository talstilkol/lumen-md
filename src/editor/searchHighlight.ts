/**
 * CodeMirror extension that highlights query matches inside the editor
 * after a hit is opened from the workspace SearchDialog. Listens for the
 * `lumen-search-target` window event:
 *
 *     window.dispatchEvent(new CustomEvent("lumen-search-target", {
 *       detail: { query: "deep learning" }
 *     }))
 *
 * On receipt, the extension:
 *   1. Remembers the query (case-insensitive).
 *   2. Paints a yellow mark on each match in the visible ranges only
 *      (W11.Q3: a long note is never decorated as a whole).
 *   3. Unfolds whatever fold hides the first match (a folded list, heading or
 *      code block: plan W7.3 step 4b, W10.E50), then scrolls it into view and
 *      centers it.
 *   4. Fades the decorations after 4 seconds so the editor returns to
 *      its baseline look.
 *
 * Empty / cleared queries clear the highlight immediately.
 */

import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { StateEffect, StateField, type EditorState, type Range, type RangeSet, type RangeValue } from "@codemirror/state";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

const setHighlight = StateEffect.define<{ query: string } | null>();

/** The query being highlighted (lower-cased and trimmed), or null. */
const highlightQuery = StateField.define<string | null>({
  create() {
    return null;
  },
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHighlight)) value = e.value ? e.value.query.trim().toLowerCase() || null : null;
    return value;
  },
});

const mark = Decoration.mark({
  class: "cm-lumen-search-hit",
  attributes: {
    style:
      "background: hsl(48 95% 55% / 0.45); border-radius: 2px; transition: background 1.4s ease-out 2.6s; box-shadow: 0 0 0 1px hsl(48 95% 50% / 0.5)",
  },
});

/** Cap per visible range, so a 1-letter query on a dense screen stays cheap. */
const MAX = 200;

/**
 * The matches in the visible ranges only (W11.Q3): a long note is never
 * scanned or decorated as a whole. Case-insensitive, without a regex, so the
 * query can hold regex meta-characters.
 */
export function searchHighlights(view: EditorView): DecorationSet {
  const q = view.state.field(highlightQuery, false);
  if (!q) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    // Read a query's length past each edge, so a match the edge cuts is found.
    const a = Math.max(0, from - q.length + 1);
    const b = Math.min(view.state.doc.length, to + q.length - 1);
    const text = view.state.sliceDoc(a, b).toLowerCase();
    let pos = 0;
    for (let n = 0; n < MAX; n++) {
      const idx = text.indexOf(q, pos);
      if (idx === -1) break;
      const at = a + idx;
      if (!ranges.length || at >= ranges[ranges.length - 1].to) ranges.push(mark.range(at, at + q.length));
      pos = idx + Math.max(1, q.length);
    }
  }
  return Decoration.set(ranges, true);
}

const highlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = searchHighlights(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.startState.field(highlightQuery, false) !== u.state.field(highlightQuery, false)) this.decorations = searchHighlights(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** The folds that cover any of [from, to): a match inside one would be scrolled to but stay hidden. */
export function foldsHiding(state: EditorState, from: number, to: number): Array<{ from: number; to: number }> {
  return rangesOver(foldedRanges(state), from, to);
}

/** The ranges of a set (the folded ranges) that overlap [from, to). */
export function rangesOver(set: Pick<RangeSet<RangeValue>, "between">, from: number, to: number): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  set.between(from, to, (a, b) => {
    if (a < to && b > from) out.push({ from: a, to: b });
  });
  return out;
}

interface SearchTargetEventDetail {
  /** The query the user searched for. */
  query: string;
}

/**
 * Bridge: a thin ViewPlugin that listens for the window event and dispatches
 * the `setHighlight` effect into the field. Also handles auto-clear.
 */
function bridgePlugin() {
  return ViewPlugin.fromClass(
    class {
      private clearTimer: number | null = null;
      private listener: (e: Event) => void;

      constructor(view: EditorView) {
        this.listener = (e: Event) => {
          const detail = (e as CustomEvent<SearchTargetEventDetail>).detail;
          if (!detail || typeof detail.query !== "string") return;
          // Apply the highlight.
          view.dispatch({ effects: setHighlight.of({ query: detail.query }) });
          // Scroll to the first match.
          const docText = view.state.doc.toString();
          const idx = docText.toLowerCase().indexOf(detail.query.trim().toLowerCase());
          if (idx >= 0) {
            view.dispatch({
              effects: [...foldsHiding(view.state, idx, idx + detail.query.trim().length).map((f) => unfoldEffect.of(f)), EditorView.scrollIntoView(idx, { y: "center" })],
            });
          }
          // Auto-clear after 4 seconds so the editor returns to normal.
          if (this.clearTimer != null) window.clearTimeout(this.clearTimer);
          this.clearTimer = window.setTimeout(() => {
            view.dispatch({ effects: setHighlight.of(null) });
            this.clearTimer = null;
          }, 4000);
        };
        window.addEventListener("lumen-search-target", this.listener);
      }

      // No need to react to view updates — the highlight plugin redraws.
      update(_u: ViewUpdate) {
        /* noop */
      }

      destroy() {
        window.removeEventListener("lumen-search-target", this.listener);
        if (this.clearTimer != null) window.clearTimeout(this.clearTimer);
      }
    },
  );
}

/** Public entry point — bundle the field + bridge as a single extension. */
export function searchHighlightExtension(): Extension {
  return [highlightQuery, highlightPlugin, bridgePlugin()];
}

/**
 * Convenience for callers (e.g. SearchDialog) that just want to fire the
 * highlight pulse from anywhere in the app.
 */
export function flashSearchHighlight(query: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SearchTargetEventDetail>("lumen-search-target", {
      detail: { query },
    }),
  );
}
