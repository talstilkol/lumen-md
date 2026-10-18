/**
 * Safe file operations for the UI (T46): moves that never silently
 * replace a note and that keep links working, and deletes that go to the
 * trash with an Undo.
 */

import { moveToTrash, restoreFromTrash, type TrashItem } from "./trash";
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

/** Delete = move to the trash. Returns the trash entries for Undo. */
export async function trashPaths(paths: string[], kinds: Record<string, "file" | "directory"> = {}): Promise<TrashItem[]> {
  const items = await moveToTrash(paths, kinds);
  window.dispatchEvent(new Event("lumen-workspace-changed"));
  return items;
}

/** Undo a delete: restore every given entry. Returns where they went. */
export async function undoTrash(items: TrashItem[]): Promise<string[]> {
  const out: string[] = [];
  for (const i of items) out.push(await restoreFromTrash(i.id));
  window.dispatchEvent(new Event("lumen-workspace-changed"));
  return out;
}
