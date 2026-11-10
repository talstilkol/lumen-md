/**
 * When the vault is replaced by a different one without copying (plan 4.2:
 * "Open a folder as the vault", "Use browser storage"), the open notes
 * belong to the old vault. Their paths may exist in the new one with other
 * content, so autosaving them there would overwrite a file. They are
 * detached instead: kept open with their text, marked unsaved, and no
 * longer tied to a vault path — the user can save them on purpose.
 */
import { flushPendingEdits, tabIdOf, useAppStore } from "./useStore";

export function detachWorkspaceDocs(): void {
  flushPendingEdits();
  useAppStore.setState((state) => {
    const openTabs = state.openTabs.map((t) =>
      t.workspaceName ? { ...t, id: tabIdOf({ workspaceName: null, name: t.name }), workspaceName: null, dirty: true } : t,
    );
    const d = state.doc;
    const doc = d.workspaceName ? { ...d, workspaceName: null, dirty: true } : d;
    return { doc, openTabs };
  });
}
