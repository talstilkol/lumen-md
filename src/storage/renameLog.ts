/**
 * Renames and moves, remembered (plan W13.S1): the "Deleted and renamed
 * files" screen lists them next to the trash, so a note that seems to have
 * vanished can be found under its new name and put back where it was.
 *
 * Stored in the vault, beside the trash index (`.trash/renames.json`): dot
 * folders are hidden from the file tree, search and the index, and the log
 * travels with the vault. The newest RENAME_LOG_LIMIT entries of the last
 * 30 days (the trash's TRASH_KEEP_MS) are kept.
 */

import { readWorkspaceFile, workspaceHasEntry, writeWorkspaceFile } from "./workspace";
import { VaultNotFoundError } from "./vault/types";
import { swallowed } from "../lib/logger";

/** The trash's folder (./trash.ts TRASH_DIR) and its 30 days: the log lives and expires beside it. */
const TRASH_DIR = ".trash";
const TRASH_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const FILE = `${TRASH_DIR}/renames.json`;
export const RENAME_LOG_LIMIT = 500;

export interface RenameEntry {
  id: string;
  from: string;
  to: string;
  at: number;
  folder?: boolean;
}

async function read(): Promise<RenameEntry[]> {
  try {
    const parsed = JSON.parse(await readWorkspaceFile(FILE)) as unknown;
    return Array.isArray(parsed) ? (parsed as RenameEntry[]).filter((e) => e && typeof e.from === "string" && typeof e.to === "string") : [];
  } catch (e) {
    if (!(e instanceof VaultNotFoundError)) swallowed("storage/renameLog: the rename log could not be read; it shows as empty", e);
    return [];
  }
}

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Remember that `from` became `to`. Never throws: a log that can't be written loses only the log. */
export function recordRename(from: string, to: string, folder = false, now = Date.now()): Promise<void> {
  if (from === to || from.startsWith(TRASH_DIR + "/") || to.startsWith(TRASH_DIR + "/")) return Promise.resolve();
  return serialized(async () => {
    const list = (await read()).filter((e) => now - e.at < TRASH_KEEP_MS);
    list.push({ id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, from, to, at: now, ...(folder ? { folder } : {}) });
    await writeWorkspaceFile(FILE, JSON.stringify(list.slice(-RENAME_LOG_LIMIT), null, 1));
  }).catch((e: unknown) => swallowed("storage/renameLog: a rename could not be logged; the rename itself happened", e));
}

/** The renames of the last 30 days, newest first. */
export async function listRenames(now = Date.now()): Promise<RenameEntry[]> {
  return (await read()).filter((e) => now - e.at < TRASH_KEEP_MS).sort((a, b) => b.at - a.at);
}

/** Drop entries from the log (after they were undone). */
export function forgetRenames(ids: readonly string[]): Promise<void> {
  const drop = new Set(ids);
  return serialized(async () => {
    const list = await read();
    const keep = list.filter((e) => !drop.has(e.id));
    if (keep.length !== list.length) await writeWorkspaceFile(FILE, JSON.stringify(keep, null, 1));
  });
}

/** Whether an entry can be undone now: its new path still exists and its old one is free. */
export async function canUndoRename(e: RenameEntry): Promise<boolean> {
  return (await workspaceHasEntry(e.to)) && !(await workspaceHasEntry(e.from));
}
