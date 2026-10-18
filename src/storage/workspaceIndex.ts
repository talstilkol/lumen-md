import { noteKey } from "../lib/slug";
import { WORKSPACE_CHANGED, changeOf } from "./workspaceEvents";
import { hasHebrew, hebrewFind, normalizeForMatch, prefixVariants } from "../text/hebrew";
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
  /** Files whose text changed since they were indexed (C3). */
  dirty: new Set<string>(),
  /** Files were added / removed / renamed: rebuild on next use. */
  stale: false,
  /** When the index was last checked against the vault listing. */
  checkedAt: 0,
};

/**
 * Not every writer announces its writes (agent tools, the page-hide flush,
 * sync): at most this often, a use of the index re-lists the vault and
 * re-reads only the files whose mtime changed — or that appeared.
 */
export const REVALIDATE_MS = 30_000;
const WIKI_RE = /\[\[([^\]\r\n|]+?)(?:\|[^\]\r\n]+?)?\]\]/g;

/** Read one file into an index entry, or null if unreadable. */
async function indexFile(e: { path: string; name: string; modified: number }): Promise<IndexedFile | null> {
  try {
    const content = await readWorkspaceFile(e.path);
    const wikiTargets: string[] = [];
    let m: RegExpExecArray | null;
    WIKI_RE.lastIndex = 0;
    while ((m = WIKI_RE.exec(content)) !== null) wikiTargets.push(m[1].trim());
    return { path: e.path, name: e.name, content, modified: e.modified, wikiTargets };
  } catch {
    return null;
  }
}

/** Run `fn` over `items` with at most `limit` in flight (a 10k vault must not open 10k reads at once). */
async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

/** Build the whole index from OPFS (first use, or after files were added / removed). */
async function build(): Promise<void> {
  if (!isOPFSAvailable()) return;
  // Clear before reading: a change announced while the build runs (it may
  // have read that file already) must survive for the next ensureIndex.
  cache.dirty.clear();
  cache.stale = false;
  const list = await listWorkspace({ includeAssets: false });
  const next = new Map<string, IndexedFile>();
  await mapLimit(
    list.filter((e) => !isAssetName(e.path)),
    16,
    async (e) => {
      const f = await indexFile(e);
      if (f) next.set(e.path, f);
    },
  );
  cache.byPath = next;
  cache.builtAt = cache.checkedAt = Date.now();
}

/** Fallback for unannounced writes: re-read what the listing says changed. */
async function revalidate(): Promise<void> {
  cache.checkedAt = Date.now();
  const list = (await listWorkspace({ includeAssets: false })).filter((e) => !isAssetName(e.path));
  const seen = new Set(list.map((e) => e.path));
  for (const path of [...cache.byPath.keys()]) if (!seen.has(path)) cache.byPath.delete(path);
  await mapLimit(
    list.filter((e) => cache.byPath.get(e.path)?.modified !== e.modified),
    16,
    async (e) => {
      const f = await indexFile(e);
      if (f) cache.byPath.set(e.path, f);
      else cache.byPath.delete(e.path);
    },
  );
}

/**
 * C3: after an autosave only the saved files are re-read — not the whole
 * vault. Returns false when a full rebuild is needed instead.
 */
async function refreshDirty(): Promise<void> {
  const paths = [...cache.dirty];
  cache.dirty.clear();
  await Promise.all(
    paths.map(async (path) => {
      const prev = cache.byPath.get(path);
      const f = await indexFile({ path, name: prev?.name ?? path.split("/").pop() ?? path, modified: Date.now() });
      if (f) cache.byPath.set(path, f);
      else cache.byPath.delete(path);
    }),
  );
}

export async function ensureIndex(force = false): Promise<void> {
  if (!isOPFSAvailable()) return;
  if (cache.inflight) {
    await cache.inflight;
    if (!force && !cache.stale && !cache.dirty.size) return;
  }
  if (force || cache.stale || !cache.builtAt) {
    cache.inflight = build().finally(() => {
      cache.inflight = null;
    });
  } else if (cache.dirty.size) {
    cache.inflight = refreshDirty().finally(() => {
      cache.inflight = null;
    });
  } else if (Date.now() - cache.checkedAt >= REVALIDATE_MS) {
    cache.inflight = revalidate().finally(() => {
      cache.inflight = null;
    });
  } else return;
  await cache.inflight;
}

/** Listen for workspace changes: content changes mark files dirty, anything else forces a rebuild. */
let listenerAttached = false;
function attachInvalidator() {
  if (listenerAttached || typeof window === "undefined") return;
  listenerAttached = true;
  window.addEventListener(WORKSPACE_CHANGED, (e) => {
    const c = changeOf(e);
    if (c.kind === "content" && c.paths) for (const p of c.paths) cache.dirty.add(p);
    else cache.stale = true;
  });
}
attachInvalidator();

/** Every indexed note (after ensureIndex) — for the tags panel and other views. */
export function indexedFiles(): IndexedFile[] {
  return [...cache.byPath.values()];
}

/** Test hook. */
export function __resetWorkspaceIndex(): void {
  bm25 = null;
  bm25Sync = null;
  cache.byPath = new Map();
  cache.builtAt = 0;
  cache.inflight = null;
  cache.dirty.clear();
  cache.stale = false;
  cache.checkedAt = 0;
}

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
  // By normalized name, not slug: the old ASCII slug made every Hebrew
  // target "" and so every Hebrew link a backlink of every Hebrew note.
  const wanted = noteKey(stem);
  const out: BacklinkHit[] = [];
  for (const file of cache.byPath.values()) {
    if (file.path === targetPath) continue;
    let m: RegExpExecArray | null;
    WIKI_RE.lastIndex = 0;
    while ((m = WIKI_RE.exec(file.content)) !== null) {
      // `[[target#heading|label]]` → the note part only.
      const target = m[1].split("#")[0].trim();
      if (target && noteKey(basename(target)) === wanted) {
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

/* ── Content ranking: BM25 (plan 5.2) ─────────────────────────────────
 * Loaded on the first search (a separate chunk, not in the startup
 * bundle) and kept in step with the file cache one note at a time: a note
 * whose text changed is re-indexed, a removed note leaves, nothing else is
 * touched. A large first sync yields to the event loop every few dozen
 * milliseconds, so the dialog stays responsive while 10 000 notes go in.
 */
type Bm25 = import("../search/bm25").Bm25Index;
let bm25: Bm25 | null = null;
let bm25Sync: Promise<Bm25> | null = null;

const nameOf = (file: IndexedFile) => file.name.replace(/\.(md|markdown|txt)$/i, "");

async function syncBm25(): Promise<Bm25> {
  if (bm25Sync) return bm25Sync;
  bm25Sync = (async () => {
    if (!bm25) bm25 = new (await import("../search/bm25")).Bm25Index();
    const index = bm25;
    let slice = performance.now();
    for (const file of cache.byPath.values()) {
      if (index.isCurrent(file.path, file.content, nameOf(file))) continue;
      index.set(file.path, file.content, nameOf(file));
      if (performance.now() - slice > 30) {
        await new Promise((r) => setTimeout(r, 0));
        slice = performance.now();
      }
    }
    for (const id of [...index.ids()]) if (!cache.byPath.has(id)) index.remove(id);
    return index;
  })().finally(() => {
    bm25Sync = null;
  });
  return bm25Sync;
}

/** Points for the query in a note's name or path (file-name search stays first-class). */
function nameScore(file: IndexedFile, q: string): number {
  const nameLower = file.name.toLowerCase();
  const pathLower = file.path.toLowerCase();
  let score = 0;
  if (nameLower.includes(q)) score += 10;
  if (nameLower === q) score += 20;
  if (nameLower.startsWith(q)) score += 5;
  if (pathLower.includes(q) && pathLower !== nameLower) score += 6;
  // Niqqud-, final-letter- and prefix-insensitive for Hebrew (T26).
  if (!nameLower.includes(q) && hasHebrew(q) && hebrewNameHas(file.name, q)) score += 10;
  return score;
}

/** Names in comparison form (`normalizeForMatch`), cached: the name check runs over every note per keystroke. */
const normalizedNames = new Map<string, string>();
let queryForms: { q: string; forms: string[] } | null = null;

/** `hebrewFind(name, q) !== null`, without re-normalising the name each time. */
function hebrewNameHas(name: string, q: string): boolean {
  let n = normalizedNames.get(name);
  if (n === undefined) {
    n = normalizeForMatch(name);
    if (normalizedNames.size > 50_000) normalizedNames.clear();
    normalizedNames.set(name, n);
  }
  if (queryForms?.q !== q) {
    const nq = normalizeForMatch(q.trim());
    queryForms = { q, forms: !nq ? [] : /\s/.test(nq) ? [nq] : prefixVariants(nq) };
  }
  return queryForms.forms.some((f) => n!.includes(f));
}

/** The phrase is in the text as written (a few points on top of BM25). */
const PHRASE_BONUS = 4;

/**
 * Search filenames, paths and content. Content is ranked by BM25 over
 * Hebrew-aware terms (niqqud, final letters and prefix letters folded; the
 * exact form counts more), the name and path add points of their own, and
 * the whole query found as a phrase adds a few more. Each hit carries a
 * snippet around the phrase, or around its best-matching word.
 */
export async function searchWorkspace(
  query: string,
  /** `filter`: only these paths — applied before `limit`. */
  opts: { limit?: number; filter?: (path: string) => boolean } = {},
): Promise<SearchHit[]> {
  await ensureIndex();
  const limit = opts.limit ?? 30;
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...cache.byPath.values()]
      .filter((f) => !opts.filter || opts.filter(f.path))
      .sort((a, b) => b.modified - a.modified)
      .slice(0, limit)
      .map((f) => ({ path: f.path, name: f.name, score: 0, snippet: null }));
  }
  const index = await syncBm25();
  const content = new Map<string, { score: number; matched: string[] }>();
  for (const h of index.search(query, { limit: Math.max(limit * 3, 100), filter: opts.filter })) content.set(h.id, h);
  // Rank on name + BM25 first; the phrase check and the snippet (both scan
  // the note's text) run only for the leading candidates.
  const ranked: Array<{ file: IndexedFile; score: number; matched: string[] }> = [];
  for (const file of cache.byPath.values()) {
    if (opts.filter && !opts.filter(file.path)) continue;
    const c = content.get(file.path);
    let score = nameScore(file, q) + (c?.score ?? 0);
    if (!score && (fuzzyMatch(file.name.toLowerCase(), q) || fuzzyMatch(file.path.toLowerCase(), q))) score = 1;
    if (score) ranked.push({ file, score, matched: c?.matched ?? [] });
  }
  ranked.sort((a, b) => b.score - a.score || (a.file.path < b.file.path ? -1 : 1));
  const out: SearchHit[] = [];
  for (const { file, score: base, matched } of ranked.slice(0, limit * 2)) {
    let score = base;
    const phrase = base > 1 ? findIn(file.content, file.content.toLowerCase(), q) : null;
    if (phrase) score += PHRASE_BONUS;
    const at = phrase ?? (matched.length ? locateTerm(file.content, matched) : null);
    let snippet: string | null = null;
    let match: SearchHit["match"];
    if (at) {
      snippet = snippetAround(file.content, at.start, 80);
      // Re-locate the hit inside the (whitespace-collapsed, "…"-prefixed) snippet.
      const local = findIn(snippet, snippet.toLowerCase(), file.content.slice(at.start, at.end).replace(/\s+/g, " ").toLowerCase());
      if (local) match = local;
    }
    out.push({ path: file.path, name: file.name, score, snippet, match });
  }
  out.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
  return out.slice(0, limit);
}

/** Where the first of the matched terms (best first; a `~stem` without its marker) occurs in `text`. */
function locateTerm(text: string, terms: string[]): { start: number; end: number } | null {
  for (const t of terms) {
    const bare = t.startsWith("~") ? t.slice(1) : t;
    const at = hasHebrew(bare) ? hebrewFind(text, bare) : findIn(text, text.toLowerCase(), bare);
    if (at) return at;
  }
  return null;
}

function findIn(text: string, lower: string, q: string): { start: number; end: number } | null {
  const at = lower.indexOf(q);
  if (at >= 0) return { start: at, end: at + q.length };
  return hasHebrew(q) ? hebrewFind(text, q) : null;
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

