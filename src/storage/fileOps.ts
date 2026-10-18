/**
 * Safe file operations for the UI (T46): moves that never silently
 * replace a note and that keep links working, and deletes that go to the
 * trash with an Undo.
 */

import { listTrash, moveToTrash, restoreFromTrash, restoreFromTrashIfPresent, type TrashItem } from "./trash";
import { rewriteLinks, updateLinksAfterMove } from "./linkRewrite";
import { listWorkspace, renameWorkspaceFile, WorkspaceConflictError, workspaceHasEntry } from "./workspace";

export interface MoveResult {
  /** Where the entry is now. */
  path: string;
  /** Notes whose links were rewritten. */
  linksUpdated: string[];
  /** The entry that was at the target and went to the trash (overwrite). */
  replaced?: TrashItem;
  /** The move happened, but rewriting links failed part way (e.g. quota). */
  linksError?: Error;
  /**
   * Apply the same link rewrite to a note's text held in memory (an open
   * tab), given where that note was before the move.
   */
  rewrite: (content: string, notePrevPath: string) => string;
}

/** Where `path` is after `from` moved to `to` (folders take their contents along), or null. */
export function movedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (path.startsWith(from + "/")) return to + path.slice(from.length);
  return null;
}

/**
 * Move `from` to `to`. When something is already at `to`, asks
 * `confirmReplace(to)`; on yes the existing entry goes to the trash (so even
 * an overwrite is undoable), on no the move is cancelled (returns null).
 */
export async function safeMove(
  from: string,
  to: string,
  opts: { folder?: boolean; confirmReplace?: (path: string) => Promise<boolean> } = {},
): Promise<MoveResult | null> {
  if (from === to) return { path: to, linksUpdated: [], rewrite: (c) => c };
  let replaced: TrashItem | undefined;
  // Short `[[Name]]` links resolve against the vault as it was.
  const vault = (await listWorkspace()).map((f) => f.path).filter((p) => /\.(md|markdown)$/i.test(p));
  if (await workspaceHasEntry(to)) {
    if (!opts.confirmReplace || !(await opts.confirmReplace(to))) return null;
    [replaced] = await moveToTrash([to]);
  }
  try {
    await renameWorkspaceFile(from, to);
  } catch (e) {
    if (replaced) await restoreFromTrash(replaced.id).catch(() => undefined);
    if (e instanceof WorkspaceConflictError) return null;
    throw e;
  }
  // The entry has moved: report that even when a link rewrite fails, so
  // the caller still retargets the open note instead of autosaving it back
  // to the old path.
  let linksUpdated: string[] = [];
  let linksError: Error | undefined;
  try {
    linksUpdated = await updateLinksAfterMove(from, to, { folder: opts.folder, vault });
  } catch (e) {
    linksError = e instanceof Error ? e : new Error(String(e));
  }
  window.dispatchEvent(new Event("lumen-workspace-changed"));
  const rewrite = (content: string, notePrevPath: string) =>
    rewriteLinks(content, movedPath(notePrevPath, from, to) ?? notePrevPath, from, to, { folder: opts.folder, notePrevPath, vault });
  return { path: to, linksUpdated, replaced, linksError, rewrite };
}

/**
 * The last deletes, oldest first, for Ctrl+Z outside the editor (plan 3.1).
 * One entry per delete action (a bulk delete is one entry). Runtime only:
 * after a reload the Trash panel still has everything.
 */
export const TRASH_UNDO_LIMIT = 20;
const undoStack: TrashItem[][] = [];

/** How many deletes Ctrl+Z can still undo (entries restored elsewhere are counted until the next undo skips them). */
export function trashUndoDepth(): number {
  return undoStack.length;
}

/** Test hook. */
export function __resetTrashUndo(): void {
  undoStack.length = 0;
}

/** These items are back (or being brought back): no stack entry may restore them again. */
function forgetUndo(items: TrashItem[]): void {
  const ids = new Set(items.map((i) => i.id));
  for (let n = undoStack.length - 1; n >= 0; n--) {
    const rest = undoStack[n].filter((i) => !ids.has(i.id));
    if (rest.length) undoStack[n] = rest;
    else undoStack.splice(n, 1);
  }
}

// Undos run one at a time, so each press pops (and restores) its own entry
// in order. The trash index itself is guarded in trash.ts, where deletes,
// restores and the Trash panel all go through one queue.
let restoring: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = restoring.then(fn, fn);
  restoring = run.catch(() => undefined);
  return run;
}

/** Restore the given entries that are still in the trash (the Trash panel may have restored or purged some). */
async function restoreItems(items: TrashItem[]): Promise<string[]> {
  const out: string[] = [];
  try {
    for (const i of items) {
      const where = await restoreFromTrashIfPresent(i.id);
      if (where !== null) out.push(where);
    }
  } finally {
    window.dispatchEvent(new Event("lumen-workspace-changed"));
  }
  return out;
}

/** Delete = move to the trash. Returns the trash entries for Undo (and remembers them for Ctrl+Z). */
export async function trashPaths(paths: string[], kinds: Record<string, "file" | "directory"> = {}): Promise<TrashItem[]> {
  const items = await moveToTrash(paths, kinds);
  if (items.length) {
    undoStack.push(items);
    if (undoStack.length > TRASH_UNDO_LIMIT) undoStack.splice(0, undoStack.length - TRASH_UNDO_LIMIT);
  }
  window.dispatchEvent(new Event("lumen-workspace-changed"));
  return items;
}

/** Undo a delete: restore every given entry still in the trash. Returns where they went. */
export async function undoTrash(items: TrashItem[]): Promise<string[]> {
  forgetUndo(items);
  return oneAtATime(() => restoreItems(items));
}

/**
 * Ctrl+Z outside the editor: restore the most recent delete that is still
 * in the trash and drop it from the stack, so the next call restores the one
 * before. Resolves to where the entries went, or null when there is nothing
 * left to undo. When a restore fails, what is still in the trash stays on
 * the stack for another try.
 */
export function undoLastTrash(): Promise<string[] | null> {
  return oneAtATime(async () => {
    while (undoStack.length) {
      const entry = undoStack.pop()!;
      try {
        const restored = await restoreItems(entry);
        // Nothing of it was left in the trash: undo the delete before it.
        if (restored.length) return restored;
      } catch (e) {
        const left = new Set((await listTrash().catch(() => [])).map((i) => i.id));
        const keep = entry.filter((i) => left.has(i.id));
        if (keep.length) undoStack.push(keep);
        throw e;
      }
    }
    return null;
  });
}
