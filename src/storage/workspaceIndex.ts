import {
  basename,
  isAssetName,
  isOPFSAvailable,
  listWorkspace,
  readWorkspaceFile,
} from "./workspace";

export interface IndexedFile {
  /** Full workspace path. */
  path: string;
  /** Basename. */
  name: string;
  content: string;
  modified: number;
  /** Wiki-link targets referenced by this file (raw `[[target]]` text). */
  wikiTargets: string[];
}

const cache = {
  byPath: new Map<string, IndexedFile>(),
  builtAt: 0,
  inflight: null as Promise<void> | null,
};

const CACHE_TTL_MS = 1500;
const WIKI_RE = /\[\[([^\]\r\n|]+?)(?:\|[^\]\r\n]+?)?\]\]/g;

/** Build (or refresh) the in-memory index from OPFS. */
async function build(): Promise<void> {
  if (!isOPFSAvailable()) return;
  const list = await listWorkspace({ includeAssets: false });
  const next = new Map<string, IndexedFile>();
  await Promise.all(
    list
      .filter((e) => !isAssetName(e.path))
      .map(async (e) => {
        try {
          const content = await readWorkspaceFile(e.path);
          const wikiTargets: string[] = [];
          let m: RegExpExecArray | null;
          WIKI_RE.lastIndex = 0;
          while ((m = WIKI_RE.exec(content)) !== null) {
            wikiTargets.push(m[1].trim());
          }
          next.set(e.path, {
            path: e.path,
            name: e.name,
            content,
            modified: e.modified,
            wikiTargets,
          });
        } catch {
          /* unreadable file — skip */
        }
      }),
  );
  cache.byPath = next;
  cache.builtAt = Date.now();
}

export async function ensureIndex(force = false): Promise<void> {
  if (!isOPFSAvailable()) return;
  if (!force && Date.now() - cache.builtAt < CACHE_TTL_MS) return;
  if (cache.inflight) {
    await cache.inflight;
    return;
  }
  cache.inflight = build().finally(() => {
    cache.inflight = null;
  });
  await cache.inflight;
}

/** Listen for the workspace-changed event and invalidate. */
let listenerAttached = false;
function attachInvalidator() {
  if (listenerAttached || typeof window === "undefined") return;
  listenerAttached = true;
  window.addEventListener("lumen-workspace-changed", () => {
    cache.builtAt = 0;
  });
}
attachInvalidator();

export interface BacklinkHit {
  /** Full path of the source file. */
  fromPath: string;
  /** Basename for display. */
  fromName: string;
  /** A short snippet of the surrounding text (one line). */
  snippet: string;
  /** Char offset in the source file where the wiki-link starts. */
  offset: number;
}

/** Find files whose wiki-links point at the given target (path or basename). */
export async function findBacklinks(targetPath: string): Promise<BacklinkHit[]> {
  await ensureIndex();
  const targetName = basename(targetPath);
  const stem = targetName.replace(/\.md$/i, "");
  const wantedSlug = slug(stem);
  const out: BacklinkHit[] = [];
  for (const file of cache.byPath.values()) {
    if (file.path === targetPath) continue;
    let m: RegExpExecArray | null;
    WIKI_RE.lastIndex = 0;
    while ((m = WIKI_RE.exec(file.content)) !== null) {
      const target = m[1].trim();
      if (slug(target) === wantedSlug || target === stem) {
        const offset = m.index;
        out.push({
          fromPath: file.path,
          fromName: file.name,
          offset,
          snippet: snippetAround(file.content, offset),
        });
      }
    }
  }
  return out;
}

export interface SearchHit {
  /** Full workspace path. */
  path: string;
  /** Basename for display. */
  name: string;
  /** Match score; higher is better. */
  score: number;
  /** First-content match (or null when matched by name only). */
  snippet: string | null;
  /** Highlight range inside the snippet for the matched substring. */
  match?: { start: number; end: number };
}

/** Cheap fuzzy + substring search across filenames, paths, and content. */
export async function searchWorkspace(
  query: string,
  opts: { limit?: number } = {},
): Promise<SearchHit[]> {
  await ensureIndex();
  const limit = opts.limit ?? 30;
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...cache.byPath.values()]
      .sort((a, b) => b.modified - a.modified)
      .slice(0, limit)
      .map((f) => ({ path: f.path, name: f.name, score: 0, snippet: null }));
  }
  const out: SearchHit[] = [];
  for (const file of cache.byPath.values()) {
    const nameLower = file.name.toLowerCase();
    const pathLower = file.path.toLowerCase();
    const contentLower = file.content.toLowerCase();
    let score = 0;
    let snippet: string | null = null;
    let match: SearchHit["match"];
    if (nameLower.includes(q)) score += 10;
    if (nameLower === q) score += 20;
    if (nameLower.startsWith(q)) score += 5;
    if (pathLower.includes(q) && pathLower !== nameLower) score += 6;
    const idx = contentLower.indexOf(q);
    if (idx >= 0) {
      score += 4;
      const ctx = snippetAround(file.content, idx, 80);
      const local = ctx.toLowerCase().indexOf(q);
      snippet = ctx;
      if (local >= 0) match = { start: local, end: local + q.length };
    } else if (fuzzyMatch(nameLower, q) || fuzzyMatch(pathLower, q)) {
      score += 1;
    }
    if (score > 0)
      out.push({ path: file.path, name: file.name, score, snippet, match });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function snippetAround(content: string, offset: number, radius = 60): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(content.length, offset + radius);
  let s = content.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < content.length) s = s + "…";
  return s;
}

function fuzzyMatch(haystack: string, needle: string): boolean {
  let i = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, i);
    if (found < 0) return false;
    i = found + 1;
  }
  return true;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
