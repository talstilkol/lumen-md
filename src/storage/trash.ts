/**
 * Trash (MASTER_PLAN v3, T46): deleting a note or folder moves it to
 * `.trash/` in the vault instead of destroying it. Restorable from the
 * Trash panel or with "Undo" right after; emptied after 30 days.
 *
 * Layout: `.trash/<id>/<original base name>` plus `.trash/index.json`
 * (`{ id, originalPath, trashedAt, kind }[]`). Dot folders are hidden from
 * the file tree, search and the index.
 */

import {
  basename,
  deleteWorkspaceFile,
  readWorkspaceFile,
  renameWorkspaceFile,
  uniqueWorkspaceName,
  workspaceHasEntry,
  writeWorkspaceFile,
} from "./workspace";

export const TRASH_DIR = ".trash";
const INDEX = `${TRASH_DIR}/index.json`;
export const TRASH_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export interface TrashItem {
  id: string;
  originalPath: string;
  trashedAt: number;
  kind: "file" | "directory";
}

async function readIndex(): Promise<TrashItem[]> {
  try {
    const parsed = JSON.parse(await readWorkspaceFile(INDEX)) as unknown;
    return Array.isArray(parsed) ? (parsed as TrashItem[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(items: TrashItem[]): Promise<void> {
  await writeWorkspaceFile(INDEX, JSON.stringify(items, null, 1));
}

/** Items in the trash, newest first. */
export async function listTrash(): Promise<TrashItem[]> {
  return (await readIndex()).sort((a, b) => b.trashedAt - a.trashedAt);
}

let lastTrashed: TrashItem[] = [];
/** What the last `moveToTrash` call trashed (for "Undo"). */
export function lastTrashedItems(): TrashItem[] {
  return lastTrashed;
}

/** Move files / folders to the trash. Returns the trash entries. */
export async function moveToTrash(paths: string[], kinds: Record<string, "file" | "directory"> = {}, now = Date.now()): Promise<TrashItem[]> {
  const items = await readIndex();
  const added: TrashItem[] = [];
  for (const path of paths) {
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await renameWorkspaceFile(path, `${TRASH_DIR}/${id}/${basename(path)}`);
    const item: TrashItem = { id, originalPath: path, trashedAt: now, kind: kinds[path] ?? (/\.[^/]+$/.test(path) ? "file" : "directory") };
    items.push(item);
    added.push(item);
  }
  await writeIndex(items);
  lastTrashed = added;
  return added;
}

/**
 * Put a trashed item back at its original path, or next to it under a free
 * name when something new took that path. Returns where it went.
 */
export async function restoreFromTrash(id: string): Promise<string> {
  const items = await readIndex();
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error("Not in the trash");
  let target = item.originalPath;
  if (await workspaceHasEntry(target)) {
    if (item.kind === "file") target = await uniqueWorkspaceName(target);
    else {
      let n = 2;
      while (await workspaceHasEntry(`${item.originalPath} ${n}`)) n++;
      target = `${item.originalPath} ${n}`;
    }
  }
  await renameWorkspaceFile(`${TRASH_DIR}/${id}/${basename(item.originalPath)}`, target);
  await deleteWorkspaceFile(`${TRASH_DIR}/${id}`).catch(() => undefined);
  await writeIndex(items.filter((i) => i.id !== id));
  lastTrashed = lastTrashed.filter((i) => i.id !== id);
  return target;
}

/** Delete for good: one item, or everything older than `olderThanMs`. */
export async function emptyTrash(opts: { id?: string; olderThanMs?: number } = {}, now = Date.now()): Promise<number> {
  const items = await readIndex();
  const doomed = items.filter((i) => (opts.id ? i.id === opts.id : now - i.trashedAt >= (opts.olderThanMs ?? 0)));
  for (const i of doomed) await deleteWorkspaceFile(`${TRASH_DIR}/${i.id}`).catch(() => undefined);
  await writeIndex(items.filter((i) => !doomed.includes(i)));
  return doomed.length;
}

/** Startup housekeeping: drop items older than 30 days. */
export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  return emptyTrash({ olderThanMs: TRASH_KEEP_MS }, now);
}
