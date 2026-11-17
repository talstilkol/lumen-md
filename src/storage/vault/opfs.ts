/**
 * The OPFS vault backend: the browser's Origin Private File System, where
 * Lumen keeps the notes today. A directory-handle backend rooted at
 * `navigator.storage.getDirectory()`.
 *
 * W11.Q10: every write goes first to the vault-io worker (./opfsSyncWrite.ts,
 * ./vault-io.worker.ts), which saves with sync access handles, atomically.
 * An engine without them answers "unsupported" once, and from then on the
 * main thread's `createWritable` writes (or, where that is missing too, the
 * worker writes in place). After the first note is saved, Lumen asks the
 * browser to keep the storage (navigator.storage.persist()), once.
 *
 * The #856 follow-up: reads go to the same worker, batched (readInWorker).
 * A file the worker does not find, and every read in an engine where the
 * worker cannot start, takes the main thread's path as before.
 */

import { createDirectoryHandleBackend } from "./handleBackend";
import type { VaultBackend, VaultData } from "./types";

export function isOpfsSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

/** Writes handed to the worker and not answered yet (their temporary files are not leftovers). */
let pendingWrites = 0;
/** null until the first worker answer: can this engine write with sync access handles? */
let workerWrites: boolean | null = null;

async function inWorker<T>(fn: (m: typeof import("./opfsSyncWrite")) => Promise<T>): Promise<T> {
  pendingWrites++;
  try {
    return await fn(await import("./opfsSyncWrite"));
  } finally {
    pendingWrites--;
  }
}

/** The worker write; false when this engine cannot do it (remembered). */
export async function writeInWorker(segments: string[], data: VaultData): Promise<boolean> {
  if (workerWrites === false || typeof Worker === "undefined") return false;
  try {
    await inWorker((m) => m.syncWriteOpfs(segments, data));
  } catch (e) {
    if ((e as { name?: string }).name === "SyncWriteUnsupported") {
      workerWrites = false;
      return false;
    }
    throw e;
  }
  workerWrites = true;
  void afterFirstSave();
  return true;
}

const PERSIST_ASKED = "lumen.storage.persistAskedAfterFirstSave";

/** Ask for persistent storage once, after the first note is saved (Firefox asks the person; others decide silently). */
export async function afterFirstSave(store: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage !== "undefined" ? localStorage : null): Promise<void> {
  try {
    if (!store || store.getItem(PERSIST_ASKED)) return;
    store.setItem(PERSIST_ASKED, new Date().toISOString());
  } catch {
    return; // why: no localStorage (private mode): the startup request in main.tsx still ran
  }
  const { requestPersistentStorage } = await import("../persistentStorage");
  await requestPersistentStorage();
}

/** null until the first answer: can this engine read through the worker? */
let workerReads: boolean | null = null;

/** The worker read (batched); null when the main thread should read it (not found there, or no worker here). */
export async function readInWorker(segments: string[]): Promise<Blob | null> {
  if (workerReads === false || typeof Worker === "undefined") return null;
  let bytes: Uint8Array | null;
  try {
    bytes = await (await import("./opfsSyncWrite")).readOpfsBatched(segments);
  } catch (e) {
    if ((e as { name?: string }).name === "SyncWriteUnsupported") workerReads = false;
    return null; // why: the main thread's read gives the real answer (and its error)
  }
  workerReads = true;
  return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>]) : null;
}

/** For tests: forget what the engine answered. */
export function resetWorkerWrites(): void {
  workerWrites = null;
  workerReads = null;
}

export function createOpfsBackend(): VaultBackend {
  return createDirectoryHandleBackend({
    id: "opfs",
    available: isOpfsSupported,
    root: async () => {
      if (!isOpfsSupported()) throw new Error("OPFS is not available in this browser.");
      return await navigator.storage.getDirectory();
    },
    writePrimary: writeInWorker,
    readPrimary: readInWorker,
    // Engines without createWritable on the main thread (Safari before 26):
    // the worker writes even when it cannot rename (in place).
    writeFallback: async (segments, data) => {
      await inWorker((m) => m.syncWriteOpfs(segments, data, { inPlaceIfNoMove: true }));
      void afterFirstSave();
    },
    writesPending: () => pendingWrites > 0,
  });
}

/**
 * Plan W13.P4 (Settings › Privacy, the data on this device): the OPFS root, to count what this
 * browser keeps there, and the removal of the top-level entries `pick` names (notes, model files).
 */
export const opfsRoot = (): Promise<FileSystemDirectoryHandle> => navigator.storage.getDirectory();

export interface OpfsDirLike {
  entries(): AsyncIterable<[string, unknown]>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
}
export async function removeOpfsTop(root: OpfsDirLike, pick: (name: string) => boolean): Promise<string[]> {
  const names: string[] = [];
  for await (const [name] of root.entries()) names.push(name);
  const removed: string[] = [];
  for (const name of names.filter(pick)) {
    await root.removeEntry(name, { recursive: true });
    removed.push(name);
  }
  return removed;
}
