/**
 * Keep links working when a note is renamed or moved (T46): the workspace
 * walk around the pure rewrite in `linkRewriteCore.ts`.
 */

import { rewriteLinks } from "./linkRewriteCore";
import { listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "./workspace";

export { rewriteLinks, type RewriteOptions } from "./linkRewriteCore";

const MD_EXT = /\.(md|markdown)$/i;

/**
 * After `oldPath` became `newPath`, rewrite every note that linked to it —
 * and the relative links of the notes that moved. For a folder move, every
 * entry inside counts as moved. `vault` is the note listing from before the
 * move (resolves short wiki links). Returns the paths of the notes that changed.
 */
export async function updateLinksAfterMove(
  oldPath: string,
  newPath: string,
  opts: { folder?: boolean; vault?: readonly string[] } = {},
): Promise<string[]> {
  const files = (await listWorkspace()).filter((f) => MD_EXT.test(f.path));
  const folder = !!opts.folder;
  const previous = (p: string) => (folder ? (p.startsWith(newPath + "/") ? oldPath + p.slice(newPath.length) : p) : p === newPath ? oldPath : p);
  const vault = opts.vault ?? files.map((f) => previous(f.path));
  const changed: string[] = [];
  for (const f of files) {
    const text = await readWorkspaceFile(f.path);
    const next = rewriteLinks(text, f.path, oldPath, newPath, { folder, notePrevPath: previous(f.path), vault });
    if (next !== text) {
      await writeWorkspaceFile(f.path, next);
      changed.push(f.path);
    }
  }
  return changed;
}
