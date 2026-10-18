/**
 * Keep the documents held in memory (the active note and the open tabs)
 * consistent with file operations on the vault (T46 review fixes).
 */

import { flushPendingEdits, notifyTabIdChange, tabIdOf, useAppStore } from "./useStore";
import { writeWorkspaceFile } from "../storage/workspace";
import { notifyWorkspaceChanged } from "../storage/workspaceEvents";
import { movedPath } from "../storage/fileOps";

/**
 * Write the active workspace note now if it has edits the debounced
 * autosave has not written yet — before an operation that reads or moves
 * the file on disk (trash, export).
 */
export async function flushActiveWorkspaceDoc(): Promise<void> {
  flushPendingEdits();
  const d = useAppStore.getState().doc;
  if (!d.dirty || !d.workspaceName) return;
  const { workspaceName: name, content } = d;
  await writeWorkspaceFile(name, content);
  const now = useAppStore.getState().doc;
  if (now.workspaceName === name && now.content === content) useAppStore.getState().markSaved();
  notifyWorkspaceChanged({ kind: "content", paths: [name] });
}

/**
 * After `from` moved to `to`: open notes inside the moved entry take their
 * new path (so autosave does not recreate the old one), and every open
 * note's text gets the same link rewrite the files on disk got (so a tab
 * switch or autosave does not write the old links back). Dirty state is kept.
 */
export function syncOpenDocsAfterMove(from: string, to: string, rewrite: (content: string, notePrevPath: string) => string): void {
  flushPendingEdits();
  const fix = (ws: string | null | undefined, content: string) => {
    if (!ws) return null;
    const path = movedPath(ws, from, to) ?? ws;
    const text = /\.(md|markdown)$/i.test(ws) ? rewrite(content, ws) : content;
    return path === ws && text === content ? null : { path, text };
  };
  const renamed = new Map<string, string>();
  useAppStore.setState((state) => {
    const openTabs = state.openTabs.map((t) => {
      const f = fix(t.workspaceName, t.content);
      if (!f) return t;
      const id = tabIdOf({ workspaceName: f.path, name: f.path });
      renamed.set(t.id, id);
      return { ...t, id, name: t.name === t.workspaceName ? f.path : t.name, workspaceName: f.path, content: f.text };
    });
    const d = state.doc;
    const f = fix(d.workspaceName, d.content);
    const doc = f ? { ...d, name: d.name === d.workspaceName ? f.path : d.name, workspaceName: f.path, content: f.text } : d;
    if (f) renamed.set(tabIdOf(d), tabIdOf(doc));
    return { doc, openTabs };
  });
  for (const [from, to] of renamed) notifyTabIdChange(from, to);
}
