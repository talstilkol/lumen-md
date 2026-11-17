/**
 * A vault backend over a `FileSystemDirectoryHandle` — the one place that
 * walks file-system handles (getDirectoryHandle / getFileHandle /
 * createWritable / removeEntry).
 *
 * The OPFS backend (./opfs.ts) is this with the OPFS root; a folder the
 * user picked with `showDirectoryPicker` is the same API, so the Chromium
 * real-folder vault (plan 4.3) and the folder export reuse it unchanged.
 *
 * The File System Access API has no rename for files in every engine
 * (`FileSystemHandle.move` is not universal), so a rename copies and then
 * deletes, removing a half-written target when the copy fails.
 */

import { checkRename, compareVaultEntries, PathLock, VaultEmitter, vaultSegments } from "./shared";
import type { HandleCasHost } from "./cas";
import {
  VaultError,
  VaultNotFoundError,
  WorkspaceConflictError,
  type VaultBackend,
  type VaultData,
  type VaultEntry,
  type VaultEvent,
  type VaultStat,
} from "./types";
import { swallowed } from "../../lib/logger";

export interface DirectoryHandleBackendOptions {
  id: string;
  /**
   * The root folder. Called for every operation (not cached), so a root
   * that changes — a fresh OPFS in tests, a re-picked folder — is used at once.
   */
  root: () => Promise<FileSystemDirectoryHandle>;
  /** Defaults to "always". */
  available?: () => boolean;
  /**
   * Writes for engines whose file handles have no `createWritable` on the
   * main thread (OPFS in Safari before 26 / Playwright WebKit). Gets the
   * path segments relative to `root`.
   */
  writeFallback?: (segments: string[], data: VaultData) => Promise<void>;
  /**
   * W11.Q10: the write to try first (OPFS: the sync-access-handle worker).
   * Resolves true when it wrote the file, false when this engine cannot use
   * it, and the usual path (createWritable, else writeFallback) runs instead.
   */
  writePrimary?: (segments: string[], data: VaultData) => Promise<boolean>;
  /**
   * The #856 follow-up: the read to try first (OPFS: the worker, batched).
   * Resolves the file's bytes, or null when the usual main-thread read
   * should answer (not found there, or this engine cannot use it). The
   * usual read reports not-found and recovers interrupted saves.
   */
  readPrimary?: (segments: string[]) => Promise<Blob | null>;
  /** Is a `writeFallback` or `writePrimary` save still running (its temporary files are not leftovers yet)? */
  writesPending?: () => boolean;
}

/** Names an interrupted atomic save leaves (./atomic.ts, written by the OPFS worker). */
/** Files whose size and time a listing asks for at once (W6.36). */
const LIST_STAT_BATCH = 64;
const isSaveLeftover = (name: string) => name.startsWith(".lumen-old~") || name.startsWith(".lumen-tmp~") || /^\.lumen-(tmp|old|jnl)-[0-9a-f]{16}$/.test(name);

type Found =
  | { kind: "file"; handle: FileSystemFileHandle }
  | { kind: "directory"; handle: FileSystemDirectoryHandle };

/** OPFS signals "not there" and "not that kind" with these DOMException names. */
function isMissing(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "NotFoundError" || name === "TypeMismatchError";
}

export function createDirectoryHandleBackend(o: DirectoryHandleBackendOptions): VaultBackend {
  const events = new VaultEmitter();
  const emit = (e: Omit<VaultEvent, "origin">) => events.emit({ ...e, origin: "self" });
  /** write / writeMany / remove / writeIf / removeIf on one path, one at a time (2.28, #275). */
  const pathLock = new PathLock();

  async function dirAt(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let cur = await o.root();
    for (const part of parts) cur = await cur.getDirectoryHandle(part, { create });
    return cur;
  }

  /** The files directly in the folder at `parts`, by name, from one listing (a bulk read or write, W7.4). */
  async function filesIn(parts: string[]): Promise<Map<string, FileSystemFileHandle>> {
    const dir = await dirAt(parts, false);
    const files = new Map<string, FileSystemFileHandle>();
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (h.kind === "file") files.set(name, h as FileSystemFileHandle);
    }
    return files;
  }

  /** What is at `parts`, or null. Errors other than "not there" propagate. */
  async function lookup(parts: string[]): Promise<Found | null> {
    if (!parts.length) return { kind: "directory", handle: await o.root() };
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await dirAt(parts.slice(0, -1), false);
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
    const name = parts[parts.length - 1];
    try {
      return { kind: "file", handle: await parent.getFileHandle(name) };
    } catch (e) {
      if (!isMissing(e)) throw e;
    }
    try {
      return { kind: "directory", handle: await parent.getDirectoryHandle(name) };
    } catch (e) {
      if (!isMissing(e)) throw e;
    }
    return null;
  }

  async function fileAt(parts: string[], path: string): Promise<FileSystemFileHandle> {
    if (!parts.length) throw new VaultNotFoundError(path);
    try {
      const dir = await dirAt(parts.slice(0, -1), false);
      return await dir.getFileHandle(parts[parts.length - 1]);
    } catch (e) {
      if (isMissing(e)) throw new VaultNotFoundError(path);
      throw e;
    }
  }

  /**
   * The file at `path`, read under its path lock, finishing an interrupted save of it first when it is missing.
   * Review Z7-M2: the OPFS worker's atomic save renames the note away and back, so between the two renames the name
   * does not exist. Every write of the note holds this lock until the worker has answered, so a read under it never
   * falls into that window. Recovery runs outside the lock (it takes the lock itself for each note, Z6-L3).
   */
  async function fileRecovered(path: string): Promise<File> {
    const parts = vaultSegments(path);
    const once = () => pathLock.run(parts.join("/"), async () => (await fileAt(parts, path)).getFile());
    try {
      return await once();
    } catch (e) {
      if (!(e instanceof VaultNotFoundError) || !parts.length || !(await recoverIn(parts.slice(0, -1)))) throw e;
      return await once();
    }
  }

  async function writeAt(parts: string[], data: VaultData, path: string): Promise<void> {
    if (!parts.length) throw new VaultError("EKIND", path, "Cannot write to the vault root");
    let handle: FileSystemFileHandle;
    try {
      const dir = await dirAt(parts.slice(0, -1), true);
      handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    } catch (e) {
      if (isMissing(e)) throw new VaultError("EKIND", path, `Cannot write "${path}": a file or folder of that name is in the way`);
      throw e;
    }
    if (o.writePrimary && (await o.writePrimary(parts, data))) return;
    if (typeof (handle as { createWritable?: unknown }).createWritable !== "function") {
      if (!o.writeFallback) throw new Error("This browser cannot write files here.");
      return o.writeFallback(parts, data);
    }
    const writable = await handle.createWritable();
    try {
      await writable.write(data as FileSystemWriteChunkType);
    } catch (e) {
      // Drop the half-written swap file instead of leaving the stream open.
      await (writable as { abort?: () => Promise<void> }).abort?.().catch(() => undefined);
      throw e;
    }
    await writable.close();
  }

  async function removeAt(parts: string[], path: string): Promise<void> {
    if (!parts.length) throw new VaultError("EINVAL", path, "Cannot delete the workspace root");
    try {
      const parent = await dirAt(parts.slice(0, -1), false);
      await parent.removeEntry(parts[parts.length - 1], { recursive: true });
    } catch (e) {
      if (isMissing(e)) throw new VaultNotFoundError(path);
      throw e;
    }
  }

  async function copyTree(dir: FileSystemDirectoryHandle, to: string[]): Promise<void> {
    await dirAt(to, true);
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") await copyTree(handle as FileSystemDirectoryHandle, [...to, name]);
      else await writeAt([...to, name], await (handle as FileSystemFileHandle).getFile(), [...to, name].join("/"));
    }
  }

  /** Do two handles name the same entry? (Only real folders can alias; engines without isSameEntry say no.) */
  async function sameEntry(a: FileSystemHandle, b: FileSystemHandle): Promise<boolean> {
    const f = (a as { isSameEntry?: (other: FileSystemHandle) => Promise<boolean> }).isSameEntry;
    return typeof f === "function" ? await f.call(a, b) : false;
  }

  /** The existing folders strictly above `parts` (root excluded), outermost first; stops at the first missing one. */
  async function existingAncestors(parts: string[]): Promise<FileSystemDirectoryHandle[]> {
    const out: FileSystemDirectoryHandle[] = [];
    let cur = await o.root();
    for (const part of parts.slice(0, -1)) {
      try {
        cur = await cur.getDirectoryHandle(part);
      } catch (e) {
        if (isMissing(e)) break;
        throw e;
      }
      out.push(cur);
    }
    return out;
  }

  /** Copy `source` to `dst` (replacing `target`, when set), then delete the source. No event. */
  async function move(src: string[], dstParts: string[], source: Found, target: Found | null): Promise<void> {
    const dst = dstParts.join("/");
    // Replacing: a folder at the target (or a folder replacing a file)
    // goes first, so nothing of the old entry merges into the new one.
    // (A file replacing a file is written in place: an aborted write
    // leaves the old content.)
    let cleared = false;
    if (target && (target.kind === "directory" || source.kind === "directory")) {
      await removeAt(dstParts, dst);
      cleared = true;
    }
    try {
      if (source.kind === "directory") await copyTree(source.handle, dstParts);
      else await writeAt(dstParts, await source.handle.getFile(), dst);
    } catch (e) {
      // A copy that failed half way (quota, write error) must not leave a
      // partial tree at the target: it would block a retry, or sit at the
      // name of an original that a replace moved to the trash. The source
      // is untouched either way.
      if (!target || cleared) await removeAt(dstParts, dst).catch((e: unknown) => swallowed("storage/vault/handleBackend: a half-made copy at the move target could not be removed", e));
      throw e;
    }
    await removeAt(src, src.join("/"));
  }

  /**
   * Finish or undo a save the OPFS worker was stopped in the middle of
   * (./atomic.ts) in folder `dirParts`. The recovery code loads only when
   * such leftovers are there. Returns whether anything was done.
   */
  // Folders found without leftovers in this session. Leftovers come from a
  // run that was stopped (a failed save removes its own), so a clean folder
  // stays clean and a missing file costs one scan of its folder at most.
  const clean = new Set<string>();
  async function recoverIn(dirParts: string[]): Promise<boolean> {
    const key = dirParts.join("/");
    if (clean.has(key) || o.writesPending?.()) return false;
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await dirAt(dirParts, false);
    } catch {
      return false;
    }
    const names: string[] = [];
    for await (const [name] of dir.entries()) names.push(name);
    if (!names.some(isSaveLeftover)) {
      clean.add(key);
      return false;
    }
    const { recoverHandleDir } = await import("./atomic");
    await recoverHandleDir<Found>(
      {
        lookup,
        move,
        removeAt,
        writeAt,
        segments: vaultSegments,
        fileSize: async (f) => (f.kind === "file" ? (await f.handle.getFile()).size : null),
        fileBytes: async (f) => {
          if (f.kind !== "file") throw new Error("a folder, not a file");
          return new Uint8Array(await (await f.handle.getFile()).arrayBuffer());
        },
        // Z6-L3: each note's recovery under its path lock; recoverIn is never called with a path lock held.
        lockTarget: (path, fn) => pathLock.run(vaultSegments(path).join("/"), fn),
      },
      key,
      names,
    );
    clean.add(key);
    return true;
  }

  /** rename's work, holding the path locks of `r.src` and `r.dst` (no event). */
  async function renameLocked(r: NonNullable<ReturnType<typeof checkRename>>, from: string, to: string, opts: { overwrite?: boolean }): Promise<void> {
    const target = await lookup(r.dst);
    const source = await lookup(r.src);
    if (!source) throw new VaultNotFoundError(from);
    const alias = !!target && (await sameEntry(source.handle, target.handle));
    if (target && !alias && !opts.overwrite) throw new WorkspaceConflictError(to);
    // The textual checks (checkRename) miss aliases on a case-insensitive
    // or normalising real folder: "Folder" → "folder/sub" is a move into
    // itself, and replacing a folder that holds the source deletes it.
    if (source.kind === "directory") {
      for (const h of await existingAncestors(r.dst)) {
        if (await sameEntry(source.handle, h)) throw new VaultError("EINVAL", to, `Cannot move "${from}" into itself`);
      }
    }
    if (target && !alias && target.kind === "directory") {
      for (const h of await existingAncestors(r.src)) {
        if (await sameEntry(target.handle, h)) throw new VaultError("EINVAL", to, `Cannot replace "${to}" with "${from}", which is inside it`);
      }
    }
    if (alias) {
      // Two spellings of one entry (a case-only or normalisation-only
      // rename on a case-insensitive / normalising real folder): go
      // through a temporary name, or "replacing" the target would delete
      // the source itself.
      const tmp = [...r.dst.slice(0, -1), `.lumen-rename-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`];
      await move(r.src, tmp, source, null);
      const staged = await lookup(tmp);
      if (!staged) throw new VaultNotFoundError(tmp.join("/"));
      try {
        await move(tmp, r.dst, staged, null);
      } catch (e) {
        // Put the entry back under its original name rather than leave it
        // only under the hidden temporary one.
        const left = await lookup(tmp).catch(() => null);
        if (left) await move(tmp, r.src, left, null).catch((e: unknown) => swallowed("storage/vault/handleBackend: a file set aside for a move could not be put back; it is under its temporary name", e));
        throw e;
      }
    } else {
      await move(r.src, r.dst, source, target);
    }
  }

  /** What the lazy compare-and-swap (./cas.ts) needs of this backend. */
  const casHost: HandleCasHost = {
    lookup,
    removeAt,
    createFile: async (parts) => (await dirAt(parts.slice(0, -1), true)).getFileHandle(parts[parts.length - 1], { create: true }),
    openWritable: (handle) => handle.createWritable(),
    writeFallback: o.writeFallback,
  };
  /** writeIf / removeIf: the lazy compare-and-swap under the path lock; the event only for a swap that happened. */
  const swap = async (path: string, type: "write" | "delete", run: (cas: typeof import("./cas"), parts: string[]) => Promise<boolean>) => {
    const parts = vaultSegments(path);
    const p = parts.join("/");
    // An interrupted atomic save of this file (./atomic.ts) is finished or undone first, as read() does: before the
    // lock is taken (the recovery takes it for each note it restores, Z6-L3), and the swap compares again under it.
    if (parts.length && !(await lookup(parts))) await recoverIn(parts.slice(0, -1));
    const ok = await pathLock.run(p, async () => run(await import("./cas"), parts));
    if (ok) emit({ type, path: p });
    return ok;
  };

  return {
    id: o.id,

    available: () => (o.available ? o.available() : true),

    async list(dir) {
      const parts = vaultSegments(dir);
      let handle: FileSystemDirectoryHandle;
      try {
        handle = await dirAt(parts, false);
      } catch (e) {
        if (isMissing(e)) throw new VaultNotFoundError(dir);
        throw e;
      }
      const out: VaultEntry[] = [];
      let leftovers = false;
      const files: Array<{ name: string; path: string; handle: FileSystemFileHandle }> = [];
      for await (const [name, child] of handle.entries()) {
        if (isSaveLeftover(name)) leftovers = true;
        const path = [...parts, name].join("/");
        if (child.kind === "directory") out.push({ name, path, kind: "directory" });
        else files.push({ name, path, handle: child as FileSystemFileHandle });
      }
      // W6.36: the files' size and time are asked for in batches, not one
      // after another (100 folders × 50 notes in Chromium's OPFS: 1.8–4.1 s
      // one by one, 0.6–1.7 s in batches; scripts/perf/encrypted-vault-open).
      for (let i = 0; i < files.length; i += LIST_STAT_BATCH) {
        const batch = files.slice(i, i + LIST_STAT_BATCH);
        const stats = await Promise.all(batch.map((f) => f.handle.getFile().then((file) => file, () => null)));
        batch.forEach(({ name, path }, k) => {
          const file = stats[k];
          out.push(file ? { name, path, kind: "file", size: file.size, mtime: file.lastModified } : { name, path, kind: "file" });
        });
      }
      // An interrupted save: finish or undo it, then list again.
      if (leftovers && (await recoverIn(parts))) return this.list(dir);
      if (!leftovers) clean.add(parts.join("/"));
      return out.sort(compareVaultEntries);
    },

    async stat(path): Promise<VaultStat | null> {
      const parts = vaultSegments(path);
      let found = await lookup(parts);
      // Z7-M2: not there may be a save between its two renames; ask again once this note's write has finished.
      if (!found && parts.length) found = await pathLock.run(parts.join("/"), () => lookup(parts));
      if (!found && parts.length && (await recoverIn(parts.slice(0, -1)))) found = await lookup(parts);
      if (!found) return null;
      if (found.kind === "directory") return { kind: "directory", size: 0, mtime: 0 };
      try {
        const file = await found.handle.getFile();
        return { kind: "file", size: file.size, mtime: file.lastModified };
      } catch (e) {
        if (isMissing(e)) return null; // deleted in between
        // The file is there but cannot be read right now (e.g. a writer
        // holds it): it still exists — an existence check must not say no.
        return { kind: "file", size: 0, mtime: 0 };
      }
    },

    async read(path) {
      const fast = o.readPrimary ? await o.readPrimary(vaultSegments(path)) : null;
      if (fast) return fast;
      return await fileRecovered(path);
    },

    async readText(path) {
      const fast = o.readPrimary ? await o.readPrimary(vaultSegments(path)) : null;
      if (fast) return await fast.text();
      return await (await fileRecovered(path)).text();
    },

    async readMany(paths) {
      const out = new Map<string, File>();
      const byDir = new Map<string, string[][]>();
      for (const p of paths) {
        const parts = vaultSegments(p);
        if (!parts.length) continue;
        const key = parts.slice(0, -1).join("/");
        byDir.set(key, [...(byDir.get(key) ?? []), parts]);
      }
      await Promise.all(
        [...byDir.values()].map(async (group) => {
          let files: Map<string, FileSystemFileHandle>;
          try {
            files = await filesIn(group[0].slice(0, -1));
          } catch {
            // why: the folder is not there; each path then takes read(), which says so
            return;
          }
          // A few at a time: a thousand getFile() calls at once queue up in the browser's storage process.
          let next = 0;
          const take = async () => {
            while (next < group.length) {
              const parts = group[next++];
              const h = files.get(parts[parts.length - 1]);
              if (!h) continue;
              try {
                out.set(parts.join("/"), await h.getFile());
              } catch (err) {
                // why: held by a writer or gone: left to read()
                swallowed("storage/vault/handleBackend: held by a writer or gone: left to read()", err);
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(16, group.length) }, take));
        }),
      );
      return out;
    },

    async writeMany(items, lock) {
      const out = new Map<string, boolean | Error>();
      const dirs = new Map<string, Promise<Map<string, FileSystemFileHandle>>>();
      const handleOf = async (parts: string[]) => {
        const key = parts.slice(0, -1).join("/");
        let files = dirs.get(key);
        if (!files) dirs.set(key, (files = filesIn(parts.slice(0, -1)).catch(() => new Map<string, FileSystemFileHandle>())));
        return (await files).get(parts[parts.length - 1]) ?? null;
      };
      let next = 0;
      const worker = async () => {
        while (next < items.length) {
          const it = items[next++];
          const parts = vaultSegments(it.path);
          const key = parts.join("/");
          try {
            const done = await lock(it.path, () => pathLock.run(key, async () => {
              const h = await handleOf(parts);
              if (!h) return false;
              const f = await h.getFile();
              if (!it.expect.mtime || f.size !== it.expect.size || f.lastModified !== it.expect.mtime) return false;
              if (typeof (h as { createWritable?: unknown }).createWritable !== "function") await writeAt(parts, it.data, it.path);
              else {
                const writable = await h.createWritable();
                try {
                  await writable.write(it.data as FileSystemWriteChunkType);
                } catch (e) {
                  await (writable as { abort?: () => Promise<void> }).abort?.().catch(() => undefined);
                  throw e;
                }
                await writable.close();
              }
              emit({ type: "write", path: key });
              return true;
            }));
            out.set(it.path, done);
          } catch (e) {
            out.set(it.path, e instanceof Error ? e : new Error(String(e)));
          }
        }
      };
      // OPFS writes don't get faster past a handful in flight (measured: 4–64 all ≈ the same); 8 keeps the lock queue short.
      await Promise.all(Array.from({ length: Math.min(8, items.length) }, worker));
      return out;
    },

    async write(path, data) {
      const parts = vaultSegments(path);
      const p = parts.join("/");
      await pathLock.run(p, () => writeAt(parts, data, path));
      emit({ type: "write", path: p });
    },

    writeIf: (path, data, expect) => swap(path, "write", (cas, parts) => cas.handleWriteIf(casHost, parts, path, data, expect)),

    removeIf: (path, expect) => swap(path, "delete", (cas, parts) => cas.handleRemoveIf(casHost, parts, path, expect)),

    async mkdir(path) {
      const parts = vaultSegments(path);
      if (!parts.length) return;
      try {
        await dirAt(parts, true);
      } catch (e) {
        if (isMissing(e)) throw new VaultError("EKIND", path, `Cannot create folder "${path}": a file is in the way`);
        throw e;
      }
      emit({ type: "mkdir", path: parts.join("/") });
    },

    async rename(from, to, opts = {}) {
      const r = checkRename(from, to);
      if (!r) return;
      // Z6-L3: under the lock of the source and the target path (in ascending order, PathLock.runAll), so a rename
      // onto a note never lands between a writeIf's compare and its swap.
      await pathLock.runAll([r.src.join("/"), r.dst.join("/")], () => renameLocked(r, from, to, opts));
      emit({ type: "rename", path: r.dst.join("/"), from: r.src.join("/") });
    },

    async remove(path) {
      const parts = vaultSegments(path);
      const p = parts.join("/");
      await pathLock.run(p, () => removeAt(parts, path));
      emit({ type: "delete", path: p });
    },

    watch: (listener) => events.on(listener),

    notifyExternal: (event) => events.emit({ ...event, origin: "external" }),
  };
}
