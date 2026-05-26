/**
 * Auto-backup — saves a versioned snapshot of the current document every
 * 30 s after the user stops typing, even if they never press Ctrl+S.
 *
 * Snapshots land in OPFS (`/backups/<name>/<ts>.md`) and are kept with
 * an LRU cap so disk usage stays bounded.
 */

import { writeWorkspaceFile } from "../storage/workspace";
import { useAppStore } from "../store/useStore";
import { log } from "../lib/logger";

const AUTO_BACKUP_INTERVAL_MS = 30_000;
const IDLE_CALLBACK_TIMEOUT_MS = 2_000;
const MAX_VERSIONS = 100;

let timer: ReturnType<typeof setTimeout> | undefined;
let snapshotQueue: Array<{ name: string; content: string; ts: number }> = [];
let isWriting = false;

/**
 * Start the auto-backup listener.  Call once at application startup.
 */
export function startAutoBackup(): void {
  // We only need to listen to the store's content changes.
  // Using a Zustand subscribe avoids React re-renders entirely.
  const unsub = useAppStore.subscribe((state, prevState) => {
    if (state.doc.content === prevState.doc.content) return;
    if (!state.doc.content) return;
    scheduleSnapshot(state.doc.name, state.doc.content);
  });

  // Also flush on beforeunload so nothing is lost when the tab closes.
  const onBeforeUnload = () => {
    flushQueue(true);
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  // Return teardown so tests can clean up.
  (startAutoBackup as unknown as { _teardown?: () => void })._teardown = () => {
    unsub();
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

function scheduleSnapshot(name: string, content: string): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    snapshotQueue.push({ name, content, ts: Date.now() });
    // Use requestIdleCallback when available to avoid blocking the main thread.
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(
        () => {
          flushQueue();
        },
        { timeout: IDLE_CALLBACK_TIMEOUT_MS },
      );
    } else {
      flushQueue();
    }
  }, AUTO_BACKUP_INTERVAL_MS);
}

async function flushQueue(force = false): Promise<void> {
  if (isWriting) return;
  isWriting = true;
  try {
    while (snapshotQueue.length > 0) {
      const snapshot = snapshotQueue.shift();
      if (!snapshot) continue;
      const { name, content, ts } = snapshot;
      const safeName = name.replace(/[^\w\-.]/g, "_");
      const path = `backups/${safeName}/${ts}.md`;
      try {
        await writeWorkspaceFile(path, content);
      } catch (err) {
        log.error("[auto-backup] write failed:", (err as Error).message);
      }
    }
    // Prune old versions after every flush.
    if (force || Math.random() < 0.1) {
      await pruneOldVersions();
    }
  } finally {
    isWriting = false;
  }
}

/**
 * Keep at most MAX_VERSIONS snapshots per document, deleting oldest first.
 */
async function pruneOldVersions(): Promise<void> {
  try {
    const opfs = await navigator.storage.getDirectory();
    const backupsDir = await opfs.getDirectoryHandle("backups", { create: false });
    if (!backupsDir) return;

    for await (const [_docName, handle] of (backupsDir as any).entries() as AsyncIterableIterator<[string, FileSystemDirectoryHandle]>) {
      if (handle.kind !== "directory") continue;
      const files: { name: string; handle: FileSystemFileHandle }[] = [];
      for await (const [fileName, fileHandle] of (handle as any).entries() as AsyncIterableIterator<[string, FileSystemFileHandle]>) {
        if (fileHandle.kind === "file") {
          files.push({ name: fileName, handle: fileHandle });
        }
      }
      if (files.length <= MAX_VERSIONS) continue;
      // Sort by filename (which is timestamp) ascending = oldest first
      files.sort((a, b) => a.name.localeCompare(b.name));
      const toDelete = files.slice(0, files.length - MAX_VERSIONS);
      for (const f of toDelete) {
        try {
          await handle.removeEntry(f.name);
        } catch {
          /* ignore pruning errors */
        }
      }
    }
  } catch {
    /* OPFS may be unavailable — silently skip pruning */
  }
}
