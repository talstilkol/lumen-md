/**
 * Inline AI suggestion — ghost text that appears after the cursor
 * when the user pauses typing. Accept with Tab, dismiss with Escape.
 *
 * Implementation: CodeMirror 6 Decoration.widget that renders grey
 * text at the cursor position. The suggestion text is fetched from
 * the local LLM (or cloud fallback) with a short context window.
 */

import { EditorView, Decoration, WidgetType, ViewPlugin, ViewUpdate, keymap } from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
import { log } from "../lib/logger";

const setSuggestion = StateEffect.define<string | null>();

const suggestionField = StateField.define<string | null>({
  create() {
    return null;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) return e.value;
    }
    if (tr.selection) return null; // dismiss on cursor move
    return value;
  },
});

class SuggestionWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: SuggestionWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.style.opacity = "0.45";
    span.style.pointerEvents = "none";
    span.style.userSelect = "none";
    span.className = "cm-ai-suggestion";
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const suggestionPlugin = ViewPlugin.fromClass(
  class {
    private timeout: ReturnType<typeof setTimeout> | null = null;
    private abort: AbortController | null = null;

    constructor(readonly view: EditorView) {
      // no-op
    }

    update(update: ViewUpdate) {
      if (!update.docChanged && !update.selectionSet) return;

      // Cancel any pending request
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = null;
      }
      if (this.abort) {
        this.abort.abort();
        this.abort = null;
      }

      // Clear existing suggestion on any edit or selection change
      if (update.selectionSet) {
        this.view.dispatch({ effects: setSuggestion.of(null) });
        return;
      }

      // Schedule new suggestion after 600 ms of idle typing
      this.timeout = setTimeout(() => this.fetchSuggestion(), 600);
    }

    private async fetchSuggestion() {
      const pos = this.view.state.selection.main.head;
      const line = this.view.state.doc.lineAt(pos);
      const context = line.text.slice(0, pos - line.from);

      // Don't suggest on empty lines or very short context
      if (context.trim().length < 3) return;

      this.abort = new AbortController();
      const signal = this.abort.signal;

      try {
        const { chat } = await import("../ai/llm");
        const suggestion = await chat(
          [
            {
              role: "system",
              content:
                "You are an inline autocomplete assistant for a markdown editor. " +
                "Given the current line fragment, output ONLY the completion text " +
                "(no quotes, no explanations, max 60 chars).",
            },
            {
              role: "user",
              content: `Complete: "${context}"`,
            },
          ],
          { maxTokens: 40, temperature: 0.3 },
        );

        if (signal.aborted) return;
        const trimmed = suggestion.trim();
        if (!trimmed || trimmed === context.trim()) return;

        this.view.dispatch({ effects: setSuggestion.of(trimmed) });
      } catch (err) {
        log.debug("inline-suggestion", err);
      }
    }

    destroy() {
      if (this.timeout) clearTimeout(this.timeout);
      if (this.abort) this.abort.abort();
    }
  },
);

/**
 * Keymap: Tab accepts the suggestion, Escape rejects it.
 */
const acceptKeymap = {
  key: "Tab",
  run(view: EditorView) {
    const suggestion = view.state.field(suggestionField, false);
    if (!suggestion) return false;
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, to: pos, insert: suggestion },
      effects: setSuggestion.of(null),
      selection: { anchor: pos + suggestion.length },
    });
    return true;
  },
};

const rejectKeymap = {
  key: "Escape",
  run(view: EditorView) {
    const suggestion = view.state.field(suggestionField, false);
    if (!suggestion) return false;
    view.dispatch({ effects: setSuggestion.of(null) });
    return true;
  },
};

/**
 * CodeMirror extension that enables inline AI ghost text.
 */
export function inlineSuggestion(): Extension[] {
  return [
    suggestionField,
    suggestionPlugin,
    EditorView.decorations.compute([suggestionField], (state) => {
      const text = state.field(suggestionField);
      if (!text) return Decoration.none;
      const pos = state.selection.main.head;
      const widget = new SuggestionWidget(text);
      return Decoration.set([Decoration.widget({ widget, side: 1 }).range(pos)]);
    }),
    keymap.of([acceptKeymap, rejectKeymap]),
  ];
}
