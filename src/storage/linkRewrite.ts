/**
 * Keep links working when a note is renamed or moved (T46).
 *
 * Rewrites, in every note of the vault:
 * - wiki links `[[old]]`, `[[folder/old]]`, `[[old#heading|label]]` whose
 *   target names the moved note (compared by `noteKey`, so case and niqqud
 *   don't matter), keeping the heading and label;
 * - Markdown links `[text](old.md)` / `(old.md#h)` that point at the old
 *   path relative to the linking note.
 */

import { noteKey } from "../lib/slug";
import { basename, dirname, listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "./workspace";

const stem = (p: string) => basename(p).replace(/\.(md|markdown)$/i, "");

function resolve(fromDir: string, rel: string): string {
  const parts = (fromDir ? fromDir.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function relative(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split("/") : [];
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

/** Rewrite the links in one note. Returns the new text (same string when nothing changed). */
export function rewriteLinks(content: string, notePath: string, oldPath: string, newPath: string): string {
  const oldKey = noteKey(stem(oldPath));
  const oldFull = noteKey(oldPath.replace(/\.(md|markdown)$/i, ""));
  const newStem = stem(newPath);
  const newFull = newPath.replace(/\.(md|markdown)$/i, "");
  let out = content.replace(/\[\[([^\]\r\n|#]+)((?:#[^\]\r\n|]*)?)((?:\|[^\]\r\n]*)?)\]\]/g, (m, target: string, heading: string, label: string) => {
    const t = target.trim();
    const hasFolder = t.includes("/");
    if (hasFolder ? noteKey(t) !== oldFull : noteKey(t) !== oldKey) return m;
    return `[[${hasFolder ? newFull : newStem}${heading}${label}]]`;
  });
  const fromDir = dirname(notePath);
  out = out.replace(/(\]\()([^)\s]+?\.(?:md|markdown))((?:#[^)\s]*)?)(\))/gi, (m, open: string, href: string, hash: string, close: string) => {
    if (/^[a-z]+:/i.test(href)) return m;
    let decoded = href;
    try {
      decoded = decodeURI(href);
    } catch {
      /* keep as is */
    }
    if (resolve(fromDir, decoded) !== oldPath) return m;
    return `${open}${encodeURI(relative(fromDir, newPath))}${hash}${close}`;
  });
  return out;
}

/**
 * After `oldPath` became `newPath`, rewrite every note that linked to it.
 * For a folder move, every note inside counts as moved. Returns the paths
 * of the notes that changed.
 */
export async function updateLinksAfterMove(oldPath: string, newPath: string, opts: { folder?: boolean } = {}): Promise<string[]> {
  const files = (await listWorkspace()).filter((f) => /\.(md|markdown)$/i.test(f.path));
  const moves: Array<[string, string]> = opts.folder
    ? files.filter((f) => f.path.startsWith(newPath + "/")).map((f) => [oldPath + f.path.slice(newPath.length), f.path])
    : [[oldPath, newPath]];
  const changed: string[] = [];
  for (const f of files) {
    const text = await readWorkspaceFile(f.path);
    let next = text;
    for (const [o, n] of moves) next = rewriteLinks(next, f.path, o, n);
    if (next !== text) {
      await writeWorkspaceFile(f.path, next);
      changed.push(f.path);
    }
  }
  return changed;
}
