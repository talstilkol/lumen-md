/**
 * Where the vault lives (plan 4.2): the browser's private storage (OPFS) or
 * a real folder on the user's computer, opened with `showDirectoryPicker`
 * (Chromium: Chrome, Edge, Opera). The folder is a directory-handle vault
 * backend (./handleBackend.ts) — the same code and the same contract as OPFS.
 *
 * - The chosen location is remembered in IndexedDB (a directory handle is
 *   structured-cloneable). On start the folder's permission is checked; when
 *   the browser wants a click first, the vault reports "disconnected" (no
 *   reads, no writes — never a silent fallback to another store) until the
 *   user presses "Reconnect folder" or chooses browser storage.
 * - Moving between locations copies every file, reads each copy back and
 *   compares it byte for byte, checks the whole set once more, and only then
 *   switches. The source is never deleted. Files already at the target with
 *   different content stop the move before anything is written. Progress is
 *   recorded, so an interrupted move (tab closed, quota) resumes where it
 *   stopped instead of starting over.
 */

import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import { log } from "../../lib/logger";
import { notifyWorkspaceChanged } from "../workspaceEvents";
import { getVaultBackend, setVaultBackend } from "./index";
import { createDirectoryHandleBackend } from "./handleBackend";
import { createOpfsBackend } from "./opfs";
import type { VaultBackend } from "./types";

// ── Persistence ──────────────────────────────────────────────────────────

/** Where the vault is, as stored. */
export type StoredLocation = { kind: "opfs" } | { kind: "folder"; handle: FileSystemDirectoryHandle; name: string };

/** An unfinished move, as stored. */
export interface MoveRecord {
  from: StoredLocation;
  to: StoredLocation;
  startedAt: number;
  /** Files this move wrote to the target (a resume may overwrite these, nothing else). */
  written: string[];
  total: number;
}

interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

const LOCATION_KEY = "lumen-vault-location";
const MOVE_KEY = "lumen-vault-move";

let kv: KV = { get: (k) => idbGet(k), set: (k, v) => idbSet(k, v), del: (k) => idbDel(k) };

/** @internal tests: a key-value store that keeps fake handles as they are. */
export function __setLocationStore(store: KV): void {
  kv = store;
}

// ── Status ───────────────────────────────────────────────────────────────

export type VaultStatus =
  | { location: "opfs" }
  | { location: "folder"; name: string }
  /** The vault is a folder the browser wants a click to reopen. */
  | { location: "folder-disconnected"; name: string };

export interface MoveProgress {
  done: number;
  total: number;
  to: string;
}

let status: VaultStatus = { location: "opfs" };
let pending: MoveRecord | null = null;
let progress: MoveProgress | null = null;
let disconnected: { handle: FileSystemDirectoryHandle; name: string; backend: VaultBackend; connect(): void } | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (err) {
      log.warn("vault status listener failed", err);
    }
  }
}

export function getVaultStatus(): VaultStatus {
  return status;
}
/** The interrupted move waiting to be resumed, if any. */
export function getPendingMove(): MoveRecord | null {
  return pending;
}
/** The move in progress, if any. */
export function getMoveProgress(): MoveProgress | null {
  return progress;
}
export function onVaultStatusChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── Folders ──────────────────────────────────────────────────────────────

type PickerWindow = Window & { showDirectoryPicker?: (o?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle> };

/** Can this browser open a real folder? (Chromium yes; Firefox and Safari no.) */
export function isFolderVaultSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";
}

/** Ask the user for a folder (null when they cancel). */
export async function pickVaultFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    // A WebIDL method: it must be called on `window`.
    return await picker.call(window, { id: "lumen-vault", mode: "readwrite" });
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return null;
    throw e;
  }
}

/**
 * Is read-write access to `handle` granted? With `request`, ask for it —
 * which the browser allows only during a user gesture (a click).
 */
export async function ensureFolderPermission(handle: FileSystemDirectoryHandle, request: boolean): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  // Engines without the permission API (and fake handles) are always granted.
  if (typeof h.queryPermission !== "function") return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  if (!request || typeof h.requestPermission !== "function") return false;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

/** A vault backend on a folder; `available()` follows `connected()`. */
export function createFolderBackend(handle: FileSystemDirectoryHandle, connected: () => boolean = () => true): VaultBackend {
  return createDirectoryHandleBackend({
    id: "folder",
    available: connected,
    root: async () => {
      if (!connected()) throw new Error(`The vault folder “${handle.name}” is not connected. Reconnect it first.`);
      return handle;
    },
  });
}

function backendFor(loc: StoredLocation): VaultBackend {
  return loc.kind === "opfs" ? createOpfsBackend() : createFolderBackend(loc.handle);
}

function nameOf(loc: StoredLocation): string {
  return loc.kind === "opfs" ? "" : loc.name;
}

function activate(loc: StoredLocation, backend: VaultBackend): void {
  disconnected = null;
  setVaultBackend(loc.kind === "opfs" ? null : backend);
  status = loc.kind === "opfs" ? { location: "opfs" } : { location: "folder", name: loc.name };
  notifyWorkspaceChanged({ kind: "structure" });
  changed();
}

// ── Start-up ─────────────────────────────────────────────────────────────

/**
 * Restore the stored location before the app reads the vault. A folder whose
 * permission needs a click becomes "folder-disconnected": its backend is
 * active but unavailable, so nothing is read from or written to anywhere
 * else in the meantime.
 */
export async function restoreVaultLocation(): Promise<VaultStatus> {
  try {
    pending = (await kv.get<MoveRecord>(MOVE_KEY)) ?? null;
    const loc = await kv.get<StoredLocation>(LOCATION_KEY);
    if (!loc || loc.kind === "opfs") return status;
    if (await ensureFolderPermission(loc.handle, false)) {
      activate(loc, createFolderBackend(loc.handle));
      return status;
    }
    let granted = false;
    const backend = createFolderBackend(loc.handle, () => granted);
    disconnected = { handle: loc.handle, name: loc.name, backend, connect: () => (granted = true) };
    setVaultBackend(backend);
    status = { location: "folder-disconnected", name: loc.name };
    changed();
  } catch (err) {
    log.warn("restoring the vault location failed; using browser storage", err);
  } finally {
    changed();
  }
  return status;
}

/** "Reconnect folder" (call from a click). True when the folder is open again. */
export async function reconnectVaultFolder(): Promise<boolean> {
  const d = disconnected;
  if (!d) return status.location === "folder";
  if (!(await ensureFolderPermission(d.handle, true))) return false;
  d.connect();
  disconnected = null;
  status = { location: "folder", name: d.name };
  notifyWorkspaceChanged({ kind: "structure" });
  changed();
  return true;
}

/** Work in browser storage (OPFS) from now on, without copying anything. */
export async function switchToBrowserStorage(): Promise<void> {
  await kv.set(LOCATION_KEY, { kind: "opfs" } satisfies StoredLocation);
  activate({ kind: "opfs" }, createOpfsBackend());
}

/** Work in `handle` from now on, without copying anything (e.g. an existing Obsidian vault). */
export async function openFolderAsVault(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (!(await ensureFolderPermission(handle, true))) return false;
  const loc: StoredLocation = { kind: "folder", handle, name: handle.name };
  await kv.set(LOCATION_KEY, loc);
  activate(loc, createFolderBackend(handle));
  return true;
}

// ── Moving ───────────────────────────────────────────────────────────────

/** Files at the target that already exist with different content: nothing was written. */
export class VaultMoveConflictError extends Error {
  constructor(readonly paths: string[]) {
    super(`${paths.length} file(s) already exist at the target with different content: ${paths.slice(0, 3).join(", ")}`);
    this.name = "VaultMoveConflictError";
  }
}

/** The browser did not grant read-write access to the folder. */
export class VaultPermissionError extends Error {
  constructor(readonly folder: string) {
    super(`No permission to edit “${folder}”`);
    this.name = "VaultPermissionError";
  }
}

export interface MoveReport {
  files: number;
  bytes: number;
  /** Files already identical at the target (a resume, or a merge into an existing folder). */
  unchanged: number;
}

/** Every file path of `b`, dot entries (the trash) included. */
async function allFiles(b: VaultBackend, dir = "", out: string[] = []): Promise<string[]> {
  for (const e of await b.list(dir)) {
    if (e.kind === "directory") await allFiles(b, e.path, out);
    else out.push(e.path);
  }
  return out;
}

async function bytes(b: VaultBackend, path: string): Promise<Uint8Array> {
  return new Uint8Array(await (await b.read(path)).arrayBuffer());
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function targetBytes(b: VaultBackend, path: string): Promise<Uint8Array | null> {
  const st = await b.stat(path);
  if (!st) return null;
  if (st.kind !== "file") throw new VaultMoveConflictError([path]);
  return bytes(b, path);
}

/**
 * Move the vault from where it is now to `to`: copy, verify byte for byte,
 * then switch. The source is left as it was. Resumes a recorded move to the
 * same target. Throws `VaultMoveConflictError` (nothing written) when the
 * target holds different files at the same paths.
 */
export async function moveVault(
  to: StoredLocation,
  opts: { onProgress?: (p: MoveProgress) => void; from?: StoredLocation } = {},
): Promise<MoveReport> {
  // First, while the click that started this still counts as a user gesture.
  if (to.kind === "folder" && !(await ensureFolderPermission(to.handle, true))) {
    throw new VaultPermissionError(to.name);
  }
  const fromLoc: StoredLocation = opts.from ?? ((await kv.get<StoredLocation>(LOCATION_KEY)) || { kind: "opfs" });
  const source = getVaultBackend();
  if (!source.available()) throw new Error("The current vault is not available.");
  if (await sameLocation(fromLoc, to)) throw new Error("The vault is already there.");
  const target = backendFor(to);
  const resuming = pending && (await sameLocation(pending.to, to)) ? pending : null;
  const written = new Set(resuming?.written ?? []);
  const report = (done: number, total: number) => {
    progress = { done, total, to: nameOf(to) };
    opts.onProgress?.(progress);
    changed();
  };

  try {
    const files = (await allFiles(source)).sort();
    report(0, files.length);

    // 1. Nothing is written while any target file differs and is not ours.
    const conflicts: string[] = [];
    for (const path of files) {
      const there = await targetBytes(target, path).catch((e) => {
        if (e instanceof VaultMoveConflictError) return "conflict" as const;
        throw e;
      });
      if (there === "conflict") conflicts.push(path);
      else if (there && !written.has(path) && !same(there, await bytes(source, path))) conflicts.push(path);
    }
    if (conflicts.length) throw new VaultMoveConflictError(conflicts);

    const record: MoveRecord = { from: fromLoc, to, startedAt: resuming?.startedAt ?? Date.now(), written: [...written], total: files.length };
    await kv.set(MOVE_KEY, record);
    pending = record;

    // 2. Copy each file and read it back.
    let total = 0;
    let unchanged = 0;
    for (const [i, path] of files.entries()) {
      const data = await bytes(source, path);
      total += data.byteLength;
      const there = await targetBytes(target, path);
      if (there && same(there, data)) {
        unchanged++;
      } else {
        await target.write(path, data);
        if (!same(await bytes(target, path), data)) throw new Error(`The copy of “${path}” does not match the original.`);
        written.add(path);
        record.written = [...written];
        await kv.set(MOVE_KEY, record);
      }
      report(i + 1, files.length);
    }

    // 3. The whole set once more, then switch.
    for (const path of files) {
      const there = await targetBytes(target, path);
      if (!there || !same(there, await bytes(source, path))) throw new Error(`“${path}” changed or went missing during the move; resume to copy it again.`);
    }
    await kv.set(LOCATION_KEY, to);
    await kv.del(MOVE_KEY);
    pending = null;
    progress = null;
    activate(to, target);
    return { files: files.length, bytes: total, unchanged };
  } catch (e) {
    progress = null;
    changed();
    throw e;
  }
}

/** Drop the record of an interrupted move. The files it copied stay where they are. */
export async function cancelPendingMove(): Promise<void> {
  await kv.del(MOVE_KEY);
  pending = null;
  changed();
}

async function sameLocation(a: StoredLocation, b: StoredLocation): Promise<boolean> {
  if (a.kind === "opfs" || b.kind === "opfs") return a.kind === b.kind;
  if (a.handle === b.handle) return true;
  const f = (a.handle as { isSameEntry?: (o: FileSystemHandle) => Promise<boolean> }).isSameEntry;
  return typeof f === "function" ? await f.call(a.handle, b.handle).catch(() => false) : false;
}

/** @internal tests */
export function __resetVaultLocation(): void {
  status = { location: "opfs" };
  pending = null;
  progress = null;
  disconnected = null;
  setVaultBackend(null);
}
