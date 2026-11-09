/**
 * Saves that happen without the user asking: the interval auto-save (disk
 * handle, or a new workspace file for an ad-hoc document) and the flush of
 * the pending workspace write when the page is hidden or closed. Moved out
 * of App.tsx unchanged (plan 12.1); App calls this where the effects were.
 */
import { useEffect } from "react";
import { useAppStore } from "../store/useStore";
import type { DocFile } from "../store/useStore";
import { historyKey, recordSnapshot } from "../storage/history";
import { log } from "../lib/logger";
import { writeWorkspaceFile } from "../storage/workspace";

export interface BackgroundSavesOptions {
  doc: DocFile;
  handleSave: (saveAs?: boolean) => Promise<void>;
  adoptIntoWorkspace: () => Promise<string | null>;
  markSaved: () => void;
}

export function useBackgroundSaves({ doc, handleSave, adoptIntoWorkspace, markSaved }: BackgroundSavesOptions): void {
  // Auto-save: save dirty documents on interval
  const autoSave = useAppStore((s) => s.autoSave);
  const autoSaveInterval = useAppStore((s) => s.autoSaveInterval);
  useEffect(() => {
    if (!autoSave || !doc.dirty) return;
    const timer = setInterval(() => {
      const d = useAppStore.getState().doc;
      if (!d.dirty) return;
      if (d.handle) {
        // From disk: write back through the handle (workspace files are
        // written by the debounced effect above).
        void handleSave(false);
      } else if (!d.workspaceName && d.content.trim()) {
        // Untitled / ad-hoc: until now these were never written anywhere
        // but localStorage. Give them a home in the workspace; from then
        // on the debounced workspace autosave owns them.
        adoptIntoWorkspace().catch((err) => log.warn("[autosave] adopt failed", (err as Error).message));
      }
    }, autoSaveInterval);
    return () => clearInterval(timer);
  }, [autoSave, autoSaveInterval, doc.dirty, handleSave, adoptIntoWorkspace]);

  // Flush the pending workspace write when the page is hidden or going
  // away: the debounced effect above may still be waiting, and a closed
  // tab (or a backgrounded phone) never runs it. `pagehide` is the last
  // reliable moment; `visibilitychange` covers mobile, where pages are
  // often frozen instead of unloaded. The localStorage mirror keeps the
  // text either way; this keeps the workspace file current.
  useEffect(() => {
    const flush = () => {
      const d = useAppStore.getState().doc;
      void recordSnapshot(historyKey(d), d.content, "close").catch(() => false);
      if (!d.dirty || !d.workspaceName) return;
      const name = d.workspaceName;
      writeWorkspaceFile(name, d.content)
        .then(() => {
          if (useAppStore.getState().doc.workspaceName === name) markSaved();
        })
        .catch(() => {
          /* why: best effort; the debounced autosave retries on the next edit */
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [markSaved]);
}
