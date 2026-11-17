/**
 * W11.Q10 (research R5.12): every OPFS note write goes through a dedicated
 * worker (./vault-io.worker.ts) that writes with `createSyncAccessHandle`,
 * the fast, flushable OPFS write path that exists only in dedicated workers,
 * and saves atomically (./atomic.ts: the new version complete in a temporary
 * file, flushed and size-checked, then it takes the note's name). This module
 * is that worker's logic, written against the few OPFS calls it needs, so it
 * runs (and is tested) outside a worker too.
 *
 * The #856 follow-up: OPFS reads go through the same worker, many files per
 * message (readViaSyncHandles). The main thread's one-by-one reads took 23 s
 * for 10,000 files in Chromium against 2.2 s for IndexedDB. A batch reuses
 * the folder handles it has resolved and reads each file with a read-only
 * sync access handle, so no per-file `getFile()` Blob is made on the main
 * thread.
 *
 * Errors keep their DOMException name across the worker boundary, so a full
 * disk arrives as `QuotaExceededError` and explainError() shows the "out of
 * storage space" sentence instead of a generic failure.
 */
import { atomicWrite, saveId, type AtomicFs } from "./atomic";

/** The parts of FileSystemSyncAccessHandle a save (and a read) uses. */
export interface SyncHandle {
  truncate(size: number): void;
  write(data: Uint8Array, opts: { at: number }): number;
  read?(into: Uint8Array, opts: { at: number }): number;
  flush(): void;
  getSize(): number;
  close(): void;
}
export interface FileLike {
  kind: "file";
  name: string;
  createSyncAccessHandle?: (opts?: { mode?: "readwrite" | "read-only" | "readwrite-unsafe" }) => Promise<SyncHandle>;
  getFile(): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  move?: (name: string) => Promise<void>;
}
export interface DirLike {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileLike>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, FileLike | DirLike]>;
}

/** This engine cannot write with sync access handles (no createSyncAccessHandle, or no move for the rename). */
export class SyncWriteUnsupported extends Error {
  constructor(what: string) {
    super(`OPFS sync access writes are not available here: ${what}`);
    this.name = "SyncWriteUnsupported";
  }
}

const isMissing = (e: unknown) => (e as { name?: string } | null)?.name === "NotFoundError" || (e as { name?: string } | null)?.name === "TypeMismatchError";

/** Write all of `bytes` into `file` through a sync access handle, flush, and check the size. */
async function putSync(file: FileLike, bytes: Uint8Array): Promise<void> {
  if (typeof file.createSyncAccessHandle !== "function") throw new SyncWriteUnsupported("createSyncAccessHandle");
  const h = await file.createSyncAccessHandle();
  try {
    h.truncate(0);
    let at = 0;
    while (at < bytes.byteLength) {
      const n = h.write(bytes.subarray(at), { at });
      if (!(n > 0)) throw new Error("the write was cut short");
      at += n;
    }
    h.flush();
    if (h.getSize() !== bytes.byteLength) throw new Error("the write was cut short");
  } finally {
    h.close();
  }
}

/** atomic.ts's file calls over one OPFS folder, with sync access handle writes. */
export function syncAtomicFs(dir: DirLike): AtomicFs {
  const file = (name: string) => dir.getFileHandle(name);
  return {
    async readdir() {
      const out: Array<{ name: string; type: "file" | "directory" }> = [];
      for await (const [name, h] of dir.entries()) out.push({ name, type: h.kind });
      return out;
    },
    async exists(path) {
      try {
        await file(path);
        return true;
      } catch (e) {
        if (isMissing(e)) return false;
        throw e;
      }
    },
    async writeFile(path, data) {
      await putSync(await dir.getFileHandle(path, { create: true }), data);
    },
    async size(path) {
      try {
        return (await (await file(path)).getFile()).size;
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async rename(from, to) {
      const h = await file(from);
      if (typeof h.move !== "function") throw new SyncWriteUnsupported("FileSystemHandle.move");
      await h.move(to);
    },
    async remove(path) {
      await dir.removeEntry(path);
    },
    async readFile(path) {
      return new Uint8Array(await (await (await file(path)).getFile()).arrayBuffer());
    },
  };
}

/**
 * Save `bytes` at `parts` (relative to `root`) atomically with sync access
 * handles. Folders are created as needed. Refuses up front, before touching
 * the note, when this engine lacks either call the atomic save needs.
 *
 * Review Z7-M2: the save runs in the note's path order (inPathOrder), so a
 * worker read of the note sent after it waits until the note has its name
 * back. Review Z7-L7: a refusal leaves nothing behind. A note that was not
 * there is created only to ask its handle what it can do; when the answer is
 * "unsupported" that empty entry is removed again before the refusal.
 */
export function writeViaSyncHandles(root: DirLike, parts: string[], bytes: Uint8Array, opts: { id?: string; inPlaceIfNoMove?: boolean } = {}): Promise<void> {
  return inPathOrder(parts.join("/"), async () => {
    let dir = root;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
    const name = parts[parts.length - 1];
    let created = false;
    let probe: FileLike;
    try {
      probe = await dir.getFileHandle(name);
    } catch (e) {
      if (!isMissing(e)) throw e;
      probe = await dir.getFileHandle(name, { create: true });
      created = true;
    }
    const refuse = async (what: string): Promise<never> => {
      if (created) await dir.removeEntry(name).catch(() => undefined); // why: only the empty entry made above for the probe
      throw new SyncWriteUnsupported(what);
    };
    if (typeof probe.createSyncAccessHandle !== "function") return refuse("createSyncAccessHandle");
    if (typeof probe.move !== "function") {
      // No rename: only when the main thread cannot write at all (no createWritable) is an in-place write better than none.
      if (!opts.inPlaceIfNoMove) return refuse("FileSystemHandle.move");
      await putSync(probe, bytes);
      return;
    }
    await atomicWrite(syncAtomicFs(dir), name, bytes, opts.id ?? saveId());
  });
}

/**
 * Per-path order inside the worker: a read waits for a write of the same
 * note that was sent before it (and the other way round), and two sync
 * access handles on one file never meet.
 */
const pathChains = new Map<string, Promise<unknown>>();
export function inPathOrder<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = pathChains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  pathChains.set(key, tail);
  void tail.then(() => {
    if (pathChains.get(key) === tail) pathChains.delete(key);
  });
  return run;
}

/** No file here (a missing name, a folder of that name, or a missing folder on the way). */
export const READ_MISSING = -1;

/** One file's bytes: a read-only sync access handle where there is one, else getFile(). */
async function readOne(file: FileLike): Promise<Uint8Array> {
  if (typeof file.createSyncAccessHandle === "function") {
    let h: SyncHandle | null = null;
    try {
      h = await file.createSyncAccessHandle({ mode: "read-only" });
    } catch {
      h = null; // why: locked by a writer elsewhere (another tab, a main-thread createWritable): getFile() below still reads it
    }
    if (h) {
      try {
        if (typeof h.read === "function") {
          const size = h.getSize();
          const out = new Uint8Array(size);
          let at = 0;
          while (at < size) {
            const n = h.read(out.subarray(at), { at });
            if (!(n > 0)) break;
            at += n;
          }
          if (at === size) return out;
        }
      } finally {
        h.close();
      }
    }
  }
  return new Uint8Array(await (await file.getFile()).arrayBuffer());
}

/**
 * Read many files under `root` in one go. The answer is one buffer with
 * every file's bytes, one after another, and each file's length: -1
 * (READ_MISSING) for a file that is not there. The caller then takes its
 * usual path for it, which reports not-found and recovers interrupted saves.
 * Folder handles are resolved once per batch. Up to `concurrency` files (32:
 * faster than 8 in a Chromium run of 2,000 files) are in flight at a time.
 */
export async function readViaSyncHandles(root: DirLike, paths: string[][], opts: { concurrency?: number } = {}): Promise<{ data: Uint8Array; lengths: number[] }> {
  const dirs = new Map<string, Promise<DirLike>>();
  const dirAt = (parts: string[]): Promise<DirLike> => {
    if (!parts.length) return Promise.resolve(root);
    const key = parts.join("/");
    let d = dirs.get(key);
    if (!d) {
      d = dirAt(parts.slice(0, -1)).then((parent) => parent.getDirectoryHandle(parts[parts.length - 1]));
      dirs.set(key, d);
      // A folder missing now may be made by a save that a later read in this batch waits for: do not remember the miss.
      d.catch(() => dirs.delete(key));
    }
    return d;
  };
  const chunks: Array<Uint8Array | null> = new Array(paths.length).fill(null);
  let next = 0;
  const lane = async () => {
    while (next < paths.length) {
      const i = next++;
      const parts = paths[i];
      if (!parts.length) continue;
      try {
        // Review Z7-M2: the lookup is in the note's path order too, so it never falls between a save's two renames.
        chunks[i] = await inPathOrder(parts.join("/"), async () => {
          const dir = await dirAt(parts.slice(0, -1));
          return readOne(await dir.getFileHandle(parts[parts.length - 1]));
        });
      } catch {
        chunks[i] = null; // why: missing or unreadable here; the main thread's own read decides (not-found, recovery, the real error)
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 32, paths.length)) }, lane));
  const lengths = chunks.map((c) => (c ? c.byteLength : READ_MISSING));
  const data = new Uint8Array(lengths.reduce((n, l) => n + Math.max(0, l), 0));
  let at = 0;
  for (const c of chunks) {
    if (!c) continue;
    data.set(c, at);
    at += c.byteLength;
  }
  return { data, lengths };
}

/** Cut a read answer back into one entry per path (null: not read here). */
export function splitRead(data: ArrayBuffer, lengths: number[]): Array<Uint8Array | null> {
  let at = 0;
  return lengths.map((l) => {
    if (l < 0) return null;
    const out = new Uint8Array(data, at, l);
    at += l;
    return out;
  });
}

/** A worker read request and its answer. */
export interface ReadRequest {
  id: number;
  op: "read";
  paths: string[][];
}
export type ReadAnswer = { id: number; ok: true; op: "read"; data: ArrayBuffer; lengths: number[] } | { id: number; ok: false; name: string; message: string; unsupported: boolean };

export async function handleRead(msg: ReadRequest, root: () => Promise<DirLike>): Promise<ReadAnswer> {
  try {
    const { data, lengths } = await readViaSyncHandles(await root(), msg.paths);
    return { id: msg.id, ok: true, op: "read", data: data.buffer as ArrayBuffer, lengths };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return { id: msg.id, ok: false, name: err?.name || "Error", message: String(err?.message || e), unsupported: false };
  }
}

/** A worker request and its answer. */
export interface WriteRequest {
  id: number;
  op?: "write";
  parts: string[];
  bytes: ArrayBuffer;
  /** The main thread has no other way to write (no createWritable). */
  inPlaceIfNoMove?: boolean;
}
export type WriteAnswer = { id: number; ok: true } | { id: number; ok: false; name: string; message: string; unsupported: boolean };

/** The worker's whole job, for one request. */
/** The OPFS root the worker reads and writes under (navigator.storage.getDirectory()). */
export const opfsRootDir = async (): Promise<DirLike> => (await navigator.storage.getDirectory()) as unknown as DirLike;

export async function handleWrite(msg: WriteRequest, root: () => Promise<DirLike>): Promise<WriteAnswer> {
  try {
    const bytes = new Uint8Array(msg.bytes);
    const r = await root();
    await writeViaSyncHandles(r, msg.parts, bytes, { inPlaceIfNoMove: msg.inPlaceIfNoMove }); // in path order (Z7-M2)
    return { id: msg.id, ok: true };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return { id: msg.id, ok: false, name: err?.name || "Error", message: String(err?.message || e), unsupported: err?.name === "SyncWriteUnsupported" };
  }
}

/** The error the main thread rethrows: the same name (QuotaExceededError stays QuotaExceededError). */
export function errorFromAnswer(a: { ok: false; name: string; message: string }): Error {
  const e = new Error(a.message);
  e.name = a.name;
  return e;
}
