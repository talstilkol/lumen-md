/**
 * Reconcile the open notes with changes made outside Lumen (plan 4.4).
 *
 * The vault watcher (src/storage/vault/watcher.ts) reports external writes,
 * deletes and renames; the index and the file tree already follow them (an
 * external event is announced as a structural workspace change). This module
 * keeps the open tabs right:
 *
 * - **changed on disk, tab has no unsaved edit** → the tab shows the new text;
 * - **changed on disk, tab has an unsaved edit** → a conflict. The version on
 *   disk is first kept as a sibling file (`name (changed outside Lumen …).md`)
 *   so nothing is lost whatever the user picks, saving stops for that note,
 *   and the three-way conflict dialog (the one cloud sync uses) offers
 *   mine / theirs / a merge;
 * - **renamed on disk** → the tab follows the new path;
 * - **deleted on disk** → the tab stays open with its text, marked unsaved
 *   and detached from the path, so autosave does not bring the file back
 *   behind the user's back.
 *
 * Saving is compare-and-swap: before autosave writes a note, it checks the
 * file still holds what Lumen last saw there (`known`). If another program
 * changed it in the meantime — even before the watcher noticed — the save
 * becomes the same conflict instead of overwriting that change.
 */

import { log } from "../lib/logger";
import { t } from "../i18n";
import { readWorkspaceFile, uniqueWorkspaceName, workspaceHasFile, writeWorkspaceFile, deleteWorkspaceFile } from "../storage/workspace";
import { watchVault, type VaultEvent } from "../storage/vault";
import { notifyWorkspaceChanged } from "../storage/workspaceEvents";
import { flushPendingEdits, tabIdOf, useAppStore } from "./useStore";
import { syncOpenDocsAfterMove } from "./openDocs";
import { movedPath } from "../storage/fileOps";

/** What Lumen last saw in each open note's file (read or written). */
const known = new Map<string, string>();
/** Notes whose saving waits for a conflict to be resolved. */
const conflicted = new Set<string>();

export type ConflictResolver = (o: { path: string; base: string; local: string; remote: string }) => Promise<
  { kind: "merged"; content: string } | { kind: "local" } | { kind: "remote" } | null
>;

/** The conflict dialog; tests replace it. */
let resolveConflict: ConflictResolver = async (o) => {
  const { openConflictDialog } = await import("../sync/cloud/ConflictDialog");
  return openConflictDialog({
    ...o,
    labels: {
      title: t("external.conflict.title", { path: o.path }),
      description: t("external.conflict.body"),
      local: t("external.conflict.mine"),
      remote: t("external.conflict.theirs"),
      takeLocal: t("external.conflict.takeMine"),
      takeRemote: t("external.conflict.takeTheirs"),
      merge: t("external.conflict.merge"),
      cancel: t("external.conflict.keepMine"),
    },
  });
};

let toast: (message: string, type?: "info" | "error") => void = (message, type = "info") => {
  void import("../ui/AiToast").then((m) => m.showAiToast(message, type));
};

/** @internal tests */
export function __setConflictUi(r: ConflictResolver, notify?: typeof toast): void {
  resolveConflict = r;
  if (notify) toast = notify;
}

/** @internal tests */
export function __resetExternalChanges(): void {
  known.clear();
  conflicted.clear();
}

/** The open notes (the active one and every tab) bound to a vault path. */
function openPaths(): Map<string, { content: string; dirty: boolean }> {
  const s = useAppStore.getState();
  const out = new Map<string, { content: string; dirty: boolean }>();
  for (const tab of s.openTabs) if (tab.workspaceName) out.set(tab.workspaceName, { content: tab.content, dirty: tab.dirty });
  if (s.doc.workspaceName) out.set(s.doc.workspaceName, { content: s.doc.content, dirty: s.doc.dirty });
  return out;
}

/** Replace a note's text in the store (the editor follows), as saved. */
function showFromDisk(path: string, content: string): void {
  useAppStore.setState((state) => {
    const doc = state.doc.workspaceName === path ? { ...state.doc, content, dirty: false } : state.doc;
    const openTabs = state.openTabs.map((tab) => (tab.workspaceName === path ? { ...tab, content, dirty: false } : tab));
    return { doc, openTabs };
  });
}

function setLocal(path: string, content: string, dirty: boolean): void {
  useAppStore.setState((state) => {
    const doc = state.doc.workspaceName === path ? { ...state.doc, content, dirty } : state.doc;
    const openTabs = state.openTabs.map((tab) => (tab.workspaceName === path ? { ...tab, content, dirty } : tab));
    return { doc, openTabs };
  });
}

/** `notes/a.md` → `notes/a (changed outside Lumen 2026-10-19 10-30).md`, free. */
async function conflictCopyPath(path: string): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
  const m = /^(.*?)(\.[^./]+)?$/.exec(path)!;
  return uniqueWorkspaceName(`${m[1]} (${t("external.conflict.copyName")} ${stamp})${m[2] ?? ".md"}`);
}

/**
 * The note at `path` has `local` unsaved text and `remote` on disk. Keep the
 * disk version as a copy first (0 loss), then let the user choose.
 */
async function conflict(path: string, local: string, remote: string): Promise<void> {
  if (conflicted.has(path)) return;
  conflicted.add(path);
  try {
    const copy = await conflictCopyPath(path);
    await writeWorkspaceFile(copy, remote);
    notifyWorkspaceChanged({ kind: "structure", paths: [copy] });
    const base = known.get(path) ?? "";
    const choice = await resolveConflict({ path, base, local, remote });
    // What is in the editor now (the user may have kept typing).
    const current = openPaths().get(path)?.content ?? local;
    if (choice?.kind === "remote") {
      known.set(path, remote);
      showFromDisk(path, remote);
      await deleteWorkspaceFile(copy).catch(() => undefined); // the file holds it again
      notifyWorkspaceChanged({ kind: "structure", paths: [copy] });
      return;
    }
    const text = choice?.kind === "merged" ? choice.content : current;
    await writeWorkspaceFile(path, text);
    known.set(path, text);
    setLocal(path, text, false);
    notifyWorkspaceChanged({ kind: "content", paths: [path] });
    toast(t("external.conflict.keptCopy", { path: copy }));
  } catch (err) {
    log.warn("resolving an external change failed", err);
    toast(t("external.conflict.failed", { path }), "error");
  } finally {
    conflicted.delete(path);
  }
}

/**
 * Save an open note, unless its file changed outside Lumen since Lumen last
 * saw it: then it becomes a conflict (nothing is overwritten). True when the
 * text is on disk.
 */
export async function saveOpenNote(path: string, content: string): Promise<boolean> {
  if (conflicted.has(path)) return false;
  const base = known.get(path);
  if (base !== undefined && base !== content) {
    const disk = (await workspaceHasFile(path)) ? await readWorkspaceFile(path).catch(() => null) : null;
    if (disk !== null && disk !== base && disk !== content) {
      void conflict(path, content, disk);
      return false;
    }
  }
  await writeWorkspaceFile(path, content);
  known.set(path, content);
  return true;
}

async function onExternal(e: VaultEvent): Promise<void> {
  const open = openPaths();
  if (e.type === "write") {
    const tab = open.get(e.path);
    if (!tab) {
      known.delete(e.path);
      return;
    }
    const disk = await readWorkspaceFile(e.path).catch(() => null);
    if (disk === null || disk === known.get(e.path)) return;
    flushPendingEdits();
    const now = openPaths().get(e.path) ?? tab;
    if (disk === now.content) {
      known.set(e.path, disk);
      if (now.dirty) showFromDisk(e.path, disk);
      return;
    }
    if (!now.dirty) {
      known.set(e.path, disk);
      showFromDisk(e.path, disk);
      toast(t("external.reloaded", { path: e.path }));
      return;
    }
    await conflict(e.path, now.content, disk);
    return;
  }
  if (e.type === "rename" && e.from) {
    const from = e.from;
    const affected = [...open.keys()].some((p) => movedPath(p, from, e.path) !== null);
    for (const [p, v] of [...known]) {
      const to = movedPath(p, from, e.path);
      if (to) {
        known.delete(p);
        known.set(to, v);
      }
    }
    if (affected) {
      syncOpenDocsAfterMove(from, e.path, (c) => c);
      toast(t("external.renamed", { from, to: e.path }));
    }
    return;
  }
  if (e.type === "delete") {
    const gone = [...open.keys()].filter((p) => p === e.path || p.startsWith(e.path + "/"));
    for (const p of [...known.keys()]) if (p === e.path || p.startsWith(e.path + "/")) known.delete(p);
    if (!gone.length) return;
    // Keep the text open and unsaved, not tied to the deleted path.
    flushPendingEdits();
    useAppStore.setState((state) => {
      const detach = <T extends { workspaceName?: string | null; name: string; dirty: boolean }>(d: T): T =>
        d.workspaceName && gone.includes(d.workspaceName) ? { ...d, workspaceName: null, dirty: true } : d;
      const openTabs = state.openTabs.map((tab) => {
        const next = detach(tab);
        return next === tab ? tab : { ...next, id: tabIdOf({ workspaceName: null, name: tab.name }) };
      });
      return { doc: detach(state.doc), openTabs };
    });
    toast(t("external.deleted", { path: gone[0] }));
  }
}

let started: (() => void) | null = null;

/** Start following external changes (idempotent). Returns the stop function. */
export function startExternalChanges(): () => void {
  if (started) return started;
  // A clean note's text is what is on disk: remember it as the base.
  const remember = () => {
    for (const [path, v] of openPaths()) if (!v.dirty && !conflicted.has(path)) known.set(path, v.content);
  };
  remember();
  const unsub = useAppStore.subscribe(remember);
  const off = watchVault((e) => {
    if (e.origin !== "external") return;
    void onExternal(e).catch((err) => log.warn("external change failed", err));
  });
  started = () => {
    unsub();
    off();
    started = null;
  };
  return started;
}
