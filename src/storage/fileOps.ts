/**
 * Safe file operations for the UI (T46): moves that never silently
 * replace a note and that keep links working, and deletes that go to the
 * trash with an Undo.
 */

import { moveToTrash, restoreFromTrash, type TrashItem } from "./trash";
import { updateLinksAfterMove } from "./linkRewrite";
import { renameWorkspaceFile, WorkspaceConflictError, workspaceHasEntry } from "./workspace";

export interface MoveResult {
  /** Where the entry is now. */
  path: string;
  /** Notes whose links were rewritten. */
  linksUpdated: string[];
  /** The entry that was at the target and went to the trash (overwrite). */
  replaced?: TrashItem;
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
  if (from === to) return { path: to, linksUpdated: [] };
  let replaced: TrashItem | undefined;
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
  const linksUpdated = await updateLinksAfterMove(from, to, { folder: opts.folder });
  window.dispatchEvent(new Event("lumen-workspace-changed"));
  return { path: to, linksUpdated, replaced };
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
