/**
 * Every Markdown note in the workspace, for Vault Doctor (null when there
 * is none, or when one cannot be read). Loaded on use.
 */
import { t } from "../i18n";
import { showAiToast } from "../ui/AiToast";
import { isOPFSAvailable, readWorkspaceFile } from "../storage/workspace";

export async function loadDoctorNotes(): Promise<Array<{ path: string; text: string }> | null> {
  if (!isOPFSAvailable()) {
    showAiToast(t("doctor.noWorkspace"), "error");
    return null;
  }
  const { listWorkspace } = await import("../storage/workspace");
  const notes: Array<{ path: string; text: string }> = [];
  for (const f of await listWorkspace({ includeAssets: false })) {
    if (!/\.(md|markdown)$/i.test(f.path)) continue;
    try {
      notes.push({ path: f.path, text: await readWorkspaceFile(f.path) });
    } catch {
      // A missing note would look like a broken link target (and "fix"
      // links to it): stop rather than scan an incomplete workspace.
      showAiToast(t("doctor.readFailed", { path: f.path }), "error");
      return null;
    }
  }
  if (!notes.length) {
    showAiToast(t("doctor.noWorkspace"), "error");
    return null;
  }
  return notes;
}
