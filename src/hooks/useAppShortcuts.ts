/**
 * The app's global keyboard shortcuts (⌘K, ⌘S, ⌘O, ⌘N, ⌘1–4, ⇧⌘F, ⌘⇧V …).
 * Moved out of App.tsx (plan 12.1); App calls this where the effect was.
 * The state setters and the editor ref, stable for the component's life,
 * are now listed as dependencies because they arrive as arguments.
 */
import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { EditorHandle } from "../editor/Editor";
import { openInsertTextDialog } from "../ui/InsertTextDialog";
import { useAppStore } from "../store/useStore";

type SetOpen = Dispatch<SetStateAction<boolean>>;

export interface AppShortcutsOptions {
  focusMode: boolean;
  setFocusMode: SetOpen;
  setPaletteOpen: SetOpen;
  setFindReplaceOpen: SetOpen;
  setShortcutsOpen: SetOpen;
  handleOpen: () => Promise<void>;
  handleSave: (saveAs?: boolean) => Promise<void>;
  handleNew: () => Promise<void>;
  editorRef: MutableRefObject<EditorHandle | null>;
}

export function useAppShortcuts({
  focusMode,
  setFocusMode,
  setPaletteOpen,
  setFindReplaceOpen,
  setShortcutsOpen,
  handleOpen,
  handleSave,
  handleNew,
  editorRef,
}: AppShortcutsOptions): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      // ⇧⌘F → focus mode toggle (or workspace search if already in focus mode)
      if (e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        if (focusMode) {
          setFocusMode(false);
        } else {
          setFocusMode(true);
        }
        return;
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void handleSave(e.shiftKey);
      } else if (e.key === "h" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setFindReplaceOpen((v) => !v);
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        void handleOpen();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        void handleNew();
      } else if (e.key === "1") {
        e.preventDefault();
        useAppStore.getState().setMode("source");
      } else if (e.key === "2") {
        e.preventDefault();
        useAppStore.getState().setMode("split");
      } else if (e.key === "3") {
        e.preventDefault();
        useAppStore.getState().setMode("preview");
      } else if (e.key === "4") {
        e.preventDefault();
        useAppStore.getState().setMode("wysiwyg");
      } else if (e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.shiftKey && (e.key === "v" || e.key === "V")) {
        // ⌘⇧V — Smart Insert (paste anything → auto-detect → wrap).
        e.preventDefault();
        void (async () => {
          const result = await openInsertTextDialog();
          if (!result) return;
          const cur = useAppStore.getState().doc.content;
          const setter = useAppStore.getState().setContent;
          if (result.mode === "replace") setter(result.markdown);
          else if (result.mode === "atCursor" && editorRef.current) {
            editorRef.current.insertText(result.markdown);
          } else {
            const trimmed = cur.endsWith("\n") ? cur : cur + "\n";
            setter(trimmed + (result.mode === "append" ? "\n" : "") + result.markdown);
          }
        })();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleOpen, handleSave, handleNew, focusMode, setFocusMode, setPaletteOpen, setFindReplaceOpen, setShortcutsOpen, editorRef]);
}
