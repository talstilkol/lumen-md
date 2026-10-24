/**
 * The vault index core (plan 8.4): search and backlinks over the notes of
 * a vault, kept up to date one file at a time.
 *
 * Pure and DOM-free, so the same code runs in the index worker
 * (./vaultIndex.worker.ts) and, where there is no Worker (unit tests, very
 * old engines), on the main thread. Everything a query needs is computed
 * when a note is indexed — its lower-cased text, its Hebrew comparison
 * form, its outgoing wiki-links — so:
 *
 *   - `upsert` / `remove` cost O(size of that note), never O(vault): the
 *     backlinks map is updated by removing the note's old links and adding
 *     its new ones;
 *   - `backlinks` reads only the notes that link to the target;
 *   - `search` is one `indexOf` per note, and the expensive work (the
 *     niqqud-aware offset map behind a snippet) runs only for the hits it
 *     returns.
 *
 * Results are the same as the scan the index used to do on every query
 * (src/__tests__/vaultWorker.test.ts compares them).
 */

import { tasksInNote, type Task } from "../tasks/taskParser";
import { parseQuery, runQuery, type QueryResult } from "../tasks/taskQuery";
import { noteKey } from "../lib/slug";
import { hasHebrew, hebrewFind, normalizeForMatch, prefixVariants } from "../text/hebrew";
import { WIKI_RE } from "./wikiTargets";

export interface IndexInput {
  /** Full workspace path. */
  path: string;
  /** Basename. */
  name: string;
  content: string;
  modified: number;
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

export interface SearchOptions {
  limit?: number;
  /** Only these paths (applied before `limit`). Serialisable, unlike a filter function. */
  paths?: string[];
}

/** Counters, so tests (and the e2e perf spec) can check work done, not wall-clock. */
export interface IndexStats {
  /** Notes in the index. */
  files: number;
  /** Notes indexed (parsed) since the index was created. */
  indexed: number;
  /** Notes removed since the index was created. */
  removed: number;
  /** Notes a `backlinks` call read, summed over all calls. */
  backlinkReads: number;
  /** Distinct link targets (note keys) the backlinks map holds. */
  linkKeys: number;
}

interface Link {
  /** `noteKey` of the target's basename (the `#heading` part dropped). */
  key: string;
  offset: number;
}

interface Entry {
  path: string;
  name: string;
  content: string;
  modified: number;
  /** Insertion order: a re-indexed note keeps its place, like a Map entry. */
  order: number;
  nameLower: string;
  /** The name folded like `folded`, for Hebrew name matches without normalising per query. */
  nameFolded: string | null;
  pathLower: string;
  lower: string;
  /**
   * `normalizeWithMap(content).text` (niqqud, finals and case folded) for
   * notes that have Hebrew letters; null for the rest, which a Hebrew
   * search can only match through `lower`.
   */
  folded: string | null;
  links: Link[];
}

/** Hebrew letters, marks and presentation forms: only notes with one of these need the folded form. */
const MAY_FOLD_TO_HEBREW = /[֐-׿יִ-ﭏ]/;

const foldMemo = new Map<string, string>();

/**
 * `normalizeWithMap(text).text` without the map: the same per-character
 * `normalizeForMatch`, memoised per character (a note has few distinct
 * ones) and with ASCII short-cut to `toLowerCase`, which is what
 * `normalizeForMatch` does to it.
 */
export function foldForSearch(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 128) {
      out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
      continue;
    }
    let f = foldMemo.get(ch);
    if (f === undefined) {
      f = normalizeForMatch(ch);
      foldMemo.set(ch, f);
    }
    out += f;
  }
  return out;
}

function basenameOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function snippetAround(content: string, offset: number, radius = 60): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(content.length, offset + radius);
  let s = content.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < content.length) s = s + "…";
  return s;
}

export function fuzzyMatch(haystack: string, needle: string): boolean {
  let i = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, i);
    if (found < 0) return false;
    i = found + 1;
  }
  return true;
}

function findIn(text: string, lower: string, q: string): { start: number; end: number } | null {
  const at = lower.indexOf(q);
  if (at >= 0) return { start: at, end: at + q.length };
  return hasHebrew(q) ? hebrewFind(text, q) : null;
}

export class VaultIndex {
  private readonly files = new Map<string, Entry>();
  /** Parsed tasks per note (plan 4.13), filled lazily on the first task query. */
  private readonly taskCache = new Map<string, Task[]>();
  /** Link target key → the notes that link to it. */
  private readonly incoming = new Map<string, Set<string>>();
  private nextOrder = 0;
  private readonly counters = { indexed: 0, removed: 0, backlinkReads: 0 };

  get size(): number {
    return this.files.size;
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  paths(): string[] {
    return [...this.files.keys()];
  }

  stats(): IndexStats {
    return { files: this.files.size, ...this.counters, linkKeys: this.incoming.size };
  }

  /** Add or replace one note. O(size of the note). */
  upsert(input: IndexInput): void {
    this.taskCache.delete(input.path);
    const prev = this.files.get(input.path);
    if (prev) this.unlink(prev);
    const content = input.content;
    const links: Link[] = [];
    const re = new RegExp(WIKI_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      // `[[target#heading|label]]` → the note part only.
      const target = m[1].split("#")[0].trim();
      if (target) links.push({ key: noteKey(basenameOf(target)), offset: m.index });
    }
    const entry: Entry = {
      path: input.path,
      name: input.name,
      content,
      modified: input.modified,
      order: prev ? prev.order : this.nextOrder++,
      nameLower: input.name.toLowerCase(),
      nameFolded: MAY_FOLD_TO_HEBREW.test(input.name) ? foldForSearch(input.name) : null,
      pathLower: input.path.toLowerCase(),
      lower: content.toLowerCase(),
      folded: MAY_FOLD_TO_HEBREW.test(content) ? foldForSearch(content) : null,
      links,
    };
    // Map.set on an existing key keeps its position, as the old index did.
    this.files.set(input.path, entry);
    for (const l of links) {
      let set = this.incoming.get(l.key);
      if (!set) this.incoming.set(l.key, (set = new Set()));
      set.add(input.path);
    }
    this.counters.indexed++;
  }

  /** Remove one note. O(its links). */
  remove(path: string): boolean {
    this.taskCache.delete(path);
    const prev = this.files.get(path);
    if (!prev) return false;
    this.unlink(prev);
    this.files.delete(path);
    this.counters.removed++;
    return true;
  }

  clear(): void {
    this.taskCache.clear();
    this.files.clear();
    this.incoming.clear();
  }

  private unlink(e: Entry): void {
    for (const l of e.links) {
      const set = this.incoming.get(l.key);
      if (!set) continue;
      set.delete(e.path);
      if (!set.size) this.incoming.delete(l.key);
    }
  }

  /** Notes whose wiki-links point at `targetPath` (by note name, not slug). */
  backlinks(targetPath: string): BacklinkHit[] {
    const stem = basenameOf(targetPath).replace(/\.md$/i, "");
    const wanted = noteKey(stem);
    const sources = [...(this.incoming.get(wanted) ?? [])]
      .map((p) => this.files.get(p))
      .filter((e): e is Entry => !!e && e.path !== targetPath)
      .sort((a, b) => a.order - b.order);
    const out: BacklinkHit[] = [];
    for (const e of sources) {
      this.counters.backlinkReads++;
      for (const l of e.links) {
        if (l.key !== wanted) continue;
        out.push({ fromPath: e.path, fromName: e.name, offset: l.offset, snippet: snippetAround(e.content, l.offset) });
      }
    }
    return out;
  }

  /** Cheap fuzzy + substring search across file names, paths and content. */
  /**
   * Every task in the vault (plan 4.13). A note is parsed once and again
   * only after it changes; notes without "[" are skipped without parsing.
   */
  allTasks(): Task[] {
    const out: Task[] = [];
    for (const [path, e] of this.files) {
      let ts = this.taskCache.get(path);
      if (!ts) {
        ts = e.content.includes("[") ? tasksInNote(path, e.content) : [];
        this.taskCache.set(path, ts);
      }
      for (const t of ts) out.push(t);
    }
    return out;
  }

  /** Run a ```tasks``` query over the vault. */
  queryTasks(source: string, todayIso: string): QueryResult {
    const [y, m, d] = todayIso.split("-").map(Number);
    const today = new Date(y, m - 1, d);
    return runQuery(parseQuery(source, today), this.allTasks(), today);
  }

  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const limit = opts.limit ?? 30;
    const q = query.trim().toLowerCase();
    if (!q) {
      return [...this.files.values()]
        .sort((a, b) => b.modified - a.modified)
        .slice(0, limit)
        .map((f) => ({ path: f.path, name: f.name, score: 0, snippet: null }));
    }
    const allow = opts.paths ? new Set(opts.paths) : null;
    const hebrewQuery = hasHebrew(q);
    // What `hebrewFind` looks for: the folded query, or its bare forms.
    const n = hebrewQuery ? normalizeForMatch(q.trim()) : "";
    const candidates = !n ? [] : /\s/.test(n) ? [n] : prefixVariants(n);
    const scored: { e: Entry; score: number; found: boolean }[] = [];
    for (const e of this.files.values()) {
      if (allow && !allow.has(e.path)) continue;
      let score = 0;
      const inName = e.nameLower.includes(q);
      if (inName) score += 10;
      if (e.nameLower === q) score += 20;
      if (e.nameLower.startsWith(q)) score += 5;
      if (e.pathLower.includes(q) && e.pathLower !== e.nameLower) score += 6;
      // Niqqud-, final-letter- and prefix-insensitive for Hebrew (T26).
      const found =
        e.lower.includes(q) || (hebrewQuery && e.folded !== null && candidates.some((c) => e.folded!.includes(c)));
      // = `hebrewFind(e.name, q)`, against the name folded at index time.
      if (!inName && hebrewQuery && e.nameFolded !== null && candidates.some((c) => e.nameFolded!.includes(c))) score += 10;
      if (found) score += 4;
      else if (fuzzyMatch(e.nameLower, q) || fuzzyMatch(e.pathLower, q)) score += 1;
      if (score > 0) scored.push({ e, score, found });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ e, score, found }) => {
      const hit: SearchHit = { path: e.path, name: e.name, score, snippet: null };
      const at = found ? findIn(e.content, e.lower, q) : null;
      if (at) {
        const ctx = snippetAround(e.content, at.start, 80);
        // Re-locate the hit inside the (whitespace-collapsed, "…"-prefixed) snippet.
        const local = findIn(ctx, ctx.toLowerCase(), e.content.slice(at.start, at.end).replace(/\s+/g, " ").toLowerCase());
        hit.snippet = ctx;
        if (local) hit.match = local;
      }
      return hit;
    });
  }
}
