/**
 * Lightweight reactive sync-status indicator.
 *
 * Used by the sync engine to broadcast state (idle / syncing / error / offline)
 * without pulling React into the worker / engine layer.
 */

export type SyncStatus = "idle" | "syncing" | "error" | "offline";
export type SyncProviderName = "dropbox" | "gdrive" | "icloud" | "gist" | null;

type Listener = (status: SyncStatus, provider: SyncProviderName, detail?: string) => void;

let currentStatus: SyncStatus = "idle";
let currentProvider: SyncProviderName = null;
let currentDetail: string | undefined;
const listeners = new Set<Listener>();

export function setSyncStatus(
  status: SyncStatus,
  provider: SyncProviderName = null,
  detail?: string,
): void {
  currentStatus = status;
  currentProvider = provider;
  currentDetail = detail;
  listeners.forEach((l) => l(status, provider, detail));
}

export function getSyncStatus(): {
  status: SyncStatus;
  provider: SyncProviderName;
  detail?: string;
} {
  return { status: currentStatus, provider: currentProvider, detail: currentDetail };
}

export function subscribeSyncStatus(l: Listener): () => void {
  listeners.add(l);
  // Immediately emit current state so hooks don't miss the first frame.
  l(currentStatus, currentProvider, currentDetail);
  return () => listeners.delete(l);
}
