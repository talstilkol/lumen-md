import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, search } from "@codemirror/search";
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import {
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { tags as t } from "@lezer/highlight";
import { StateField, StateEffect } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { CollabSession } from "../collab/yjs";
import { chat } from "../ai/llm";
import { PROMPTS } from "../ai/prompts";

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, class: "tok-heading tok-heading1" },
  { tag: t.heading2, class: "tok-heading tok-heading2" },
  { tag: t.heading3, class: "tok-heading tok-heading3" },
  { tag: t.heading4, class: "tok-heading" },
  { tag: t.heading5, class: "tok-heading" },
  { tag: t.heading6, class: "tok-heading" },
  { tag: t.emphasis, class: "tok-emphasis" },
  { tag: t.strong, class: "tok-strong" },
  { tag: t.link, class: "tok-link" },
  { tag: t.url, class: "tok-link" },
  { tag: t.monospace, class: "tok-monospace" },
  { tag: t.string, class: "tok-string" },
  { tag: t.quote, class: "tok-quote" },
  { tag: t.meta, class: "tok-meta" },
  { tag: t.processingInstruction, class: "tok-meta" },
]);

interface EditorProps {
  value: string;
  onChange: (next: string) => void;
  /**
   * Called when the user pastes/drops an image. Should return a markdown URL
   * (relative path or data URL) to insert at the cursor, or null to fall back
   * to the browser's default behavior.
   */
  onAddAsset?: (file: File) => Promise<string | null>;
  /** Toggle Vim keybindings. */
  vimEnabled?: boolean;
  /**
   * Active collaboration session. When provided, the editor binds its text
   * source to the Yjs `Y.Text`; the `value` prop is ignored. Toggling collab
   * on/off should be done via React `key` to force a fresh editor.
   */
  collab?: CollabSession | null;
}

export interface EditorHandle {
  /** Insert text at the current selection and focus the editor. */
  insertText: (text: string) => void;
  focus: () => void;
}

const vimCompartment = new Compartment();

let vimExtensionPromise: Promise<unknown> | null = null;
async function loadVimExtension() {
  if (!vimExtensionPromise) {
    vimExtensionPromise = import("@replit/codemirror-vim").then((m) => m.vim());
  }
  return vimExtensionPromise;
}

/* ─── Ghost Text (Copilot-style inline completion) ─────────────── */

class GhostWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.style.opacity = "0.4";
    span.style.fontStyle = "italic";
    span.style.pointerEvents = "none";
    span.className = "cm-ghost-text";
    return span;
  }
  eq(other: GhostWidget) { return this.text === other.text; }
}

const setGhostText = StateEffect.define<{ pos: number; text: string } | null>();

interface GhostState {
  pos: number;
  text: string;
  decorations: DecorationSet;
}

const ghostField = StateField.define<GhostState | null>({
  create() { return null; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGhostText)) {
        if (!e.value) return null;
        const deco = Decoration.set([
          Decoration.widget({
            widget: new GhostWidget(e.value.text),
            side: 1,
          }).range(e.value.pos),
        ]);
        return { pos: e.value.pos, text: e.value.text, decorations: deco };
      }
    }
    // Clear ghost on any doc change or selection move
    if (value && (tr.docChanged || tr.selection)) return null;
    return value;
  },
  provide(f) {
    return EditorView.decorations.from(f, (v) => v?.decorations ?? Decoration.none);
  },
});

function ghostTextExtension(): Extension {
  let controller: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return [
    ghostField,
    keymap.of([
      {
        // Ctrl+Space → fetch AI ghost text
        key: "Ctrl-Space",
        run(view) {
          controller?.abort();
          if (debounceTimer) clearTimeout(debounceTimer);

          const pos = view.state.selection.main.head;
          const textBefore = view.state.doc.sliceString(
            Math.max(0, pos - 500), pos,
          );
          if (!textBefore.trim()) return false;

          debounceTimer = setTimeout(async () => {
            try {
              controller = new AbortController();
              const text = await chat(
                [
                  { role: "system", content: PROMPTS.autocomplete },
                  { role: "user", content: textBefore },
                ],
                { maxTokens: 15, signal: controller.signal },
              );
              if (text && view.state.selection.main.head === pos) {
                view.dispatch({ effects: setGhostText.of({ pos, text }) });
              }
            } catch {
              // Silently ignore abort / API errors for completions
            }
          }, 150);
          return true;
        },
      },
      {
        // Tab → accept ghost text
        key: "Tab",
        run(view) {
          const ghost = view.state.field(ghostField);
          if (!ghost) return false;
          view.dispatch({
            changes: { from: ghost.pos, insert: ghost.text },
            selection: { anchor: ghost.pos + ghost.text.length },
            effects: setGhostText.of(null),
          });
          return true;
        },
      },
      {
        // Escape → dismiss ghost text
        key: "Escape",
        run(view) {
          const ghost = view.state.field(ghostField);
          if (!ghost) return false;
          view.dispatch({ effects: setGhostText.of(null) });
          return true;
        },
      },
    ]),
  ];
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { value, onChange, onAddAsset, vimEnabled = false, collab = null },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onAddAssetRef = useRef(onAddAsset);
  onAddAssetRef.current = onAddAsset;
  // When the parent pushes a new value into the editor (file open),
  // we want to suppress the resulting onChange notification.
  const syncingRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      insertText(text: string) {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },
      focus() {
        viewRef.current?.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    if (!hostRef.current) return;

    const imageDropPasteHandlers = EditorView.domEventHandlers({
      paste(event, view) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.kind === "file" && it.type.startsWith("image/")) {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length === 0) return false;
        event.preventDefault();
        void handleAssetFiles(view, files);
        return true;
      },
      drop(event, view) {
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return false;
        const files = Array.from(dt.files).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        void handleAssetFiles(view, files);
        return true;
      },
    });

    // Build the extension list, optionally binding Yjs collaboration.
    // We dynamic-import y-codemirror.next so it stays out of the main bundle.
    const collabExtensionsPromise = collab
      ? import("y-codemirror.next").then((m) => {
          // Pass awareness for cursor sharing; let the binding create its own
          // UndoManager (default behavior).
          return [m.yCollab(collab.ytext, collab.awareness)];
        })
      : Promise.resolve([] as unknown[]);

    const initialDoc = collab ? collab.ytext.toString() : value;

    const baseExtensions = [
      vimCompartment.of([]),
      lineNumbers(),
      history(),
      bracketMatching(),
      indentOnInput(),
      highlightActiveLine(),
      search({ top: true }),
      ghostTextExtension(),
      closeBrackets(),
      syntaxHighlighting(mdHighlight),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        addKeymap: true,
      }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true" }),
      imageDropPasteHandlers,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !syncingRef.current) {
          onChangeRef.current(u.state.doc.toString());
        }
      }),
    ];

    const startState = EditorState.create({
      doc: initialDoc,
      extensions: baseExtensions,
    });

    async function handleAssetFiles(view: EditorView, files: File[]) {
      const onAsset = onAddAssetRef.current;
      const inserts: string[] = [];
      for (const f of files) {
        let url: string | null = null;
        if (onAsset) {
          try {
            url = await onAsset(f);
          } catch {
            url = null;
          }
        }
        if (!url) {
          // Fallback: inline as base64 data URL.
          url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(f);
          });
        }
        const alt = f.name.replace(/\.[^.]+$/, "");
        inserts.push(`![${alt}](${url})`);
      }
      const text = inserts.join("\n\n") + "\n";
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
    }

    const view = new EditorView({ state: startState, parent: hostRef.current });
    viewRef.current = view;

    // Attach the collab extension once it's loaded.
    let cancelled = false;
    void collabExtensionsPromise.then((extras) => {
      if (cancelled || !viewRef.current || extras.length === 0) return;
      // Append the collab extension via a fresh state with all extensions.
      const newState = EditorState.create({
        doc: viewRef.current.state.doc,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extensions: [...baseExtensions, ...(extras as any)],
      });
      syncingRef.current = true;
      try {
        viewRef.current.setState(newState);
      } finally {
        syncingRef.current = false;
      }
    });

    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep editor in sync if value is set externally (e.g. file open).
  // When collab is active, the Yjs binding owns the document; ignore parent
  // value updates that came from our own onChange.
  useEffect(() => {
    if (collab) return;
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    syncingRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    } finally {
      syncingRef.current = false;
    }
  }, [value, collab]);

  // Toggle Vim keybindings on demand without recreating the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let cancelled = false;
    (async () => {
      const ext = vimEnabled ? await loadVimExtension() : [];
      if (cancelled || !viewRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      view.dispatch({ effects: vimCompartment.reconfigure(ext as any) });
    })();
    return () => {
      cancelled = true;
    };
  }, [vimEnabled]);

  return <div ref={hostRef} className="h-full overflow-hidden" />;
});
