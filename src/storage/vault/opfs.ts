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

/** For tests: forget what the engine answered. */
export function resetWorkerWrites(): void {
  workerWrites = null;
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
    // Engines without createWritable on the main thread (Safari before 26):
    // the worker writes even when it cannot rename (in place).
    writeFallback: async (segments, data) => {
      await inWorker((m) => m.syncWriteOpfs(segments, data, { inPlaceIfNoMove: true }));
      void afterFirstSave();
    },
    writesPending: () => pendingWrites > 0,
  });
}
