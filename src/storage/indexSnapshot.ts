/**
 * W2.22 — the vault index survives a restart. After the index changes, the
 * notes it holds (path, mtime, text) are written to IndexedDB while the
 * browser is idle. The next open lists the vault and takes every note whose
 * mtime still matches from the snapshot, reading only the rest: a 100,000-
 * note vault opens without 100,000 file reads.
 *
 * The snapshot is a cache, never the truth: a note's text is used only if
 * the vault still lists it with the same mtime, and a missing, old-format or
 * unreadable snapshot just means a full build, as before.
 *
 * W6.36: in an encrypted vault the snapshot is sealed and signed with the
 * snapshot subkeys (./snapshotSeal.ts) — given `keys`, only a sealed record
 * is written or accepted. Without `keys` (a plain vault) only a plain one
 * is. A record of the other kind, or one that fails its checks, is refused
 * and deleted: the open builds in full, as with no snapshot.
 */
import { createStore, get, set, del } from "idb-keyval";
import { isSealedSnapshot, openSnapshot, sealSnapshot, type SnapshotKeys } from "./snapshotSeal";

export const SNAPSHOT_VERSION = 1;

export interface SnapshotFile {
  path: string;
  name: string;
  modified: number;
  content: string;
}

interface Stored {
  v: number;
  /** Which vault (workspace name), so two vaults never share one snapshot. */
  vault: string;
  /** Columns rather than objects: a third less to clone at 100,000 notes. */
  paths: string[];
  names: string[];
  modified: number[];
  contents: string[];
}

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("lumen-vault-index", "snapshot"));
const KEY = "notes";

export function encodeSnapshot(vault: string, files: Iterable<SnapshotFile>): Stored {
  const s: Stored = { v: SNAPSHOT_VERSION, vault, paths: [], names: [], modified: [], contents: [] };
  for (const f of files) {
    s.paths.push(f.path);
    s.names.push(f.name);
    s.modified.push(f.modified);
    s.contents.push(f.content);
  }
  return s;
}

/** The snapshot as a path → file map, or null if it is missing, for another vault or malformed. */
export function decodeSnapshot(raw: unknown, vault: string): Map<string, SnapshotFile> | null {
  const s = raw as Stored | undefined;
  if (!s || s.v !== SNAPSHOT_VERSION || s.vault !== vault) return null;
  const n = s.paths?.length;
  if (!Array.isArray(s.paths) || ![s.names, s.modified, s.contents].every((c) => Array.isArray(c) && c.length === n)) return null;
  const out = new Map<string, SnapshotFile>();
  for (let i = 0; i < n; i++) {
    const path = s.paths[i];
    const content = s.contents[i];
    if (typeof path !== "string" || typeof content !== "string" || typeof s.modified[i] !== "number") return null;
    out.set(path, { path, name: String(s.names[i]), modified: s.modified[i], content });
  }
  return out;
}

/** What the last `loadSnapshot` found: for tests and the perf receipt. */
export type SnapshotOutcome = "none" | "restored" | "refused";
export let lastSnapshotOutcome: SnapshotOutcome = "none";

/**
 * The stored record as a snapshot. Given `keys` it must be sealed by them
 * for this vault; without, it must be plain. Anything else is refused
 * (null), and `refused` is set when a record was there but not taken.
 */
export async function readSnapshotRecord(raw: unknown, vault: string, keys?: SnapshotKeys): Promise<{ snap: Map<string, SnapshotFile> | null; refused: boolean }> {
  if (raw === undefined) return { snap: null, refused: false };
  if (!keys) {
    const snap = isSealedSnapshot(raw) ? null : decodeSnapshot(raw, vault);
    return { snap, refused: !snap };
  }
  let plain: Uint8Array;
  try {
    plain = await openSnapshot(keys, vault, raw);
  } catch {
    return { snap: null, refused: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
  } catch {
    return { snap: null, refused: true };
  }
  const snap = decodeSnapshot(parsed, vault);
  return { snap, refused: !snap };
}

export async function loadSnapshot(vault: string, keys?: SnapshotKeys): Promise<Map<string, SnapshotFile> | null> {
  lastSnapshotOutcome = "none";
  try {
    const { snap, refused } = await readSnapshotRecord(await get(KEY, db()), vault, keys);
    if (refused) {
      lastSnapshotOutcome = "refused";
      // A tampered, foreign or wrong-kind record is never tried again.
      await del(KEY, db()).catch(() => {});
    } else if (snap) lastSnapshotOutcome = "restored";
    return snap;
  } catch {
    return null;
  }
}

/** The record to store: plain, or sealed with `keys` (W6.36). */
export async function snapshotRecord(vault: string, files: Iterable<SnapshotFile>, keys?: SnapshotKeys): Promise<unknown> {
  const plain = encodeSnapshot(vault, files);
  if (!keys) return plain;
  return sealSnapshot(keys, vault, new TextEncoder().encode(JSON.stringify(plain)));
}

export async function saveSnapshot(vault: string, files: Iterable<SnapshotFile>, keys?: SnapshotKeys): Promise<void> {
  try {
    await set(KEY, await snapshotRecord(vault, files, keys), db());
  } catch {
    // Quota or private mode: the next open builds in full, as before.
    await del(KEY, db()).catch(() => {});
  }
}

export async function dropSnapshot(): Promise<void> {
  await del(KEY, db()).catch(() => {});
}

/** Test hooks (W6.36): the stored record as it is, and a record put in its place. */
export async function __snapshotRecord(): Promise<unknown> {
  return get(KEY, db());
}
export async function __putSnapshotRecord(v: unknown): Promise<void> {
  await set(KEY, v, db());
}
