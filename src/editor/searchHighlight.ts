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
 *   1. Finds every case-insensitive match for the query in the doc.
 *   2. Paints a yellow mark decoration on every match.
 *   3. Scrolls the first match into view and centers it.
 *   4. Fades the decorations after 4 seconds so the editor returns to
 *      its baseline look.
 *
 * Empty / cleared queries clear the highlight immediately.
 */

import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { StateEffect, StateField, type Range } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

const setHighlight = StateEffect.define<{ query: string } | null>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    // Decorations track the text they cover across insertions/deletions.
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlight)) {
        if (!e.value) {
          next = Decoration.none;
        } else {
          next = computeHighlights(tr.state.doc.toString(), e.value.query);
        }
      }
    }
    return next;
  },
  provide(f) {
    return EditorView.decorations.from(f);
  },
});

function computeHighlights(docText: string, query: string): DecorationSet {
  const q = query.trim();
  if (!q) return Decoration.none;
  // Case-insensitive scan. We avoid a regex to skip having to escape the
  // query — search dialogs can contain regex meta-chars freely.
  const lcDoc = docText.toLowerCase();
  const lcQ = q.toLowerCase();
  let pos = 0;
  // Cap matches so a 1-letter query doesn't produce 50k decorations.
  const MAX = 200;
  const mark = Decoration.mark({
    class: "cm-lumen-search-hit",
    attributes: {
      style:
        "background: hsl(48 95% 55% / 0.45); border-radius: 2px; transition: background 1.4s ease-out 2.6s; box-shadow: 0 0 0 1px hsl(48 95% 50% / 0.5)",
    },
  });
  const ranges: Range<Decoration>[] = [];
  while (ranges.length < MAX) {
    const idx = lcDoc.indexOf(lcQ, pos);
    if (idx === -1) break;
    ranges.push(mark.range(idx, idx + q.length));
    pos = idx + Math.max(1, q.length);
  }
  return Decoration.set(ranges, /* sort */ true);
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
              effects: EditorView.scrollIntoView(idx, { y: "center" }),
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

      // No need to react to view updates — the field handles redraws.
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
  return [highlightField, bridgePlugin()];
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
