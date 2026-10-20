/**
 * Safe git pull, the pure part (plan 3.3): decide, per file, what a pull
 * does to the vault. No I/O here — `git.ts` gathers the three versions of
 * every file the remote changed and `gitPull.ts` carries out the plan.
 *
 * For each path the remote changed since the merge base we have:
 *   base   — the file at the merge base (null: not there),
 *   ours   — the file in the vault now (null: not there),
 *   theirs — the file at the fetched commit (null: deleted upstream).
 *
 * The rules, in order (nothing in the vault is ever deleted):
 *   - deleted upstream                → kept here, reported;
 *   - an LFS pointer over a real file → the local file is kept, reported
 *                                        (Git LFS is not supported);
 *   - ours equals theirs              → nothing to do;
 *   - not here (new upstream, or deleted here and changed upstream)
 *                                      → written (nothing local to lose);
 *   - unchanged here (ours = base)    → theirs is written;
 *   - changed on both sides           → a line-based three-way merge
 *     (src/sync/cloud/diff.ts, the one the conflict dialog shows): clean →
 *     the merged text; overlapping edits → a conflict, with the usual
 *     `<<<<<<<` / `=======` / `>>>>>>>` markers, for the resolution screen;
 *     binary files are never merged: ours stays, theirs goes to a copy.
 */
import { threeWayDiff } from "./cloud/diff";

export type Bytes = Uint8Array;

export interface PullEntry {
  /** Path inside the repository (forward slashes, no leading slash). */
  path: string;
  base: Bytes | null;
  ours: Bytes | null;
  theirs: Bytes | null;
}

export type PullAction =
  /** Write `data` to the file (`lfs`: it is an LFS pointer, written because nothing was here). */
  | { kind: "write"; path: string; data: Bytes; why: "upstream" | "merged" | "restored"; lfs?: boolean }
  /** Both sides changed the same lines. `marked` holds both versions between conflict markers. */
  | { kind: "conflict"; path: string; base: string; ours: string; theirs: string; marked: string }
  /** Both sides changed a binary file: ours stays, theirs is kept as a copy next to it. */
  | { kind: "binaryConflict"; path: string; theirs: Bytes }
  /** Deleted upstream, still here: kept (a pull never deletes). */
  | { kind: "keptDeletedUpstream"; path: string }
  /** Upstream holds a Git LFS pointer where this vault has the real file: the file is kept. */
  | { kind: "lfsSkipped"; path: string };

/** The first line of every Git LFS pointer file (https://git-lfs.com/spec/v1). */
export const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";

const decoder = new TextDecoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/** Is this a Git LFS pointer (a small text stub that stands for the real content)? */
export function isLfsPointer(data: Bytes | string | null): boolean {
  if (data === null) return false;
  if (typeof data !== "string") {
    if (data.length > 1024) return false;
    data = decoder.decode(data);
  }
  return data.length <= 1024 && data.startsWith(LFS_POINTER_PREFIX) && /\noid sha256:[0-9a-f]{64}\n/.test(data);
}

/** Binary, for merging: a NUL byte near the start, or not valid UTF-8 (git's own heuristic, plus the UTF-8 check). */
export function isBinary(data: Bytes): boolean {
  const head = data.subarray(0, 8000);
  if (head.includes(0)) return true;
  try {
    strictDecoder.decode(data);
    return false;
  } catch {
    return true;
  }
}

export function sameBytes(a: Bytes | null, b: Bytes | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface MergeLabels {
  ours: string;
  theirs: string;
}

/** Does this text still hold an unresolved conflict (a `<<<<<<<` … `>>>>>>>` block)? */
export function hasConflictMarkers(text: string): boolean {
  return /^<{7}(?: .*)?$/m.test(text) && /^={7}$/m.test(text) && /^>{7}(?: .*)?$/m.test(text);
}

/**
 * Line-based three-way merge. Changes made on one side only are taken;
 * the same change on both sides is taken once; different changes to the
 * same lines are a conflict, written between markers.
 */
export function mergeText(
  base: string,
  ours: string,
  theirs: string,
  labels: MergeLabels = { ours: "local", theirs: "remote" },
): { clean: boolean; text: string } {
  if (ours === theirs) return { clean: true, text: ours };
  if (ours === base) return { clean: true, text: theirs };
  if (theirs === base) return { clean: true, text: ours };
  const out: string[] = [];
  let clean = true;
  for (const h of threeWayDiff(base, ours, theirs)) {
    switch (h.op) {
      case "equal":
      case "local":
      case "both":
        out.push(...h.local);
        break;
      case "remote":
        out.push(...h.remote);
        break;
      case "conflict":
        clean = false;
        out.push(`<<<<<<< ${labels.ours}`, ...h.local, "=======", ...h.remote, `>>>>>>> ${labels.theirs}`);
        break;
    }
  }
  return { clean, text: out.join("\n") };
}

/** Plan a pull. Paths whose upstream version equals the base are not passed in (or produce nothing). */
export function planPull(entries: PullEntry[], labels?: MergeLabels): PullAction[] {
  const actions: PullAction[] = [];
  for (const { path, base, ours, theirs } of entries) {
    if (sameBytes(base, theirs)) continue; // upstream did not change it
    if (theirs === null) {
      if (ours !== null) actions.push({ kind: "keptDeletedUpstream", path });
      continue;
    }
    const lfs = isLfsPointer(theirs);
    if (lfs && ours !== null && !isLfsPointer(ours)) {
      actions.push({ kind: "lfsSkipped", path });
      continue;
    }
    if (sameBytes(ours, theirs)) continue;
    if (ours === null) {
      actions.push({ kind: "write", path, data: theirs, why: base === null ? "upstream" : "restored", ...(lfs ? { lfs } : {}) });
      continue;
    }
    if (sameBytes(ours, base)) {
      actions.push({ kind: "write", path, data: theirs, why: "upstream", ...(lfs ? { lfs } : {}) });
      continue;
    }
    // Changed on both sides (or added on both sides with different content).
    if (isBinary(ours) || isBinary(theirs) || (base !== null && isBinary(base))) {
      actions.push({ kind: "binaryConflict", path, theirs });
      continue;
    }
    const b = base === null ? "" : decoder.decode(base);
    const o = decoder.decode(ours);
    const t = decoder.decode(theirs);
    const merged = mergeText(b, o, t, labels);
    if (merged.clean) {
      if (merged.text !== o) actions.push({ kind: "write", path, data: encoder.encode(merged.text), why: "merged" });
    } else {
      actions.push({ kind: "conflict", path, base: b, ours: o, theirs: t, marked: merged.text });
    }
  }
  return actions;
}

/** `notes/a.md` → `notes/a (from git 1a2b3c4).md`: where a version that could not be merged is kept. */
export function copyPathFor(path: string, label: string): string {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${dir}${stem} (${label})${ext}`;
}
