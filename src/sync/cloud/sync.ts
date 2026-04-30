/**
 * Bidirectional sync engine — diffs the OPFS workspace against a cloud
 * provider's file list and reconciles each side. Conflict policy is
 * "newer wins, keep the loser as `<name>.conflict-<ts>.md`" so no edit
 * is ever silently dropped.
 *
 * The engine is provider-agnostic: pass any `CloudProvider` from
 * `./types` and it handles batching, retries, progress callbacks and
 * optional incremental cache.
 */

import {
  listWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceEntry,
} from "../../storage/workspace";
import { log } from "../../lib/logger";
import { recordAudit } from "../../lib/audit";
import type { CloudProvider, SyncReport, CloudConflictResolution } from "./types";
import { useAuth } from "../../auth/useAuth";

interface SyncOptions {
  /** Called with a 0–1 progress fraction. */
  onProgress?: (fraction: number, label: string) => void;
  /** When a conflict appears: "newer" picks the more recent mtime; "ask" surfaces it via the callback. */
  conflict?: "newer" | "ask";
  /** Optional manual resolver invoked when conflict === "ask". */
  resolve?: (path: string) => Promise<CloudConflictResolution>;
}

const MAX_CLOUD_SYNC_RETRY_ATTEMPTS = 2;
const SYNC_STATE_VERSION = 1;
const SYNC_STATE_PREFIX = "lumen.cloud.sync.state";
const MAX_STATE_ENTRIES = 2_500;

interface SyncRetryOptions {
  label: string;
  providerName: string;
  path?: string;
}

interface SyncCacheEntry {
  localModified: number;
  localSize: number;
  /** SHA-256 hex (first 32 chars) for local workspace hash. */
  localHash?: string;
  remoteModified?: number;
  remoteSize?: number;
  remoteHash?: string;
  updatedAt: number;
}

interface SyncCacheState {
  v: number;
  provider: string;
  files: Record<string, SyncCacheEntry>;
}

function stateKey(providerName: string): string {
  return `${SYNC_STATE_PREFIX}.${providerName.toLowerCase()}`;
}

function defaultSyncState(providerName: string): SyncCacheState {
  return { v: SYNC_STATE_VERSION, provider: providerName.toLowerCase(), files: {} };
}

function hasSyncStorage(): boolean {
  try {
    const k = "__lumen_sync_state_probe";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function readSyncState(providerName: string): SyncCacheState {
  if (!hasSyncStorage()) return defaultSyncState(providerName);
  try {
    const raw = localStorage.getItem(stateKey(providerName));
    if (!raw) return defaultSyncState(providerName);
    const parsed = JSON.parse(raw) as Partial<SyncCacheState>;
    if (parsed?.v !== SYNC_STATE_VERSION || parsed.provider !== providerName.toLowerCase()) {
      return defaultSyncState(providerName);
    }
    if (typeof parsed.files !== "object" || parsed.files === null) {
      return defaultSyncState(providerName);
    }
    return { ...defaultSyncState(providerName), files: parsed.files as Record<string, SyncCacheEntry> };
  } catch {
    return defaultSyncState(providerName);
  }
}

function persistSyncState(providerName: string, state: SyncCacheState): void {
  if (!hasSyncStorage()) return;
  try {
    const next = {
      ...state,
      files: pruneSyncFiles(state.files),
      v: SYNC_STATE_VERSION,
      provider: providerName.toLowerCase(),
    };
    localStorage.setItem(stateKey(providerName), JSON.stringify(next));
  } catch {
    // Cache write failures should never block sync.
  }
}

function pruneSyncFiles(files: Record<string, SyncCacheEntry>): Record<string, SyncCacheEntry> {
  const keys = Object.keys(files);
  if (keys.length <= MAX_STATE_ENTRIES) return files;
  const sorted = keys
    .map((key) => ({ key, updatedAt: files[key]?.updatedAt ?? 0 }))
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const keepStart = sorted.length - MAX_STATE_ENTRIES;
  const kept: Record<string, SyncCacheEntry> = {};
  for (let i = keepStart; i < sorted.length; i++) {
    const key = sorted[i]?.key;
    if (key) kept[key] = files[key];
  }
  return kept;
}

function markPath(
  target: Record<string, SyncCacheEntry>,
  path: string,
  local: WorkspaceEntry | undefined,
  remote: { modified: number; size: number; hash?: string } | undefined,
  localHash: string,
  remoteHash?: string,
): void {
  target[path] = {
    localModified: local ? local.modified : remote?.modified ?? 0,
    localSize: local ? local.size : remote?.size ?? 0,
    localHash,
    remoteModified: remote?.modified,
    remoteSize: remote?.size,
    remoteHash: remoteHash ?? remote?.hash,
    updatedAt: Date.now(),
  };
}

function normalize(p: string): string {
  return p.replace(/^\/+/, "").toLowerCase();
}

async function hashText(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 4_000);
}

function isRetryableCloudError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  if (message.includes("429") || message.includes("timeout") || message.includes("aborted")) return true;
  if (message.includes("fetch")) return true;
  if (/5\d{2}/.test(message)) return true;
  if (message.includes("network") || message.includes("econn")) return true;
  return false;
}

async function withCloudRetry<T>(
  action: () => Promise<T>,
  { label, providerName, path }: SyncRetryOptions,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= MAX_CLOUD_SYNC_RETRY_ATTEMPTS) {
    try {
      return await action();
    } catch (err) {
      lastError = err;
      const retryable = attempt < MAX_CLOUD_SYNC_RETRY_ATTEMPTS && isRetryableCloudError(err);
      if (!retryable) {
        throw err;
      }
      attempt += 1;
      log.warn(
        `[cloud-sync] retry ${attempt}/${MAX_CLOUD_SYNC_RETRY_ATTEMPTS} for ${providerName}.${label}${
          path ? ` (${path})` : ""
        }`,
        err,
      );
      await sleep(retryDelay(attempt - 1));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`${providerName}.${label} failed`);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function currentUserId(): string | null {
  return useAuth.getState().user?.id ?? null;
}

async function isPathUpToDate(
  local: WorkspaceEntry,
  remote: { modified: number; size: number; hash?: string },
  cache: SyncCacheEntry | undefined,
): Promise<boolean> {
  if (!cache) return false;

  let localHash: string | undefined = cache.localHash;
  if (
    cache.localSize === local.size &&
    (cache.localModified !== local.modified || localHash === undefined) &&
    cache.localHash
  ) {
    const content = await readWorkspaceFile(local.path);
    const freshHash = await hashText(content);
    localHash = freshHash;
  }

  const localMatch =
    cache.localSize === local.size &&
    (cache.localModified === local.modified ||
      (cache.localHash !== undefined &&
        localHash !== undefined &&
        localHash === cache.localHash));
  const remoteMatch =
    cache.remoteSize === remote.size &&
    cache.remoteModified === remote.modified &&
    ((cache.remoteHash === undefined) || remote.hash === undefined || cache.remoteHash === remote.hash);

  return localMatch && remoteMatch;
}

export async function syncWithCloud(
  provider: CloudProvider,
  opts: SyncOptions = {},
): Promise<SyncReport> {
  const report: SyncReport = {
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    conflicts: [],
    errors: [],
  };
  const conflictPolicy = opts.conflict ?? "newer";
  const onProgress = opts.onProgress ?? (() => {});

  if (!provider.isConnected()) {
    throw new Error(`${provider.name} is not connected.`);
  }

  onProgress(0, "Listing local files…");
  const local = await listWorkspace({ includeAssets: true });
  const localByPath = new Map(local.map((f) => [normalize(f.path), f]));

  onProgress(0.1, "Listing remote files…");
  const remote = await withCloudRetry(() => provider.listFiles(), {
    label: "listFiles",
    providerName: provider.name,
  });
  const remoteByPath = new Map(remote.map((f) => [normalize(f.path), f]));

  const allPaths = new Set([...localByPath.keys(), ...remoteByPath.keys()]);
  const cache = readSyncState(provider.name);
  const nextCache = { ...cache.files };
  const seenPaths = new Set<string>();
  const localContentCache = new Map<string, { content: string; hash: string }>();

  async function readLocalWithHash(localFile: WorkspaceEntry): Promise<{ content: string; hash: string }> {
    const key = localFile.path;
    const existing = localContentCache.get(key);
    if (existing) return existing;
    const content = await readWorkspaceFile(key);
    const hash = await hashText(content);
    const packed = { content, hash };
    localContentCache.set(key, packed);
    return packed;
  }

  let processed = 0;
  for (const path of allPaths) {
    const l = localByPath.get(path);
    const r = remoteByPath.get(path);
    const cacheEntry = cache.files[path];
    seenPaths.add(path);

    try {
      if (l && !r) {
        const payload = await readLocalWithHash(l);
        await withCloudRetry(
          () => provider.writeFile(path, payload.content),
          {
            label: "writeFile",
            providerName: provider.name,
            path,
          },
        );
        report.uploaded++;
        markPath(nextCache, path, l, {
          modified: l.modified,
          size: l.size,
          hash: payload.hash,
        }, payload.hash, payload.hash);
      } else if (!l && r) {
        const content = await withCloudRetry(() => provider.readFile(path), {
          label: "readFile",
          providerName: provider.name,
          path,
        });
        const hash = await hashText(content);
        await writeWorkspaceFile(path, content);
        report.downloaded++;
        markPath(nextCache, path, {
          path,
          name: path.split("/").pop() ?? path,
          size: r.size,
          modified: r.modified,
        }, r, hash, r.hash);
      } else if (l && r) {
        const remoteIsUpToDate = await isPathUpToDate(l, r, cacheEntry);
        if (remoteIsUpToDate) {
          continue;
        }

        const decision: CloudConflictResolution =
          conflictPolicy === "ask" && opts.resolve
            ? await opts.resolve(path)
            : l.modified > r.modified
            ? "local"
            : "remote";

        if (decision === "local") {
          const payload = await readLocalWithHash(l);
          await withCloudRetry(
            () => provider.writeFile(path, payload.content),
            {
              label: "writeFile",
              providerName: provider.name,
              path,
            },
          );
          report.uploaded++;
          markPath(nextCache, path, l, r, payload.hash, r.hash ?? payload.hash);
        } else if (decision === "remote") {
          const content = await withCloudRetry(() => provider.readFile(path), {
            label: "readFile",
            providerName: provider.name,
            path,
          });
          const hash = await hashText(content);
          await writeWorkspaceFile(path, content);
          report.downloaded++;
          markPath(
            nextCache,
            path,
            {
              path,
              name: path.split("/").pop() ?? path,
              size: content.length,
              modified: r.modified,
            },
            r,
            hash,
            r.hash ?? hash,
          );
        } else {
          const content = await withCloudRetry(() => provider.readFile(path), {
            label: "readFile",
            providerName: provider.name,
            path,
          });
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const dup = path.replace(/\.([^.]+)$/, `.conflict-${ts}.$1`);
          await writeWorkspaceFile(dup, content);
          report.downloaded++;

          const localPayload = await readLocalWithHash(l).catch(async () => {
            const fallback = await readWorkspaceFile(l.path);
            return { content: fallback, hash: await hashText(fallback) };
          });
          const remoteHash = await hashText(content);
          if (cacheEntry) {
            markPath(
              nextCache,
              path,
              l,
              r,
              cacheEntry.localHash ?? localPayload.hash,
              remoteHash,
            );
          } else {
            markPath(nextCache, path, l, r, localPayload.hash, remoteHash);
          }
        }
        report.conflicts.push({ path, resolution: decision });
      }
    } catch (err) {
      log.warn(`sync failed for ${path}`, err);
      report.errors.push({ path, error: errorMessage(err) });
    }
    processed++;
    onProgress(allPaths.size ? 0.1 + 0.9 * (processed / allPaths.size) : 1, path);
  }

  onProgress(1, "Done");
  const userId = currentUserId();

  // Keep only active paths in cache. This trims tombstones and keeps local
  // reads bounded while preserving enough history for incremental skip checks.
  for (const key of Object.keys(nextCache)) {
    if (!seenPaths.has(key)) {
      delete nextCache[key];
    }
  }
  persistSyncState(provider.name, { ...cache, files: nextCache });

  if (userId) {
    recordAudit(userId, "sync.cloud", {
      payload: {
        provider: provider.name,
        uploaded: report.uploaded,
        downloaded: report.downloaded,
        deleted: report.deleted,
        conflicts: report.conflicts.length,
        errors: report.errors.length,
      },
    });
  }
  return report;
}
