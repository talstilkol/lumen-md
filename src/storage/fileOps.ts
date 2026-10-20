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

/**
 * The file name a rename ends up with. A name typed without an extension
 * keeps the file's own: a note gets `.md`, but `paper.pdf` renamed to
 * `draft` stays a PDF (`draft.pdf`), not `draft.md` (plan 4.14).
 */
export function renamedFileName(oldPath: string, typed: string): string {
  if (/\.[^./]+$/.test(typed)) return typed;
  const ext = oldPath.match(/\.[^./]+$/)?.[0] ?? "";
  return typed + (ext && !/^\.(md|markdown)$/i.test(ext) ? ext : ".md");
}

/** The highlights note that belongs to a PDF (`<file>.pdf.md`, plan 4.14), or null for other files. */
export function companionNoteOf(path: string): string | null {
  return /\.pdf$/i.test(path) ? `${path}.md` : null;
}

/**
 * `safeMove` for a file that has a companion note (a PDF and its
 * `<file>.pdf.md`): both move together. Both destinations are checked first,
 * so a declined replace leaves both files where they were; if the note's
 * move then fails, the file is moved back (and anything it replaced comes
 * back from the trash). Without a companion — or when `alsoMoving` already
 * includes it — this is `safeMove`.
 */
export async function safeMoveWithCompanion(
  from: string,
  to: string,
  opts: { folder?: boolean; confirmReplace?: (path: string) => Promise<boolean>; alsoMoving?: ReadonlySet<string> } = {},
): Promise<{ main: MoveResult; companion: MoveResult | null } | null> {
  const note = opts.folder ? null : companionNoteOf(from);
  if (!note || from === to || opts.alsoMoving?.has(note) || !(await workspaceHasEntry(note))) {
    const main = await safeMove(from, to, opts);
    return main ? { main, companion: null } : null;
  }
  const noteTo = `${to}.md`;
  // Ask about both replacements before anything moves.
  const confirmed = new Set<string>();
  for (const target of [to, noteTo]) {
    if (!(await workspaceHasEntry(target))) continue;
    if (!opts.confirmReplace || !(await opts.confirmReplace(target))) return null;
    confirmed.add(target);
  }
  const already = (p: string) => Promise.resolve(confirmed.has(p));
  const main = await safeMove(from, to, { confirmReplace: already });
  if (!main) return null;
  let companion: MoveResult | null = null;
  let failure: unknown = null;
  try {
    companion = await safeMove(note, noteTo, { confirmReplace: already });
  } catch (e) {
    failure = e;
  }
  if (companion) return { main, companion };
  // Put the file back where it was, next to its note.
  await safeMove(to, from);
  if (main.replaced) await restoreFromTrash(main.replaced.id).catch(() => undefined);
  if (failure) throw failure;
  return null;
}
