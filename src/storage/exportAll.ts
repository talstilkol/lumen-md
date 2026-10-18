/**
 * Export and import the whole vault (MASTER_PLAN v3, T47).
 *
 * The notes live in the browser's private file system, invisible to the
 * user; until now there was no way to get all of them out. Export writes
 * every note and attachment, with its folder path, to a .zip or to a real
 * folder (File System Access API). Import reads a .zip or a folder —
 * Lumen's own export, an Obsidian vault, or a Notion export — into a new
 * folder of the vault, so nothing existing is overwritten.
 */

import { unzip, zip } from "./zip";
import {
  createWorkspaceFolder,
  listWorkspace,
  readWorkspaceBlob,
  uniqueWorkspaceName,
  workspaceHasEntry,
  writeWorkspaceBlob,
  writeWorkspaceFile,
} from "./workspace";

export interface ExportedFile {
  path: string;
  data: Uint8Array;
}

/** Every note and attachment of the vault (dot folders — trash, app data — excluded). */
export async function collectVault(): Promise<ExportedFile[]> {
  const list = await listWorkspace({ includeAssets: true });
  const out: ExportedFile[] = [];
  for (const f of list) {
    const blob = await readWorkspaceBlob(f.path);
    out.push({ path: f.path, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The vault as one .zip (paths kept). */
export async function exportVaultZip(): Promise<{ bytes: Uint8Array; files: number }> {
  const files = await collectVault();
  return { bytes: await zip(files.map((f) => ({ name: f.path, data: f.data }))), files: files.length };
}

type DirHandle = FileSystemDirectoryHandle & { getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<DirHandle> };

/**
 * Write the vault into a real folder the user picked — inside a new
 * subfolder (`lumen-vault-<date>`, numbered when taken), so files already
 * in the picked folder are never overwritten.
 */
export async function exportVaultToFolder(dir: DirHandle, name = `lumen-vault-${new Date().toISOString().slice(0, 10)}`): Promise<{ files: number; folder: string }> {
  const exists = async (n: string) => {
    for await (const [key] of dir.entries()) if (key === n) return true;
    return false;
  };
  let folder = name;
  for (let n = 2; await exists(folder); n++) folder = `${name} ${n}`;
  const out = await dir.getDirectoryHandle(folder, { create: true });
  const files = await collectVault();
  for (const f of files) {
    const parts = f.path.split("/");
    const name = parts.pop()!;
    let d = out;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(f.data as unknown as BlobPart);
    await w.close();
  }
  return { files: files.length, folder };
}

/* ─── Import ─────────────────────────────────────────────────────────── */

export type ImportSource = "lumen" | "obsidian" | "notion" | "folder";

export interface ImportReport {
  source: ImportSource;
  folder: string;
  notes: number;
  attachments: number;
  skipped: string[];
}

const NOTION_ID = /\s[0-9a-f]{32}(?=(\.[a-z0-9]+)?$)/i;
const SKIP = /(^|\/)(\.obsidian|\.trash|\.git|__MACOSX|\.DS_Store)(\/|$)/;

/** Which tool wrote this set of files. */
export function detectSource(paths: string[]): ImportSource {
  if (paths.some((p) => /(^|\/)\.obsidian\//.test(p))) return "obsidian";
  const notionish = paths.filter((p) => NOTION_ID.test(p.split("/").pop() ?? "") || p.split("/").some((seg) => NOTION_ID.test(seg)));
  if (notionish.length && notionish.length >= paths.length / 2) return "notion";
  return "lumen";
}

/** "Page 1a2b…32hex.md" → "Page.md", in every path segment. */
export function stripNotionIds(path: string): string {
  return path
    .split("/")
    .map((seg) => seg.replace(NOTION_ID, ""))
    .join("/");
}

/**
 * Notion links are relative, URL-encoded paths that carry the IDs:
 * `[Page](Sub%201a2b…%20.md)`. Rewrite them to the cleaned names.
 */
export function rewriteNotionLinks(md: string): string {
  return md.replace(/\]\(([^)\s]+)\)/g, (m, href: string) => {
    if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return m;
    let decoded = href;
    try {
      decoded = decodeURIComponent(href);
    } catch {
      return m;
    }
    const cleaned = stripNotionIds(decoded);
    return cleaned === decoded ? m : `](${encodeURI(cleaned)})`;
  });
}

/** Common leading folder of all paths (an archive usually has one). */
function commonRoot(paths: string[]): string {
  const first = paths[0]?.split("/") ?? [];
  let n = first.length - 1;
  for (const p of paths) {
    const parts = p.split("/");
    let i = 0;
    while (i < n && parts[i] === first[i]) i++;
    n = i;
  }
  return n > 0 ? first.slice(0, n).join("/") + "/" : "";
}

/**
 * Import files into `Imported/<name>/` (a free name), never over existing
 * notes. `files` maps archive path → bytes.
 */
export async function importFiles(files: Map<string, Uint8Array>, name: string): Promise<ImportReport> {
  const paths = [...files.keys()];
  const source = detectSource(paths);
  const base = name.replace(/\.zip$/i, "");
  // Drop the archive's own top folder ("MyVault/…", "Export-…/…") but never
  // a real folder of a Lumen export that happens to be the only one.
  const common = commonRoot(paths.filter((p) => !SKIP.test(p)));
  const root = common && (source !== "lumen" || common === `${base}/`) ? common : "";
  let folder = `Imported/${base.replace(/[/\\]/g, "_") || "import"}`;
  if (await workspaceHasEntry(folder)) {
    let n = 2;
    while (await workspaceHasEntry(`${folder} ${n}`)) n++;
    folder = `${folder} ${n}`;
  }
  await createWorkspaceFolder(folder);
  const report: ImportReport = { source, folder, notes: 0, attachments: 0, skipped: [] };
  const dec = new TextDecoder();
  for (const [path, data] of files) {
    if (SKIP.test(path)) {
      report.skipped.push(path);
      continue;
    }
    let rel = path.startsWith(root) ? path.slice(root.length) : path;
    if (source === "notion") rel = stripNotionIds(rel);
    let target = `${folder}/${rel}`;
    if (await workspaceHasEntry(target)) target = await uniqueWorkspaceName(target);
    if (/\.(md|markdown|txt)$/i.test(rel)) {
      let text = dec.decode(data);
      if (source === "notion") text = rewriteNotionLinks(text);
      await writeWorkspaceFile(target, text);
      report.notes++;
    } else {
      await writeWorkspaceBlob(target, new Blob([data as unknown as BlobPart]));
      report.attachments++;
    }
  }
  return report;
}

/** Import a .zip archive (Lumen, Obsidian or Notion export). */
export async function importZip(buffer: ArrayBuffer, name: string): Promise<ImportReport> {
  return importFiles(await unzip(buffer), name);
}

/** Import files picked with `<input webkitdirectory>` (paths in webkitRelativePath). */
export async function importFileList(list: ArrayLike<File>): Promise<ImportReport> {
  const files = new Map<string, Uint8Array>();
  let name = "folder";
  for (const f of Array.from(list)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    name = rel.split("/")[0] || name;
    files.set(rel, new Uint8Array(await f.arrayBuffer()));
  }
  return importFiles(files, name);
}
