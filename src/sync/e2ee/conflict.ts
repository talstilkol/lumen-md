/**
 * Conflict resolution for the encrypted sync (plan 3.4, step 3).
 *
 * The engine settles every case it can without asking: one side changed,
 * both sides made the same change, or an edit raced a deletion (the edit
 * wins — a deletion never destroys an edit it did not see). Only "both sides
 * edited the same file differently" reaches a `ConflictResolver`. In the app
 * that is the existing three-way ConflictDialog for text and "keep both" for
 * binary files; tests plug in their own.
 */

import { fromUtf8, utf8 } from "./bytes";
import { mergeText } from "../merge/textMerge";
import { keepBothVersions } from "../merge/keepVersions";
import { swallowed } from "../../lib/logger";

export interface ConflictInput {
  path: string;
  /** The common ancestor, when the device still has it. */
  base: Uint8Array | null;
  local: Uint8Array;
  remote: Uint8Array;
}

/**
 *   content  — the path gets `data` (a merge);
 *   local    — keep this device's version;
 *   remote   — take the other device's version;
 *   keepBoth — keep this device's version at the path and the other one as a conflict copy next to it;
 *   conflictFile — Syncthing's way (plan W11.S6): the path gets the other device's version, and this
 *              device's goes to `<name>.sync-conflict-<YYYYMMDD-HHMMSS>-<device>.<ext>` next to it;
 *   hold     — decide later: nothing changes on either side, and the next round asks again.
 */
export type ConflictResolution =
  | { kind: "content"; data: Uint8Array }
  | { kind: "local" }
  | { kind: "remote" }
  | { kind: "keepBoth" }
  | { kind: "conflictFile" }
  | { kind: "hold" };

export type ConflictResolver = (c: ConflictInput) => Promise<ConflictResolution>;

/** The bytes as text, or null when they are not UTF-8 text (a binary file). */
export function asText(b: Uint8Array): string | null {
  try {
    const s = fromUtf8(b);
    return s.includes("\u0000") ? null : s;
  } catch {
    return null;
  }
}

/** Never loses either side and never asks: the default without a UI. */
export const keepBothResolver: ConflictResolver = async () => ({ kind: "keepBoth" });

/**
 * Merge first (plan W1.9): a text file both devices changed goes through the
 * app's merge engine (../merge/textMerge.ts — front matter by key, lines,
 * then words). A clean merge is the answer, and both versions are kept in
 * the note's history; only what overlaps reaches `next`.
 */
export function mergeFirst(next: ConflictResolver, keep: (path: string, ours: string, theirs: string) => Promise<void> = keepBothVersions): ConflictResolver {
  return async (c) => {
    const local = asText(c.local);
    const remote = asText(c.remote);
    const base = c.base ? asText(c.base) : null;
    if (local !== null && remote !== null && base !== null) {
      const r = mergeText(base, local, remote);
      if (r.clean) {
        await keep(c.path, local, remote);
        return { kind: "content", data: utf8(r.text) };
      }
    }
    return next(c);
  };
}

/**
 * The three-way ConflictDialog (loaded on demand) for text, "keep both" for
 * binary files. Cancelling the dialog holds the file until the next round.
 */
const askResolver: ConflictResolver = async (c) => {
  const local = asText(c.local);
  const remote = asText(c.remote);
  if (local === null || remote === null) return { kind: "keepBoth" };
  const base = (c.base && asText(c.base)) ?? "";
  // The strings load with the dialog, not with the engine: the engine also runs outside Vite (scripts/bench/sync-first.ts under tsx),
  // where the i18n module's import.meta.glob does not exist.
  const [{ openConflictDialog }, { t }] = await Promise.all([import("../cloud/ConflictDialog"), import("../../i18n"), import("./strings")]);
  const choice = await openConflictDialog({
    path: c.path,
    base,
    local,
    remote,
    labels: {
      title: t("e2ee.conflict.title", { path: c.path }),
      description: t("e2ee.conflict.body"),
      local: t("external.conflict.mine"),
      remote: t("external.conflict.theirs"),
      takeLocal: t("external.conflict.takeMine"),
      takeRemote: t("external.conflict.takeTheirs"),
      merge: t("external.conflict.merge"),
      cancel: t("e2ee.conflict.later"),
    },
  });
  if (!choice) return { kind: "hold" };
  if (choice.kind === "merged") return { kind: "content", data: utf8(choice.content) };
  return { kind: choice.kind };
};

/** The app's resolver: merge automatically, and ask only about what overlaps. */
export const dialogResolver: ConflictResolver = mergeFirst(askResolver);

/**
 * `dir/name (conflict <tag>).ext`, or with " 2", " 3"… until `taken` says
 * the name is free.
 */
export function conflictCopyPath(path: string, tag: string, taken: (p: string) => boolean): string {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  for (let i = 1; ; i++) {
    const p = `${dir}${stem} (conflict ${tag}${i > 1 ? ` ${i}` : ""})${ext}`;
    if (!taken(p)) return p;
  }
}

/**
 * Plan W11.S6: Syncthing's conflict-file name, `<stem>.sync-conflict-<YYYYMMDD-HHMMSS>-<device>.<ext>`
 * (UTC; the device is the first 7 characters of its id), with "-2", "-3"…
 * until `taken` says the name is free. Syncthing users' ignore patterns
 * (`*.sync-conflict-*`) match it.
 */
export function syncConflictPath(path: string, at: number, device: string, taken: (p: string) => boolean): string {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  const iso = new Date(at).toISOString();
  const stamp = `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
  const id = (device.replace(/[^A-Za-z0-9]/g, "").slice(0, 7) || "device").toUpperCase();
  for (let i = 1; ; i++) {
    const p = `${dir}${stem}.sync-conflict-${stamp}-${id}${i > 1 ? `-${i}` : ""}${ext}`;
    if (!taken(p)) return p;
  }
}

const MARKDOWN = /\.(md|markdown|mdx)$/i;

/**
 * Plan W11.S6, "file" mode: no merge and no dialog.
 *   • A Markdown note: both versions go into the note's history, the path gets
 *     the other device's version, and this device's version becomes a
 *     conflict file next to it (`conflictFile`).
 *   • Any other text file: last writer wins — the version already in the
 *     vault, which reached it last — and this device's version goes into
 *     the file's history.
 *   • A binary file: the history keeps text only, so it gets a conflict file
 *     too; nothing is ever dropped.
 */
export function fileModeResolver(keep: (path: string, ours: string, theirs: string) => Promise<void> = keepBothVersions, keepOne: (path: string, text: string) => Promise<void> = keepLocalVersion): ConflictResolver {
  return async (c) => {
    const local = asText(c.local);
    const remote = asText(c.remote);
    if (local === null || remote === null) return { kind: "conflictFile" };
    if (MARKDOWN.test(c.path)) {
      await keep(c.path, local, remote);
      return { kind: "conflictFile" };
    }
    await keepOne(c.path, local);
    return { kind: "remote" };
  };
}

async function keepLocalVersion(path: string, text: string): Promise<void> {
  const { recordSnapshot } = await import("../../storage/history");
  await recordSnapshot(path, text, "merge").catch((e: unknown) => (swallowed("sync/e2ee/conflict: this device's version could not be kept in the note's history before a merge", e), false));
}

/** The resolver for this device's mode (./conflictMode.ts), read at every conflict, so a change applies at once. */
export function modeResolver(mode: () => "merge" | "file", merge: ConflictResolver = dialogResolver, file: ConflictResolver = fileModeResolver()): ConflictResolver {
  return (c) => (mode() === "file" ? file(c) : merge(c));
}
