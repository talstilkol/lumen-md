/**
 * Keep the documents held in memory (the active note and the open tabs)
 * consistent with file operations on the vault (T46 review fixes).
 */

import { flushPendingEdits, tabIdOf, useAppStore } from "./useStore";
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
export function syncOpenDocsAfterMove(
  from: string,
  to: string,
  rewrite: (content: string, notePrevPath: string) => string,
  /** The entry the move overwrote (it went to the trash), when there was one. */
  replaced?: string | null,
): void {
  flushPendingEdits();
  const under = (ws: string, root: string) => ws === root || ws.startsWith(root + "/");
  // An open note at the overwritten path still claims it: detach it first, or
  // its next autosave writes over the note that just moved there and two
  // tabs share one id.
  const wasReplaced = (ws: string | null | undefined): boolean => !!replaced && !!ws && under(ws, replaced) && !under(ws, from);
  const fix = (ws: string | null | undefined, content: string) => {
    if (!ws) return null;
    const path = movedPath(ws, from, to) ?? ws;
    const text = /\.(md|markdown)$/i.test(ws) ? rewrite(content, ws) : content;
    return path === ws && text === content ? null : { path, text };
  };
  useAppStore.setState((state) => {
    const taken = new Set<string>();
    const detachedName = (ws: string) => {
      const file = ws.split("/").pop() || ws;
      const stem = file.replace(/(\.[^./]+)$/, "");
      const ext = file.slice(stem.length) || ".md";
      let name = file;
      for (let i = 2; taken.has(name) || state.openTabs.some((t) => t.id === name); i++) name = `${stem} ${i}${ext}`;
      taken.add(name);
      return name;
    };
    const detached = new Map<string, string>(); // old path → ad-hoc name
    const openTabs = state.openTabs.map((t) => {
      if (t.workspaceName && wasReplaced(t.workspaceName)) {
        // Kept as an ad-hoc note: its text (unsaved edits included) is not lost; the file itself is in the trash.
        const name = detachedName(t.workspaceName);
        detached.set(t.workspaceName, name);
        return { ...t, id: name, name, workspaceName: null };
      }
      const f = fix(t.workspaceName, t.content);
      return f ? { ...t, id: tabIdOf({ workspaceName: f.path, name: f.path }), name: t.name === t.workspaceName ? f.path : t.name, workspaceName: f.path, content: f.text } : t;
    });
    const d = state.doc;
    let doc = d;
    if (d.workspaceName && wasReplaced(d.workspaceName)) {
      const name = detached.get(d.workspaceName) ?? detachedName(d.workspaceName);
      doc = { ...d, name, workspaceName: null, handle: undefined };
    } else {
      const f = fix(d.workspaceName, d.content);
      if (f) doc = { ...d, name: d.name === d.workspaceName ? f.path : d.name, workspaceName: f.path, content: f.text };
    }
    return { doc, openTabs };
  });
}
