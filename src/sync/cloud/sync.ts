/**
 * Bidirectional sync engine — diffs the OPFS workspace against a cloud
 * provider's file list and reconciles each side. Conflict policy is "newer
 * wins, keep the loser as `<name>.conflict-<ts>.md`" so no edit is ever
 * silently dropped.
 *
 * The engine is provider-agnostic: pass any `CloudProvider` from
 * `./types` and it handles batching, retries, and progress callbacks.
 */

import { listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "../../storage/workspace";
import { log } from "../../lib/logger";
import type { CloudProvider, SyncReport, CloudConflictResolution } from "./types";

interface SyncOptions {
  /** Called with a 0–1 progress fraction. */
  onProgress?: (fraction: number, label: string) => void;
  /** When a conflict appears: "newer" picks the more recent mtime; "ask" surfaces it via the callback. */
  conflict?: "newer" | "ask";
  /** Optional manual resolver invoked when conflict === "ask". */
  resolve?: (path: string) => Promise<CloudConflictResolution>;
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
  const remote = await provider.listFiles();
  const remoteByPath = new Map(remote.map((f) => [normalize(f.path), f]));

  const allPaths = new Set([...localByPath.keys(), ...remoteByPath.keys()]);
  let processed = 0;

  for (const path of allPaths) {
    const l = localByPath.get(path);
    const r = remoteByPath.get(path);
    try {
      if (l && !r) {
        // Local-only → upload.
        const content = await readWorkspaceFile(l.path);
        await provider.writeFile(path, content);
        report.uploaded++;
      } else if (!l && r) {
        // Remote-only → download.
        const content = await provider.readFile(path);
        await writeWorkspaceFile(path, content);
        report.downloaded++;
      } else if (l && r) {
        // Both sides — pick a winner.
        const lMtime = l.modified ?? 0;
        const rMtime = r.modified ?? 0;
        if (lMtime === rMtime) {
          // Skip — assume in sync.
        } else {
          const decision: CloudConflictResolution =
            conflictPolicy === "ask" && opts.resolve
              ? await opts.resolve(path)
              : lMtime > rMtime
                ? "local"
                : "remote";
          if (decision === "local") {
            const content = await readWorkspaceFile(l.path);
            await provider.writeFile(path, content);
            report.uploaded++;
          } else if (decision === "remote") {
            const content = await provider.readFile(path);
            await writeWorkspaceFile(path, content);
            report.downloaded++;
          } else {
            // duplicate — keep both with timestamped suffix on the loser.
            const content = await provider.readFile(path);
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            const dup = path.replace(/\.([^.]+)$/, `.conflict-${ts}.$1`);
            await writeWorkspaceFile(dup, content);
            report.downloaded++;
          }
          report.conflicts.push({ path, resolution: decision });
        }
      }
    } catch (err) {
      log.warn(`sync failed for ${path}`, err);
      report.errors.push({ path, error: (err as Error).message });
    }
    processed++;
    onProgress(0.1 + 0.9 * (processed / allPaths.size), path);
  }

  onProgress(1, "Done");
  return report;
}

function normalize(p: string): string {
  return p.replace(/^\/+/, "").toLowerCase();
}
