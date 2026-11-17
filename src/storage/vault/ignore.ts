/**
 * Folders the app never walks (plan W13.V6): a vault is often a git
 * repository, or holds a project with `node_modules`. Walking 200,000 files
 * of `.git/objects` on every listing and every watcher poll made such a vault
 * open and run as slowly as a vault of 200,000 notes. These folders are left
 * out of the file tree, the index and the external-change watcher — the
 * watcher does not list them at all, and ignores observer records from them.
 *
 * Defaults: version-control data (.git, .hg, .svn), package folders
 * (node_modules), Python environments (.venv, __pycache__) and Obsidian's
 * cache (.obsidian/cache). A name matches that folder at any depth; a path
 * with a slash matches that folder from the vault root.
 *
 * Settings → General → "Folders the index skips" (`lumen.index.ignore`, a
 * list): extra names or paths, and `!name` to walk a default again.
 */
import { swallowed } from "../../lib/logger";

export const DEFAULT_IGNORED_DIRS: readonly string[] = [".git", ".hg", ".svn", "node_modules", ".venv", "__pycache__", ".obsidian/cache"];
export const IGNORE_SETTING_KEY = "lumen.index.ignore";

let cached: { raw: string | null; names: Set<string>; paths: string[] } | null = null;

function readSetting(): string | null {
  try {
    return localStorage.getItem(IGNORE_SETTING_KEY);
  } catch (e) {
    swallowed("vault/ignore: setting unreadable", e);
    return null;
  }
}

/** The effective rule: the defaults, plus the user's entries, minus `!entries`. */
export function ignoreRule(raw: string | null = readSetting()): { names: Set<string>; paths: string[] } {
  if (cached && cached.raw === raw) return cached;
  let extra: string[] = [];
  try {
    const v = raw ? JSON.parse(raw) : [];
    if (Array.isArray(v)) extra = v.filter((x): x is string => typeof x === "string");
  } catch (e) {
    swallowed("vault/ignore: setting unreadable", e);
    extra = (raw ?? "").split(/[\n,]/);
  }
  const all = new Set<string>(DEFAULT_IGNORED_DIRS);
  for (const e of extra.map((x) => x.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean)) {
    if (e.startsWith("!")) all.delete(e.slice(1));
    else all.add(e);
  }
  const names = new Set([...all].filter((e) => !e.includes("/")));
  const paths = [...all].filter((e) => e.includes("/"));
  cached = { raw, names, paths };
  return cached;
}

/** Is the folder at `path` (vault-relative, forward slashes) one the app skips? */
export function isIgnoredDir(path: string, rule = ignoreRule()): boolean {
  if (!path) return false;
  const segs = path.split("/");
  if (rule.names.has(segs[segs.length - 1])) return true;
  return rule.paths.some((p) => path === p);
}

/** Is `path` (a file or folder) inside a skipped folder, or one itself? */
export function isUnderIgnoredDir(path: string, rule = ignoreRule()): boolean {
  const segs = path.split("/");
  for (let i = 1; i <= segs.length; i++) if (isIgnoredDir(segs.slice(0, i).join("/"), rule)) return true;
  return false;
}
