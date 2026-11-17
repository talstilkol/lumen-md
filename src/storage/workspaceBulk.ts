/**
 * Batch reads and conditional writes for bulk edits (W7.4, W10.F23/E51): many
 * notes in one Blob read, and a write that refuses if the file changed since
 * it was read. Split from workspace.ts so it loads with the bulk edit, not at
 * startup (222 KB ceiling, train 6).
 */
import { splitPath } from "./vault/shared";
import { noteSealer } from "./lockedNotesRegistry";
import { readText } from "./textCodec";
import { vault, withPathLock, writeUnlocked } from "./workspace";

/** What a file was when it was read: a write that expects it refuses if the file changed since. */
export interface FileStamp {
  size: number;
  mtime: number;
}

/** Files joined into one Blob read: about 50 notes (measured fastest on OPFS), at most 4 MB. */
const BATCH_FILES = 50;
const BATCH_BYTES = 4 * 1024 * 1024;

/**
 * Many notes read at once (a bulk edit, plan W7.4), each with its stamp.
 * Reading a file's bytes is the slow part on OPFS (each read is its own
 * trip to the browser's storage process), while getting the File object is
 * cheap, so the files are joined into one Blob per few MB and each joined
 * Blob is read once, then split by the files' sizes. A path that can't be
 * read is missing from the result (the caller decides). Keeps a BOM, as
 * readWorkspaceFile does.
 */
export async function readWorkspaceTexts(paths: readonly string[]): Promise<Map<string, { text: string; stamp: FileStamp }>> {
  const out = new Map<string, { text: string; stamp: FileStamp }>();
  // A backend that can list each folder once (OPFS, a folder) hands over the files in one go.
  const many = await (vault().readMany?.(paths) ?? Promise.resolve(new Map<string, File>())).catch(() => new Map<string, File>());
  const got: Array<{ p: string; blob: Blob; stamp: FileStamp } | null> = [];
  // Paths the backend's batch did not cover, a few at a time (each read is a trip to storage).
  let nextPath = 0;
  const one = async (p: string) => {
    try {
      const blob = many.get(splitPath(p).join("/")) ?? (await vault().read(p));
      // A File (OPFS, a folder) carries its own size and time: no second lookup. Otherwise ask the backend.
      if (blob instanceof File && blob.lastModified) return { p, blob, stamp: { size: blob.size, mtime: blob.lastModified } };
      const st = await vault().stat(p);
      return st && st.kind === "file" && st.size === blob.size ? { p, blob, stamp: { size: st.size, mtime: st.mtime } } : null;
    } catch {
      // why: unreadable or gone: left out, and the caller says so
      return null;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(16, paths.length) }, async () => {
      while (nextPath < paths.length) {
        const i = nextPath++;
        got[i] = await one(paths[i]);
      }
    }),
  );
  const ok = got.filter((g): g is NonNullable<typeof g> => g !== null);
  const dec = new TextDecoder("utf-8", { ignoreBOM: true });
  const groups: (typeof ok)[] = [];
  let bytes = Infinity;
  for (const g of ok) {
    if (bytes + g.blob.size > BATCH_BYTES || (groups[groups.length - 1]?.length ?? 0) >= BATCH_FILES) {
      groups.push([]);
      bytes = 0;
    }
    groups[groups.length - 1].push(g);
    bytes += g.blob.size;
  }
  // One joined read at a time: the reads queue in one storage process anyway.
  for (const group of groups) {
    const all = new Uint8Array(await new Blob(group.map((g) => g.blob)).arrayBuffer());
    let at = 0;
    for (const g of group) {
      out.set(g.p, { text: dec.decode(all.subarray(at, at + g.blob.size)), stamp: g.stamp });
      at += g.blob.size;
    }
  }
  return out;
}

/**
 * Write `content` only if the file is still what `expect` says (same size
 * and modification time), checked under the path's write lock. False when
 * it changed or went: nothing is written then.
 */
export async function writeWorkspaceFileIf(path: string, content: string, expect: FileStamp): Promise<boolean> {
  return withPathLock(path, async () => {
    const st = await vault().stat(path);
    if (!st || st.kind !== "file" || st.size !== expect.size || st.mtime !== expect.mtime || !expect.mtime) return false;
    await writeUnlocked(path, content);
    return true;
  });
}

/**
 * Many stamped writes at once (plan W7.4), each under its path's lock: the
 * backend's `writeMany` when it has one (each folder looked up once), else
 * writeWorkspaceFileIf one by one. Per path: true written, false changed
 * since, or the error.
 */
export async function writeWorkspaceFilesIf(items: ReadonlyArray<{ path: string; content: string; expect: FileStamp }>): Promise<Map<string, boolean | Error>> {
  const backend = vault();
  const batch = backend.writeMany ? await backend.writeMany(items.map((i) => ({ path: i.path, data: i.content, expect: i.expect })), withPathLock) : null;
  if (batch) return batch;
  const out = new Map<string, boolean | Error>();
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++];
      try {
        out.set(it.path, await writeWorkspaceFileIf(it.path, it.content, it.expect));
      } catch (e) {
        out.set(it.path, e instanceof Error ? e : new Error(String(e)));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(32, items.length) }, worker));
  return out;
}

/** The file's text now (a BOM kept, as readWorkspaceFile does), null when nothing is there, false for a folder. */
async function textNow(path: string): Promise<string | null | false> {
  const st = await vault().stat(path);
  if (!st) return null;
  return st.kind === "file" ? readText(await vault().read(path)) : false;
}

/**
 * Review Z7-L1: write `content` only while the file's text is still `expect` (null: only while nothing is there).
 * The compare and the write hold the path's lock, the one every workspace write takes (a Web Lock, so other tabs
 * queue too), so an autosave cannot land between them. A note locked with its own password is sealed, as
 * writeWorkspaceFile does. False, writing nothing, when the file changed.
 */
export async function writeWorkspaceTextIf(path: string, content: string, expect: string | null): Promise<boolean> {
  return withPathLock(path, async () => {
    if ((await textNow(path)) !== expect) return false;
    const seal = noteSealer();
    await writeUnlocked(path, seal ? await seal(path, content) : content);
    return true;
  });
}

/** Review Z7-L1: remove the file only while its text is still `expect`, under the path's lock. */
export async function removeWorkspaceTextIf(path: string, expect: string): Promise<boolean> {
  return withPathLock(path, async () => {
    if ((await textNow(path)) !== expect) return false;
    await vault().remove(path);
    return true;
  });
}
