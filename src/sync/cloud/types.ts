/**
 * Shared interface for cloud sync providers (Dropbox, Google Drive, iCloud,
 * etc.). Lumen treats these as a thin file-CRUD adapter — the diffing,
 * conflict resolution, and OPFS write-back live in `src/sync/cloud/sync.ts`.
 *
 * Each provider plugs into the same lifecycle:
 *   1. `connect()` runs the OAuth dance and stores a refresh token.
 *   2. `listFiles()` enumerates the bound folder.
 *   3. `readFile(path)` / `writeFile(path, body)` move bytes.
 *   4. `disconnect()` revokes the local token and tears down state.
 *
 * Providers are intentionally synchronous in API shape: the sync engine
 * batches calls and back-offs internally, so providers don't need to.
 */

export interface CloudFile {
  /** Path relative to the bound folder. */
  path: string;
  size: number;
  /** mtime ms since epoch. */
  modified: number;
  /** Server-side hash, when the API exposes one. Used to skip unchanged files. */
  hash?: string;
}

export interface CloudProvider {
  /** Stable name shown in telemetry / UI. */
  name: string;
  /** True once a session is live. */
  isConnected(): boolean;
  /** Run the OAuth flow and persist credentials locally. */
  connect(): Promise<void>;
  /** Drop credentials. Does not revoke server-side. */
  disconnect(): Promise<void>;
  /** Enumerate every file under the bound folder, recursively. */
  listFiles(): Promise<CloudFile[]>;
  /** Read a file's contents as a UTF-8 string. */
  readFile(path: string): Promise<string>;
  /** Write/overwrite a file. */
  writeFile(path: string, content: string): Promise<void>;
  /** Delete a file. No-op if missing. */
  deleteFile(path: string): Promise<void>;
}

export type CloudConflictResolution = "local" | "remote" | "duplicate";

export interface SyncReport {
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: { path: string; resolution: CloudConflictResolution }[];
  errors: { path: string; error: string }[];
}
