/**
 * A git pull and the open notes (plan 3.3).
 *
 * - `pullEditorHooks()` tells the pull (src/sync/gitPull.ts) what each open
 *   note holds — after flushing the editors, so the last keystrokes count —
 *   and lets it put merged text into a note: a clean note shows the new file,
 *   a note with unsaved edits gets the merge in the editor (still unsaved, saved
 *   by autosave) and is never written behind the user's back.
 * - `resolveGitConflicts()` is the resolution screen: the three-way conflict
 *   dialog (the one cloud sync and outside changes use), one file at a time.
 *   A file left unresolved keeps its conflict markers, and committing refuses
 *   until they are gone.
 */
import { t } from "../i18n";
import { log } from "../lib/logger";
import { writeWorkspaceFile } from "../storage/workspace";
import { notifyWorkspaceChanged } from "../storage/workspaceEvents";
import type { PendingConflict } from "../sync/gitPull";
import type { PullEditorHooks, PullResult } from "../sync/git";
import { showAiToast } from "../ui/AiToast";
import { uiAlert } from "../ui/PromptDialog";
import { flushPendingEdits, useAppStore } from "./useStore";

/** The open note (active document or a tab) at a vault path. */
function openNote(path: string): { content: string; dirty: boolean } | null {
  const s = useAppStore.getState();
  if (s.doc.workspaceName === path) return { content: s.doc.content, dirty: s.doc.dirty };
  const tab = s.openTabs.find((x) => x.workspaceName === path);
  return tab ? { content: tab.content, dirty: tab.dirty } : null;
}

function setNote(path: string, content: string, dirty: boolean): void {
  useAppStore.setState((state) => {
    const doc = state.doc.workspaceName === path ? { ...state.doc, content, dirty } : state.doc;
    const openTabs = state.openTabs.map((tab) => (tab.workspaceName === path ? { ...tab, content, dirty } : tab));
    return { doc, openTabs };
  });
}

export function pullEditorHooks(): PullEditorHooks {
  flushPendingEdits();
  return {
    openNote: (path) => {
      flushPendingEdits();
      return openNote(path);
    },
    setOpenNote: (path, text) => setNote(path, text, true),
    onWritten: (path, text) => {
      const note = openNote(path);
      // Only a clean note follows the file; one with edits was not written.
      if (note && !note.dirty && text !== null) setNote(path, text, false);
    },
  };
}

export type GitConflictChoice = { kind: "merged"; content: string } | { kind: "local" } | { kind: "remote" } | null;
export type GitConflictUi = (o: { path: string; base: string; local: string; remote: string }) => Promise<GitConflictChoice>;

let conflictUi: GitConflictUi = async (o) => {
  const { openConflictDialog } = await import("../sync/cloud/ConflictDialog");
  return openConflictDialog({
    ...o,
    labels: {
      title: t("git.conflict.title", { path: o.path }),
      description: t("git.conflict.body"),
      local: t("git.conflict.mine"),
      remote: t("git.conflict.theirs"),
      takeLocal: t("git.conflict.takeMine"),
      takeRemote: t("git.conflict.takeTheirs"),
      merge: t("git.conflict.merge"),
      cancel: t("git.conflict.later"),
    },
  });
};

/** @internal tests */
export function __setGitConflictUi(ui: GitConflictUi): void {
  conflictUi = ui;
}

/**
 * Walk the user through each conflict. Returns the paths still unresolved
 * (their files keep the conflict markers; an open note keeps its text and
 * the other version stays in its copy).
 */
export async function resolveGitConflicts(conflicts: PendingConflict[]): Promise<string[]> {
  const left: string[] = [];
  for (const c of conflicts) {
    let choice: GitConflictChoice = null;
    try {
      choice = await conflictUi({ path: c.path, base: c.base, local: c.ours, remote: c.theirs });
    } catch (err) {
      log.warn("git conflict dialog failed", err);
    }
    if (!choice) {
      left.push(c.path);
      continue;
    }
    const text = choice.kind === "merged" ? choice.content : choice.kind === "local" ? c.ours : c.theirs;
    flushPendingEdits();
    const note = openNote(c.path);
    if (c.where === "open") {
      // Typed on during the dialog: the newer text wins, the choice waits.
      if (note && note.content !== c.ours) {
        left.push(c.path);
        continue;
      }
      // Into the editor, unsaved: autosave writes it the usual way.
      setNote(c.path, text, true);
      continue;
    }
    await writeWorkspaceFile(c.path, text);
    notifyWorkspaceChanged({ kind: "content", paths: [c.path] });
    if (note && !note.dirty) setNote(c.path, text, false);
  }
  return left;
}

/** Tell what the pull did, then open the resolution screen for each conflict. */
export async function reportPull(result: PullResult): Promise<void> {
  const lines: string[] = [
    result.upToDate ? t("git.pull.upToDate") : t("git.pull.summary", { changed: result.changedFiles, conflicts: result.conflicts.length }),
  ];
  if (result.keptDeletedUpstream.length) {
    lines.push(t("git.pull.keptDeleted", { count: result.keptDeletedUpstream.length, files: result.keptDeletedUpstream.slice(0, 5).join(", ") }));
  }
  if (result.mergedIntoOpen.length) lines.push(t("git.pull.mergedIntoOpen", { files: result.mergedIntoOpen.join(", ") }));
  if (result.copies.length) lines.push(t("git.pull.copies", { files: result.copies.join(", ") }));
  const lfs = [...result.lfsSkipped, ...result.lfsPointers];
  if (lfs.length) lines.push(t("git.lfs.unsupported", { files: lfs.slice(0, 5).join(", ") }));
  await uiAlert({ message: lines.join("\n\n") });
  if (!result.conflicts.length) return;
  const left = await resolveGitConflicts(result.conflicts);
  if (left.length) showAiToast(t("git.conflict.left", { count: left.length }), "info");
  else showAiToast(t("git.conflict.allResolved"), "success");
}
