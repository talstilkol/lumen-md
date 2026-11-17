/**
 * The source editor's window events (W10.E29): mobile inserts and toolbar
 * actions, dictation, plugin inserts and selection reads, palette paste,
 * the PDF Hebrew fix, reveal-line and read-aloud highlights. Moved verbatim
 * out of Editor.tsx for the 800-line limit (W6.25); each effect listens on
 * window and acts on the current view.
 */
import { readyToReveal, revealSelection } from "./revealLine";
import { useEffect, type RefObject } from "react";
import { wysiwygTakesPaste, type PasteDetail } from "../paste/pasteCommands";
import { FIX_PDF_HEBREW_EVENT, fixSourceSelection } from "../paste/pdfPaste";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { actionById, applyTextAction, type ToolbarActionId } from "../mobile/toolbarActions";
import { showSpokenRange, showSpokenWord } from "./speechHighlight";

export function useSourceEditorEvents(viewRef: RefObject<EditorView | null>, assetFilesRef: RefObject<((view: EditorView, files: File[]) => Promise<void>) | null>): void {
  // Mobile shortcut bar dispatches `lumen-mobile-insert` events. Listen at
  // window level so we receive them regardless of which surface dispatched.
  useEffect(() => {
    function onInsert(e: Event) {
      const view = viewRef.current;
      if (!view) return;
      const detail = (e as CustomEvent<{ insert: string; cursorOffset: number }>).detail;
      if (!detail?.insert) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: detail.insert },
        selection: { anchor: from + detail.insert.length + (detail.cursorOffset ?? 0) },
      });
      view.focus();
    }
    window.addEventListener("lumen-mobile-insert", onInsert);
    return () => window.removeEventListener("lumen-mobile-insert", onInsert);
  }, []);

  // Live dictation (plan 6.1): `lumen-dictation-insert` {text} inserts a
  // finished segment at the cursor with one separating space;
  // `lumen-dictation-undo` {text} removes it again when it is still right
  // before the cursor ("delete that"). preventDefault() tells the sender
  // the editor handled it; `detail.inserted` is what was actually inserted.
  useEffect(() => {
    function onDictation(e: Event) {
      const view = viewRef.current;
      const detail = (e as CustomEvent<{ text: string; inserted?: string }>).detail;
      const text = detail?.text;
      if (!view || !text) return;
      e.preventDefault();
      const { from, to } = view.state.selection.main;
      if (e.type === "lumen-dictation-undo") {
        if (view.state.sliceDoc(Math.max(0, from - text.length), from) === text) view.dispatch({ changes: { from: from - text.length, to: from, insert: "" } });
        return;
      }
      const before = from > 0 ? view.state.sliceDoc(from - 1, from) : "";
      const insert = before && !/\s/.test(before) && !/^[\s.,?!:)]/.test(text) ? " " + text : text;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
      detail.inserted = insert; // what to remove on "delete that"
    }
    window.addEventListener("lumen-dictation-insert", onDictation);
    window.addEventListener("lumen-dictation-undo", onDictation);
    return () => {
      window.removeEventListener("lumen-dictation-insert", onDictation);
      window.removeEventListener("lumen-dictation-undo", onDictation);
    };
  }, []);

  // Plugins (plan 11.2): `lumen-plugin-insert` {text} replaces the selection
  // with the text; `lumen-editor-selection` fills detail.result with the
  // selection. preventDefault() tells the sender the editor handled it.
  useEffect(() => {
    function onPluginInsert(e: Event) {
      const view = viewRef.current;
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (!view || typeof text !== "string") return;
      e.preventDefault();
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    }
    // Plugin API 1.1.0 (W13.L1): `lumen-plugin-edits` {edits} — validated, sorted, in the coordinates of the text before the batch: one transaction, one undo step.
    function onPluginEdits(e: Event) {
      const view = viewRef.current;
      const edits = (e as CustomEvent<{ edits?: { from: number; to: number; insert: string }[] }>).detail?.edits;
      if (!view || !Array.isArray(edits) || edits.some((x) => x.to > view.state.doc.length)) return;
      e.preventDefault();
      view.dispatch({ changes: edits.map((x) => ({ from: x.from, to: x.to, insert: x.insert })), userEvent: "input.plugin" });
    }
    function onSelection(e: Event) {
      const view = viewRef.current;
      const detail = (e as CustomEvent<{ result?: { from: number; to: number; text: string } | null }>).detail;
      if (!view || !detail) return;
      const { from, to } = view.state.selection.main;
      detail.result = { from, to, text: view.state.sliceDoc(from, to) };
    }
    window.addEventListener("lumen-plugin-insert", onPluginInsert);
    window.addEventListener("lumen-editor-selection", onSelection);
    window.addEventListener("lumen-plugin-edits", onPluginEdits);
    return () => {
      window.removeEventListener("lumen-plugin-edits", onPluginEdits);
      window.removeEventListener("lumen-plugin-insert", onPluginInsert);
      window.removeEventListener("lumen-editor-selection", onSelection);
    };
  }, []);

  // W1.4 — "Paste as plain text" / "Paste with formatting" from the palette,
  // when the WYSIWYG editor is not the one showing.
  useEffect(() => {
    function onPaste(e: Event) {
      const view = viewRef.current;
      const detail = (e as CustomEvent<PasteDetail>).detail;
      if (!view || !detail || wysiwygTakesPaste()) return;
      const insert = detail.mode === "plain" ? detail.text : detail.markdown;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.paste" });
      view.focus();
    }
    window.addEventListener("lumen-paste", onPaste);
    return () => window.removeEventListener("lumen-paste", onPaste);
  }, []);

  // The mobile toolbar (plan W1.25) sends `lumen-mobile-action` {id}. Text
  // actions are one transaction each, so one undo takes one back.
  useEffect(() => {
    function onAction(e: Event) {
      const view = viewRef.current;
      const id = (e as CustomEvent<{ id: ToolbarActionId }>).detail?.id;
      const action = id ? actionById(id) : undefined;
      if (!view || !action) return;
      if (action.kind === "history") {
        (id === "undo" ? undo : redo)(view);
      } else if (action.kind === "keyboard") {
        view.contentDOM.blur();
        return;
      } else if (action.kind === "image") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.multiple = true;
        input.onchange = () => {
          const files = Array.from(input.files ?? []);
          if (files.length && assetFilesRef.current) void assetFilesRef.current(view, files);
        };
        input.click();
        return;
      } else {
        const { from, to } = view.state.selection.main;
        const edit = applyTextAction(id!, view.state.doc.toString(), from, to);
        if (edit && (edit.changes.length || edit.anchor !== from || edit.head !== to)) {
          view.dispatch({
            changes: edit.changes,
            selection: { anchor: edit.anchor, head: edit.head },
            scrollIntoView: true,
            userEvent: "input.mobile-toolbar",
          });
        }
      }
      view.focus();
    }
    window.addEventListener("lumen-mobile-action", onAction);
    return () => window.removeEventListener("lumen-mobile-action", onAction);
  }, []);

  // W5.5 — "Fix reversed Hebrew (from a PDF)" on the selection, from the palette.
  useEffect(() => {
    function onFix(e: Event) {
      const view = viewRef.current;
      const done = (e as CustomEvent<{ done: (message: string | null) => void }>).detail?.done;
      if (!view || !done || wysiwygTakesPaste()) return;
      done(fixSourceSelection(view));
    }
    window.addEventListener(FIX_PDF_HEBREW_EVENT, onFix);
    return () => window.removeEventListener(FIX_PDF_HEBREW_EVENT, onFix);
  }, []);

  // `lumen-reveal-line` {line} (1-based): jump to and select that line —
  // used by vault citations (T29). With `content` it waits until the
  // just-opened note has actually loaded into the editor.
  useEffect(() => {
    function onReveal(e: Event) {
      // `select: false` (a tap on reading view, W1.25) puts the cursor at the line's end instead of selecting it.
      // `endLine` (W12.A1, a cited paragraph) selects through the end of that line.
      const detail = (e as CustomEvent<{ line: number; endLine?: number; content?: string; select?: boolean }>).detail;
      const line = detail?.line;
      if (!line || line < 1) return;
      let tries = 0;
      const go = () => {
        const view = viewRef.current;
        // Wait for the opened note itself (not the previous one); after
        // ~2 s fall back to whatever is shown.
        const ready = !!view && readyToReveal(view.state.doc, line, tries < 20 ? detail.content : undefined);
        if (!view || !ready) {
          if (tries++ < 20) setTimeout(go, 100);
          return;
        }
        const l = view.state.doc.line(line);
        view.dispatch({ selection: revealSelection(view.state.doc, line, detail.endLine, detail.select !== false), effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
        view.focus();
      };
      go();
    }
    window.addEventListener("lumen-reveal-line", onReveal);
    return () => window.removeEventListener("lumen-reveal-line", onReveal);
  }, []);

  // `lumen-speech-range` {from, to} | null: highlight and show the sentence
  // being read aloud (T32) — a decoration, not the selection, so typing
  // during playback can't replace the sentence; null clears it.
  useEffect(() => {
    function onSelect(e: Event) {
      const view = viewRef.current;
      if (!view) return;
      showSpokenRange(view, (e as CustomEvent<{ from: number; to: number } | null>).detail ?? null);
    }
    // `lumen-speech-word` {from, to} | null: the word inside it (plan W5.6).
    function onWord(e: Event) {
      const view = viewRef.current;
      if (!view) return;
      showSpokenWord(view, (e as CustomEvent<{ from: number; to: number } | null>).detail ?? null);
    }
    window.addEventListener("lumen-speech-range", onSelect);
    window.addEventListener("lumen-speech-word", onWord);
    return () => {
      window.removeEventListener("lumen-speech-range", onSelect);
      window.removeEventListener("lumen-speech-word", onWord);
    };
  }, []);
}
