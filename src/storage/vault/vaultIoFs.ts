/**
 * W11.Q10 (research R5.12): every OPFS note write goes through a dedicated
 * worker (./vault-io.worker.ts) that writes with `createSyncAccessHandle`,
 * the fast, flushable OPFS write path that exists only in dedicated workers,
 * and saves atomically (./atomic.ts: the new version complete in a temporary
 * file, flushed and size-checked, then it takes the note's name). This module
 * is that worker's logic, written against the few OPFS calls it needs, so it
 * runs (and is tested) outside a worker too.
 *
 * Errors keep their DOMException name across the worker boundary, so a full
 * disk arrives as `QuotaExceededError` and explainError() shows the "out of
 * storage space" sentence instead of a generic failure.
 */
import { atomicWrite, saveId, type AtomicFs } from "./atomic";

/** The parts of FileSystemSyncAccessHandle a save uses. */
export interface SyncHandle {
  truncate(size: number): void;
  write(data: Uint8Array, opts: { at: number }): number;
  flush(): void;
  getSize(): number;
  close(): void;
}
export interface FileLike {
  kind: "file";
  name: string;
  createSyncAccessHandle?: () => Promise<SyncHandle>;
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
 */
export async function writeViaSyncHandles(root: DirLike, parts: string[], bytes: Uint8Array, opts: { id?: string; inPlaceIfNoMove?: boolean } = {}): Promise<void> {
  let dir = root;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
  const name = parts[parts.length - 1];
  const probe = await dir.getFileHandle(name, { create: true });
  if (typeof probe.createSyncAccessHandle !== "function") throw new SyncWriteUnsupported("createSyncAccessHandle");
  if (typeof probe.move !== "function") {
    // No rename: only when the main thread cannot write at all (no createWritable) is an in-place write better than none.
    if (!opts.inPlaceIfNoMove) throw new SyncWriteUnsupported("FileSystemHandle.move");
    await putSync(probe, bytes);
    return;
  }
  await atomicWrite(syncAtomicFs(dir), name, bytes, opts.id ?? saveId());
}

/** A worker request and its answer. */
export interface WriteRequest {
  id: number;
  parts: string[];
  bytes: ArrayBuffer;
  /** The main thread has no other way to write (no createWritable). */
  inPlaceIfNoMove?: boolean;
}
export type WriteAnswer = { id: number; ok: true } | { id: number; ok: false; name: string; message: string; unsupported: boolean };

/** The worker's whole job, for one request. */
export async function handleWrite(msg: WriteRequest, root: () => Promise<DirLike>): Promise<WriteAnswer> {
  try {
    await writeViaSyncHandles(await root(), msg.parts, new Uint8Array(msg.bytes), { inPlaceIfNoMove: msg.inPlaceIfNoMove });
    return { id: msg.id, ok: true };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return { id: msg.id, ok: false, name: err?.name || "Error", message: String(err?.message || e), unsupported: err?.name === "SyncWriteUnsupported" };
  }
}

/** The error the main thread rethrows: the same name (QuotaExceededError stays QuotaExceededError). */
export function errorFromAnswer(a: Extract<WriteAnswer, { ok: false }>): Error {
  const e = new Error(a.message);
  e.name = a.name;
  return e;
}
