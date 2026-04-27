/**
 * Workspace storage using the Origin Private File System (OPFS).
 * Files and folders are addressed by forward-slash paths, e.g.
 * `notes/2026/april.md`. Path traversal walks (creating intermediate
 * directories on demand for write paths).
 */

import { randomId } from "../lib/cryptoRandom";

export interface WorkspaceEntry {
  /** File path relative to the workspace root. */
  path: string;
  /** File basename (no directory). */
  name: string;
  size: number;
  /** mtime (ms) since epoch. */
  modified: number;
}

export interface WorkspaceNode {
  /** Path relative to the workspace root, no leading slash. Empty for root. */
  path: string;
  /** Basename of this node. */
  name: string;
  kind: "file" | "directory";
  size?: number;
  modified?: number;
  /** Children for directories, sorted: directories first then files, alpha. */
  children?: WorkspaceNode[];
}

async function root(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error("OPFS is not available in this browser.");
  }
  return await navigator.storage.getDirectory();
}

// ── Path helpers ─────────────────────────────────────────────────────────

export function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function joinPath(...parts: string[]): string {
  return parts.flatMap(splitPath).join("/");
}

export function basename(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? "";
}

export function dirname(path: string): string {
  const parts = splitPath(path);
  parts.pop();
  return parts.join("/");
}

async function walkDir(
  parts: string[],
  opts: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle> {
  let cur = await root();
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part, { create: !!opts.create });
  }
  return cur;
}

async function getFileHandleAt(
  path: string,
  opts: { create?: boolean } = {},
): Promise<FileSystemFileHandle> {
  const parts = splitPath(path);
  const file = parts.pop();
  if (!file) throw new Error("Empty workspace path");
  const dir = await walkDir(parts, opts);
  return await dir.getFileHandle(file, { create: !!opts.create });
}

// ── Recursive tree ───────────────────────────────────────────────────────

async function readDirInto(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  opts: { includeAssets: boolean },
): Promise<WorkspaceNode[]> {
  const out: WorkspaceNode[] = [];
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      const children = await readDirInto(
        handle as FileSystemDirectoryHandle,
        path,
        opts,
      );
      // Hide entirely-empty asset-only directories when not including assets.
      out.push({ path, name, kind: "directory", children });
    } else {
      if (!opts.includeAssets && isAssetName(name)) continue;
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({
          path,
          name,
          kind: "file",
          size: file.size,
          modified: file.lastModified,
        });
      } catch {
        out.push({ path, name, kind: "file" });
      }
    }
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/** Recursive tree of all entries in the workspace. */
export async function listWorkspaceTree(
  opts: { includeAssets?: boolean } = {},
): Promise<WorkspaceNode[]> {
  return readDirInto(await root(), "", { includeAssets: !!opts.includeAssets });
}

/**
 * Backwards-compatible flat listing — recurses through every directory and
 * returns a flat array of files only.
 */
export async function listWorkspace(
  opts: { includeAssets?: boolean } = {},
): Promise<WorkspaceEntry[]> {
  const tree = await listWorkspaceTree(opts);
  const out: WorkspaceEntry[] = [];
  function visit(nodes: WorkspaceNode[]) {
    for (const n of nodes) {
      if (n.kind === "file") {
        out.push({
          path: n.path,
          name: n.name,
          size: n.size ?? 0,
          modified: n.modified ?? 0,
        });
      } else if (n.children) {
        visit(n.children);
      }
    }
  }
  visit(tree);
  out.sort((a, b) => b.modified - a.modified);
  return out;
}

// ── File operations (path-aware) ─────────────────────────────────────────

export async function readWorkspaceFile(path: string): Promise<string> {
  const handle = await getFileHandleAt(path);
  const file = await handle.getFile();
  return await file.text();
}

export async function writeWorkspaceFile(
  path: string,
  content: string,
): Promise<void> {
  const handle = await getFileHandleAt(path, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** Write arbitrary binary content (e.g. an image asset). */
export async function writeWorkspaceBlob(
  path: string,
  data: Blob | ArrayBuffer | Uint8Array,
): Promise<void> {
  const handle = await getFileHandleAt(path, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data as FileSystemWriteChunkType);
  await writable.close();
}

/** Read raw bytes; useful for assets resolved into blob URLs. */
export async function readWorkspaceBlob(path: string): Promise<Blob> {
  const handle = await getFileHandleAt(path);
  return await handle.getFile();
}

const ASSET_PREFIX = "lumen-asset-";

export function isAssetName(name: string): boolean {
  return basename(name).startsWith(ASSET_PREFIX);
}

export function makeAssetName(originalName: string): string {
  const ext =
    originalName.match(/\.[A-Za-z0-9]+$/)?.[0]?.toLowerCase() ?? ".png";
  // Cryptographically-strong suffix avoids collisions even with rapid pastes.
  const stamp = `${Date.now().toString(36)}-${randomId(3)}`;
  return `${ASSET_PREFIX}${stamp}${ext}`;
}

/** Delete a file at `path` — recursively when `path` refers to a directory. */
export async function deleteWorkspaceFile(path: string): Promise<void> {
  const parts = splitPath(path);
  const last = parts.pop();
  if (!last) throw new Error("Cannot delete the workspace root");
  const parent = await walkDir(parts);
  await parent.removeEntry(last, { recursive: true });
}

export async function renameWorkspaceFile(
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (oldPath === newPath) return;
  // Read original (file only — directory rename would need a recursive copy).
  const original = await readWorkspaceBlob(oldPath);
  await writeWorkspaceBlob(newPath, original);
  await deleteWorkspaceFile(oldPath);
}

export async function workspaceHasFile(path: string): Promise<boolean> {
  try {
    await getFileHandleAt(path);
    return true;
  } catch {
    return false;
  }
}

/** Create a directory at `path` (creating intermediate dirs as needed). */
export async function createWorkspaceFolder(path: string): Promise<void> {
  const parts = splitPath(path);
  if (parts.length === 0) return;
  await walkDir(parts, { create: true });
}

export function isOPFSAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

/**
 * Pick a unique file path inside the workspace.
 * `base` may be a basename ("Untitled.md") or a full path ("folder/foo.md").
 */
export async function uniqueWorkspaceName(base: string): Promise<string> {
  const dir = dirname(base);
  const fileBase = basename(base);
  const ext = fileBase.match(/\.[^./]+$/)?.[0] ?? ".md";
  const stem = fileBase.replace(ext, "");
  let i = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidateName = i === 0 ? `${stem}${ext}` : `${stem} ${i + 1}${ext}`;
    const candidate = dir ? `${dir}/${candidateName}` : candidateName;
    if (!(await workspaceHasFile(candidate))) return candidate;
    i++;
    if (i > 999) {
      const fallback = `${stem}-${Date.now()}${ext}`;
      return dir ? `${dir}/${fallback}` : fallback;
    }
  }
}
