/** Every Markdown note in the workspace with its text (unreadable files skipped). */
import { isOPFSAvailable, listWorkspace, readWorkspaceFile } from "./workspace";
import { swallowed } from "../lib/logger";

/** Reads in flight at once (one OPFS worker batch). */
export const READ_AT_ONCE = 256;

export async function readAllNotes(): Promise<Array<{ path: string; text: string }>> {
  if (!isOPFSAvailable()) return [];
  const notes: Array<{ path: string; text: string }> = [];
  const paths = (await listWorkspace({ includeAssets: false })).map((f) => f.path).filter((p) => /\.(md|markdown)$/i.test(p));
  // The #856 follow-up: READ_AT_ONCE reads in flight, so OPFS sends them to its worker as one batch, not one by one.
  for (let i = 0; i < paths.length; i += READ_AT_ONCE) {
    const texts = await Promise.all(paths.slice(i, i + READ_AT_ONCE).map((p) => readWorkspaceFile(p).catch((e: unknown) => (swallowed("storage/workspaceNotes: a note could not be read; it is left out", e), null))));
    texts.forEach((text, k) => {
      if (text !== null) notes.push({ path: paths[i + k], text }); // why: unreadable: skip
    });
  }
  return notes;
}
