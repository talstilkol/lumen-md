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
  /** The name folded like the search text, for Hebrew name matches without normalising per query. */
  nameFolded: string | null;
  pathLower: string;
  /**
   * The note has Hebrew letters: its search text is the folded form
   * (niqqud, finals and case folded), otherwise the lower-cased content.
   */
  hebrew: boolean;
  links: Link[];
  /** The chunk whose search text holds this note's. */
  chunk: Chunk;
}

/**
 * W2.22 — notes' search texts live in chunks, joined into one string per
 * chunk, instead of a lower-cased and a folded copy per note. At 100,000
 * notes that is one copy of the text instead of two or three, and a query
 * is one `indexOf` scan per chunk instead of 100,000 short ones. A change
 * marks only its chunk; the chunk's string is rebuilt on the next query.
 */
interface Chunk {
  members: Entry[];
  /** Search texts joined by SEP; null after a change, until the next query. */
  text: string | null;
  /** Where each member's text starts in `text`. */
  starts: number[];
}

/** Between two notes' texts in a chunk: a noncharacter, stripped from queries, so no match spans notes. */
const SEP = String.fromCharCode(0xffff);
const CHUNK_SIZE = 256;

/** Hebrew letters, marks and presentation forms: only notes with one of these need the folded form. */
const MAY_FOLD_TO_HEBREW = /[֐-׿יִ-ﭏ]/;

const foldMemo = new Map<string, string>();

const WHOLE_TEXT_SAFE = /^[\t\n\r -~\u00A0-\u00FF\u0590-\u05FF\u2000-\u206F\u20AA\uFB1D-\uFB4F]*$/;

/**
 * `normalizeWithMap(text).text` without the map: the same per-character
 * `normalizeForMatch`, memoised per character (a note has few distinct
 * ones) and with ASCII short-cut to `toLowerCase`, which is what
 * `normalizeForMatch` does to it.
 */
export function foldForSearch(text: string): string {
  // W2.22 — for text of ASCII, Latin-1, Hebrew and general punctuation, the
  // whole text through `normalizeForMatch` at once (a few regex passes in
  // native code) gives the same result as character by character: nothing
  // there composes across characters under NFC, and nothing lower-cases by
  // context. Anything else (combining marks, Greek, jamo, controls) takes
  // the per-character path.
  if (WHOLE_TEXT_SAFE.test(text)) return normalizeForMatch(text);
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
  /** Link target key → the notes that link to it. */
  private readonly incoming = new Map<string, Set<string>>();
  private nextOrder = 0;
  private readonly counters = { indexed: 0, removed: 0, backlinkReads: 0 };
  private chunks: Chunk[] = [];

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
    const chunk = prev ? prev.chunk : this.chunkForNew();
    const entry: Entry = {
      path: input.path,
      name: input.name,
      content,
      modified: input.modified,
      order: prev ? prev.order : this.nextOrder++,
      nameLower: input.name.toLowerCase(),
      nameFolded: MAY_FOLD_TO_HEBREW.test(input.name) ? foldForSearch(input.name) : null,
      pathLower: input.path.toLowerCase(),
      hebrew: MAY_FOLD_TO_HEBREW.test(content),
      links,
      chunk,
    };
    if (prev) chunk.members[chunk.members.indexOf(prev)] = entry;
    else chunk.members.push(entry);
    chunk.text = null;
    // Map.set on an existing key keeps its position, as the old index did.
    this.files.set(input.path, entry);
    for (const l of links) {
      let set = this.incoming.get(l.key);
      if (!set) this.incoming.set(l.key, (set = new Set()));
      set.add(input.path);
    }
    this.counters.indexed++;
  }

  /**
   * Build the search text of every changed chunk now (the worker calls it
   * after a batch, while idle), so the next query only scans.
   */
  prepare(): void {
    for (const c of this.chunks) this.textOf(c);
  }

  private chunkForNew(): Chunk {
    const last = this.chunks[this.chunks.length - 1];
    if (last && last.members.length < CHUNK_SIZE) return last;
    const c: Chunk = { members: [], text: null, starts: [] };
    this.chunks.push(c);
    return c;
  }

  /** The chunk's joined search text, rebuilt if a member changed. */
  private textOf(c: Chunk): string {
    if (c.text !== null) return c.text;
    const parts: string[] = [];
    const starts: number[] = [];
    let at = 0;
    for (const e of c.members) {
      const t = (e.hebrew ? foldForSearch(e.content) : e.content.toLowerCase()).split(SEP).join("");
      starts.push(at);
      parts.push(t);
      at += t.length + 1;
    }
    c.starts = starts;
    c.text = parts.join(SEP);
    return c.text;
  }

  /** Members of `c` whose search text contains `needle` (and pass `accept`). */
  private scan(c: Chunk, needle: string, accept: (e: Entry) => boolean, out: Set<Entry>): void {
    const text = this.textOf(c);
    const starts = c.starts;
    let from = 0;
    while (from <= text.length) {
      const at = text.indexOf(needle, from);
      if (at < 0) return;
      // The member holding `at`: the last start <= at.
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= at) lo = mid;
        else hi = mid - 1;
      }
      const e = c.members[lo];
      if (accept(e)) out.add(e);
      from = lo + 1 < starts.length ? starts[lo + 1] : text.length + 1;
    }
  }

  /** Remove one note. O(its links). */
  remove(path: string): boolean {
    const prev = this.files.get(path);
    if (!prev) return false;
    this.unlink(prev);
    this.files.delete(path);
    const c = prev.chunk;
    c.members.splice(c.members.indexOf(prev), 1);
    c.text = null;
    if (!c.members.length) this.chunks = this.chunks.filter((x) => x !== c);
    this.counters.removed++;
    return true;
  }

  clear(): void {
    this.files.clear();
    this.incoming.clear();
    this.chunks = [];
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
    // Which notes contain the query: one scan per chunk (W2.22).
    const hits = new Set<Entry>();
    const qs = q.split(SEP).join("");
    // A Latin query matches a Hebrew note's folded text exactly when folding leaves it as is.
    const foldSafe = /^[\x20-\x7e]*$/.test(qs) && !/['"-]/.test(qs);
    for (const c of this.chunks) {
      // A Hebrew query cannot be in a note without Hebrew letters: only the folded variants are scanned.
      if (!hebrewQuery) this.scan(c, qs, (e) => !e.hebrew || foldSafe, hits);
      if (hebrewQuery) for (const cand of candidates) this.scan(c, cand.split(SEP).join(""), (e) => e.hebrew, hits);
    }
    if (!hebrewQuery && !foldSafe) {
      // Rare: punctuation folding could differ; compare Hebrew notes' lower-cased text directly.
      for (const e of this.files.values()) if (e.hebrew && !hits.has(e) && e.content.toLowerCase().includes(q)) hits.add(e);
    }
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
      const found = hits.has(e);
      // = `hebrewFind(e.name, q)`, against the name folded at index time.
      if (!inName && hebrewQuery && e.nameFolded !== null && candidates.some((c) => e.nameFolded!.includes(c))) score += 10;
      if (found) score += 4;
      else if (fuzzyMatch(e.nameLower, q) || fuzzyMatch(e.pathLower, q)) score += 1;
      if (score > 0) scored.push({ e, score, found });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ e, score, found }) => {
      const hit: SearchHit = { path: e.path, name: e.name, score, snippet: null };
      const at = found ? findIn(e.content, e.content.toLowerCase(), q) : null;
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
