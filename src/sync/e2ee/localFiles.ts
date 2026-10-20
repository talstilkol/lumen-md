/**
 * The local side of the encrypted sync: the device's own copy of the notes.
 *
 * Writes are conditional on the hash the engine last saw, so a note the user
 * edits while a sync round runs is never overwritten: the write is skipped and
 * the next round sees a conflict instead.
 */

import { sha256Hex, utf8 } from "./bytes";
import type { VaultBackend } from "../../storage/vault/types";

export interface LocalFile {
  path: string;
  /** SHA-256 hex of the bytes. */
  hash: string;
}

export interface LocalFiles {
  list(): Promise<LocalFile[]>;
  /** The bytes, or null when the file is gone. */
  read(path: string): Promise<Uint8Array | null>;
  /**
   * Write `data` only if the file still has hash `expect` (null: only if it
   * does not exist). Returns false, writing nothing, otherwise.
   */
  write(path: string, data: Uint8Array, expect: string | null): Promise<boolean>;
  /** Delete only if the file still has hash `expect`. False otherwise. */
  remove(path: string, expect: string): Promise<boolean>;
}

/** In-memory files (tests and the simulated devices). */
export interface MemoryFiles extends LocalFiles {
  readonly files: Map<string, Uint8Array>;
  /** Unconditional edit, as the user typing. */
  set(path: string, text: string): void;
  delete(path: string): void;
  text(path: string): string | undefined;
}

export function memoryFiles(): MemoryFiles {
  const files = new Map<string, Uint8Array>();
  /** Hashes computed so far; dropped on every change of the path. */
  const hashes = new Map<string, string>();
  const hashOf = async (p: string): Promise<string | null> => {
    const d = files.get(p);
    if (!d) return null;
    let h = hashes.get(p);
    if (h === undefined) {
      h = await sha256Hex(d);
      if (files.get(p) === d) hashes.set(p, h);
    }
    return h;
  };
  const put = (p: string, d: Uint8Array) => {
    files.set(p, d);
    hashes.delete(p);
  };
  const drop = (p: string) => {
    files.delete(p);
    hashes.delete(p);
  };
  return {
    files,
    set(path, text) {
      put(path, utf8(text));
    },
    delete(path) {
      drop(path);
    },
    text(path) {
      const d = files.get(path);
      return d ? new TextDecoder().decode(d) : undefined;
    },
    async list() {
      const out: LocalFile[] = [];
      for (const path of [...files.keys()]) {
        const hash = await hashOf(path);
        if (hash !== null) out.push({ path, hash });
      }
      return out;
    },
    async read(path) {
      return files.get(path)?.slice() ?? null;
    },
    async write(path, data, expect) {
      if ((await hashOf(path)) !== expect) return false;
      put(path, data.slice());
      return true;
    },
    async remove(path, expect) {
      if ((await hashOf(path)) !== expect) return false;
      drop(path);
      return true;
    },
  };
}

/**
 * Top-level folders the encrypted sync leaves out: the trash (as every sync
 * caller does, src/storage/workspace.ts) and git's own internals, which git
 * sync (plan 3.3) moves and which would corrupt a repository if two devices
 * merged them file by file. Other hidden content — `.github/`, `.gitignore`,
 * `.obsidian/` — is the user's and is synced.
 */
const UNSYNCED_ROOTS = new Set([".trash", ".git"]);

/** Whether `path` takes part in the encrypted sync; also refuses empty, `.` and `..` segments. */
export function isSyncedPath(path: string): boolean {
  const segs = path.split("/");
  if (segs.some((seg) => seg === "" || seg === "." || seg === "..")) return false;
  return !UNSYNCED_ROOTS.has(segs[0]);
}

/**
 * The active vault (plan 4.1) as the local side.
 *
 * Known limit: the hash check and the write are two steps, because
 * VaultBackend (and underneath it OPFS, the File System Access API and the
 * desktop file system) has no conditional write. Another program saving the
 * same file in the moment between them is overwritten, and the vault watcher
 * records the sync's write as its own. The window is one stat + read + hash;
 * closing it needs a compare-and-swap write in VaultBackend.
 */
export function vaultLocalFiles(backend: VaultBackend): LocalFiles {
  const hashAt = async (path: string): Promise<string | null> => {
    const st = await backend.stat(path);
    if (!st || st.kind !== "file") return null;
    return sha256Hex(new Uint8Array(await (await backend.read(path)).arrayBuffer()));
  };
  return {
    async list() {
      const out: LocalFile[] = [];
      const walk = async (dir: string): Promise<void> => {
        for (const e of await backend.list(dir)) {
          if (!isSyncedPath(e.path)) continue;
          if (e.kind === "directory") await walk(e.path);
          else out.push({ path: e.path, hash: await sha256Hex(new Uint8Array(await (await backend.read(e.path)).arrayBuffer())) });
        }
      };
      await walk("");
      return out;
    },
    async read(path) {
      const st = await backend.stat(path);
      if (!st || st.kind !== "file") return null;
      return new Uint8Array(await (await backend.read(path)).arrayBuffer());
    },
    async write(path, data, expect) {
      if ((await hashAt(path)) !== expect) return false;
      await backend.write(path, data.slice());
      return true;
    },
    async remove(path, expect) {
      if ((await hashAt(path)) !== expect) return false;
      await backend.remove(path);
      return true;
    },
  };
}
