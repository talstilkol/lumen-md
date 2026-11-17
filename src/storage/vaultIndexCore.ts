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
 * Content is ranked by BM25 (plan 5.2, ../search/bm25.ts), kept in the same
 * place and updated in the same `upsert` / `remove`, so ranking runs in the
 * worker too. Results equal a from-scratch ranking over the same notes
 * (src/__tests__/vaultWorker.test.ts compares them through edits).
 */

import { tasksInNote, type Task } from "../tasks/taskParser";
import { parseQuery as parseTaskQuery, runQuery, type QueryResult } from "../tasks/taskQuery";
import { noteKey } from "../lib/slug";
import { hasHebrew, hebrewFind, normalizeForMatch, prefixVariants } from "../text/hebrew";
import { normalizeForFilter } from "../text/filterMatch";
import { WIKI_RE } from "./wikiTargets";
import { Bm25Index } from "../search/bm25";
import type { Lemmatizer } from "../search/lemma/lemmatizer";
import type { LemmaLexicon } from "../search/lemma/lemmaIndex";
import type { QueryTerm } from "../text/searchTokens";
import { matchesOps, noteTags, opLocation, parseQuery, REGEX_MAX_CHARS, type Matchable } from "../search/queryOps";
import { relatedNotes, type RelatedHit } from "../related/related";
import { folderOff } from "../related/prefs";

/** A note's text, read from the index (W2.22). */
export interface NoteText {
  path: string;
  content: string;
}

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

/** A search's hits, and what it could not check (2.39). */
export interface SearchResult {
  hits: SearchHit[];
  /** Notes left out because they are too long for the query's /regex/ (`REGEX_MAX_CHARS`). */
  regexSkipped: number;
  /** With `regexSkipped`: the length limit (characters) those notes are over. */
  regexMaxChars?: number;
  /** The /regex/ ran past `REGEX_TIME_LIMIT_MS` and was stopped: no hits. */
  regexTimedOut?: true;
}

/**
 * 2.39, review Z6-H1/M4: what a search tells its caller about the /regex/ it runs. The decision rests on the
 * parse that runs the regex (`parseQuery` below), never on a second look at the query text, so no query syntax
 * runs a regex without them.
 */
export interface QueryHooks {
  /** Called once, right before the first note is matched against a /regex/ of the query (not at all without one). */
  onRegexStart?: () => void;
  /** Asked between notes once the regex runs: true stops the search with `regexTimedOut` (the in-thread budget). */
  regexOverdue?: () => boolean;
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
  /** Notes BM25 tokenised since the index was created (plan 5.2). */
  tokenised: number;
  /** Upserts skipped because the note was sent again unchanged. */
  unchanged: number;
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
  /** The name folded for search, for Hebrew name matches without normalising per query. */
  nameFolded: string | null;
  /** The name as a filter folds it (W13.E3: accents, geresh), only when that differs from `nameLower`. */
  nameAccentless: string | null;
  pathLower: string;
  // W2.22: no lower-cased or folded copy of the text per note — content is
  // ranked by BM25, and a snippet lower-cases only the hits it shows.
  links: Link[];
  /** Front matter `tags:` and body `#tags` (plan 11.3), lower-case. */
  tags: string[];
}

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
  // context. Anything else takes the per-character path.
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

/** Files whose tasks are read (plan 4.13): Markdown, as obsidian-tasks. */
const TASK_NOTE = /\.(md|markdown|mdx)$/i;

export class VaultIndex {
  private readonly files = new Map<string, Entry>();
  /** Parsed tasks per note (plan 4.13), filled lazily on the first task query. */
  private readonly taskCache = new Map<string, Task[]>();
  /** Link target key → the notes that link to it. */
  private readonly incoming = new Map<string, Set<string>>();
  private nextOrder = 0;
  /** Content ranking (plan 5.2), one document per note, updated with it. */
  private readonly bm25 = new Bm25Index();
  private readonly counters = { indexed: 0, removed: 0, backlinkReads: 0, tokenised: 0, unchanged: 0 };
  /**
   * W11.H12: a lemmatizer model's lemmas next to each note's words
   * (../search/lemma/lemmaIndex.ts), computed after the note is indexed, one
   * note at a time. Null (no lemmatizer passed W11.M3 yet): search is BM25
   * over words with the rule-based morphology, as before.
   */
  private lemma: { lz: Lemmatizer; lexicon: LemmaLexicon; mod: typeof import("../search/lemma/lemmaIndex") } | null = null;
  private lemmaQueue: Promise<void> = Promise.resolve();

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

  /**
   * Add or replace one note. O(size of the note). A note sent again
   * unchanged (same text, name and mtime — a redundant full re-upsert) is
   * skipped: nothing is re-tokenised, as #232's `isCurrent` check did.
   * Returns whether the note was (re-)indexed.
   */
  upsert(input: IndexInput): boolean {
    const prev = this.files.get(input.path);
    if (prev && prev.content === input.content && prev.name === input.name && prev.modified === input.modified && this.bm25.isCurrent(input.path, input.content, bm25Name(input.name))) {
      this.counters.unchanged++;
      return false;
    }
    this.taskCache.delete(input.path);
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
      nameAccentless: accentless(input.name),
      pathLower: input.path.toLowerCase(),
      links,
      tags: noteTags(content),
    };
    // Map.set on an existing key keeps its position, as the old index did.
    this.files.set(input.path, entry);
    if (!this.bm25.isCurrent(input.path, content, bm25Name(input.name))) {
      this.bm25.set(input.path, content, bm25Name(input.name));
      this.counters.tokenised++;
      if (this.lemma) this.queueLemmas(input.path);
    }
    for (const l of links) {
      let set = this.incoming.get(l.key);
      if (!set) this.incoming.set(l.key, (set = new Set()));
      set.add(input.path);
    }
    this.counters.indexed++;
    return true;
  }

  /**
   * W2.22 — move a note to a new path with the text the index already holds
   * (the main thread keeps no copy to send). False if the note is unknown.
   */
  move(from: string, to: string, name: string): boolean {
    const e = this.files.get(from);
    if (!e) return false;
    this.remove(from);
    this.upsert({ path: to, name, content: e.content, modified: e.modified });
    return true;
  }

  /** The notes as indexed: for the snapshot (indexSnapshot.ts), in index order. */
  *notes(): IterableIterator<IndexInput> {
    for (const e of this.files.values()) yield { path: e.path, name: e.name, content: e.content, modified: e.modified };
  }

  /**
   * W2.22 — the text of these notes (all when `paths` is omitted), for a
   * main-thread view that reads it once and lets it go; unknown paths are left out.
   */
  texts(paths?: readonly string[]): NoteText[] {
    const out: NoteText[] = [];
    if (!paths) {
      for (const e of this.files.values()) out.push({ path: e.path, content: e.content });
      return out;
    }
    for (const p of paths) {
      const e = this.files.get(p);
      if (e) out.push({ path: p, content: e.content });
    }
    return out;
  }

  /**
   * Notes related to a paragraph (plan W2.2), ranked by this index's BM25:
   * the side panel asks here, so the main thread keeps no index of its own.
   * Notes in `offFolders` are never suggested.
   */
  related(paragraph: string, opts: { self?: string | null; offFolders?: readonly string[]; semantic?: ReadonlyArray<{ path: string; score: number }>; limit?: number } = {}): RelatedHit[] {
    const folders = opts.offFolders ?? [];
    return relatedNotes(this.bm25, paragraph, { self: opts.self, semantic: opts.semantic, limit: opts.limit, filter: (p) => !folderOff(p, folders) });
  }

  /**
   * W11.H12: use a lemmatizer for the notes' lemmas (every note is lemmatized
   * again, in the background: `lemmasSettled()`), or none.
   */
  async useLemmatizer(lz: Lemmatizer | null): Promise<void> {
    if (!lz) {
      const had = this.lemma;
      this.lemma = null;
      if (had) for (const e of this.files.values()) this.bm25.set(e.path, e.content, bm25Name(e.name));
      return;
    }
    const mod = await import("../search/lemma/lemmaIndex");
    this.lemma = { lz, lexicon: new mod.LemmaLexicon(), mod };
    for (const path of this.files.keys()) this.queueLemmas(path);
    await this.lemmasSettled();
  }

  /** Resolves when every queued note has its lemmas. */
  lemmasSettled(): Promise<void> {
    return this.lemmaQueue;
  }

  private queueLemmas(path: string): void {
    this.lemmaQueue = this.lemmaQueue.then(() => this.lemmatizeNote(path));
  }

  private async lemmatizeNote(path: string): Promise<void> {
    const l = this.lemma;
    const e = this.files.get(path);
    if (!l || !e) return;
    let terms: string[];
    try {
      terms = await l.mod.documentLemmaTerms(e.content, l.lz, l.lexicon);
    } catch {
      return; // why: a model that fails on one note leaves that note on its words; search still finds it
    }
    // The note may have changed or gone while the model ran: only the text it was given gets its lemmas.
    if (this.lemma === l && this.files.get(path) === e) this.bm25.set(path, e.content, bm25Name(e.name), terms);
  }

  /** Remove one note. O(its links). */
  remove(path: string): boolean {
    this.taskCache.delete(path);
    const prev = this.files.get(path);
    if (!prev) return false;
    this.unlink(prev);
    this.files.delete(path);
    this.bm25.remove(path);
    this.counters.removed++;
    return true;
  }

  clear(): void {
    this.taskCache.clear();
    for (const p of this.files.keys()) this.bm25.remove(p);
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

  /** Every tag and the notes that carry it (front matter and body), for the tags panel. */
  tagIndex(): { tag: string; paths: string[] }[] {
    const by = new Map<string, string[]>();
    for (const e of [...this.files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)))
      for (const t of e.tags) {
        let arr = by.get(t);
        if (!arr) by.set(t, (arr = []));
        arr.push(e.path);
      }
    return [...by].map(([tag, paths]) => ({ tag, paths }));
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

  /**
   * Every task in the vault (plan 4.13). A note is parsed once and again
   * only after it changes; notes without "[" are skipped without parsing.
   * Only Markdown notes have tasks: other files in the index (a PDF or an
   * image read as text) are never parsed for them.
   */
  allTasks(): Task[] {
    const out: Task[] = [];
    for (const [path, e] of this.files) {
      let ts = this.taskCache.get(path);
      if (!ts) {
        ts = TASK_NOTE.test(path) && e.content.includes("[") ? tasksInNote(path, e.content) : [];
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
    return runQuery(parseTaskQuery(source, today), this.allTasks(), today);
  }

  /**
   * Search file names, paths and content. Content is ranked by BM25 over
   * Hebrew-aware terms (niqqud, final letters and prefix letters folded; the
   * exact form counts more), the name and path add points of their own, and
   * the whole query found as a phrase adds a few more. Each hit carries a
   * snippet around the phrase, or around its best-matching word.
   */
  search(rawQuery: string, opts: SearchOptions = {}, hooks: QueryHooks = {}): SearchHit[] {
    return this.query(rawQuery, opts, hooks).hits;
  }

  /** `search`, and how many notes a /regex/ skipped because they are too long (2.39), or that it ran out of time. */
  query(rawQuery: string, opts: SearchOptions = {}, hooks: QueryHooks = {}): SearchResult {
    let regexSkipped = 0;
    let timedOut = false;
    const hits = this.rank(rawQuery, opts, () => regexSkipped++, hooks, () => (timedOut = true));
    if (timedOut) return { hits: [], regexSkipped, regexTimedOut: true };
    return regexSkipped ? { hits, regexSkipped, regexMaxChars: REGEX_MAX_CHARS } : { hits, regexSkipped };
  }

  private rank(rawQuery: string, opts: SearchOptions, onRegexSkip: () => void, hooks: QueryHooks, onTimeout: () => void): SearchHit[] {
    const limit = opts.limit ?? 30;
    // Operators (plan 11.3): tag:, path:, "phrase", /regex/, -term. The rest ranks.
    const { text: query, ops, invalid } = parseQuery(rawQuery);
    // A /regex/ that does not compile matches nothing, rather than being dropped (which would list every note).
    if (invalid.length) return [];
    const q = query.trim().toLowerCase();
    const scope = opts.paths ? new Set(opts.paths) : null;
    // Z6-H1: the time limit is armed from this parse, the one whose regex runs below.
    const regex = ops.some((o) => o.kind === "regex");
    if (regex) hooks.onRegexStart?.();
    let overdue = false;
    const pass = (e: Entry) => {
      if (scope && !scope.has(e.path)) return false;
      if (!ops.length) return true;
      if (regex && !overdue && hooks.regexOverdue?.() === true) overdue = true;
      if (overdue) return false;
      return matchesOps(ops, matchable(e), onRegexSkip);
    };
    const allow = scope || ops.length ? new Set([...this.files.values()].filter(pass).map((e) => e.path)) : null;
    if (overdue) {
      onTimeout();
      return [];
    }
    if (!q) {
      return [...this.files.values()]
        .filter((f) => !allow || allow.has(f.path))
        .sort((a, b) => b.modified - a.modified || (a.path < b.path ? -1 : 1))
        .slice(0, limit)
        .map((f) => {
          // An operator-only query shows where it matched.
          const at = ops.length ? opLocation(ops, matchable(f)) : null;
          if (!at) return { path: f.path, name: f.name, score: 0, snippet: null };
          const ctx = snippetAround(f.content, at.start, 80);
          const local = findIn(ctx, ctx.toLowerCase(), f.content.slice(at.start, at.end).replace(/\s+/g, " ").toLowerCase());
          return local ? { path: f.path, name: f.name, score: 0, snippet: ctx, match: local } : { path: f.path, name: f.name, score: 0, snippet: ctx };
        });
    }
    const hebrewQuery = hasHebrew(q);
    const n = hebrewQuery ? normalizeForMatch(q.trim()) : "";
    const forms = !n ? [] : /\s/.test(n) ? [n] : prefixVariants(n);
    // The last word may still be typed: it also matches the terms it starts.
    const content = new Map<string, { score: number; matched: string[]; complete: boolean }>();
    const filter = allow ? (id: string) => allow.has(id) : undefined;
    const lemma = this.lemma;
    const expand = lemma ? (base: QueryTerm[]) => lemma.mod.expandWithLemmas(base, lemma.lexicon) : undefined;
    for (const h of this.bm25.search(query, { limit: Math.max(limit * 3, 100), filter, prefix: true, expand })) content.set(h.id, h);
    // The whole query as a phrase only means something for several words,
    // and only in a note that has every one of them.
    const multiWord = /\s/.test(q);
    const ranked: Array<{ e: Entry; score: number; matched: string[]; phraseable: boolean }> = [];
    for (const e of this.files.values()) {
      if (allow && !allow.has(e.path)) continue;
      const c = content.get(e.path);
      let score = nameScore(e, q, hebrewQuery, forms) + (c?.score ?? 0);
      if (!score && (fuzzyMatch(e.nameLower, q) || fuzzyMatch(e.pathLower, q))) score = 1;
      if (score) ranked.push({ e, score, matched: c?.matched ?? [], phraseable: multiWord && !!c?.complete });
    }
    ranked.sort((a, b) => b.score - a.score || (a.e.path < b.e.path ? -1 : 1));
    // The phrase check and the snippet scan a note's text, so they run only
    // for the leading candidates — but for every one the phrase bonus could
    // still lift into the first `limit`.
    const cutoff = ranked.length > limit ? ranked[limit - 1].score : -Infinity;
    const candidates = ranked.filter((r, i) => i < limit || (r.phraseable && r.score + PHRASE_BONUS >= cutoff));
    const out: SearchHit[] = [];
    for (const { e, score: base, matched, phraseable } of candidates) {
      let score = base;
      const lower = e.content.toLowerCase();
      const phrase = phraseable ? findIn(e.content, lower, q) : null;
      if (phrase) score += PHRASE_BONUS;
      const at = phrase ?? (matched.length ? locateTerm(e.content, lower, matched) : base > 1 ? findIn(e.content, lower, q) : null);
      const hit: SearchHit = { path: e.path, name: e.name, score, snippet: null };
      if (at) {
        const ctx = snippetAround(e.content, at.start, 80);
        // Re-locate the hit inside the (whitespace-collapsed, "…"-prefixed) snippet.
        const local = findIn(ctx, ctx.toLowerCase(), e.content.slice(at.start, at.end).replace(/\s+/g, " ").toLowerCase());
        hit.snippet = ctx;
        if (local) hit.match = local;
      }
      out.push(hit);
    }
    out.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
    return out.slice(0, limit);
  }
}

/** What the search operators read (plan 11.3); the lower-cased text is made only for an operator query (W2.22). */
const matchable = (e: Entry): Matchable => ({ content: e.content, lower: e.content.toLowerCase(), pathLower: e.pathLower, nameLower: e.nameLower, tags: e.tags });

/** The phrase (several words) is in the text as written: a few points on top of BM25. */
export const PHRASE_BONUS = 4;

/** The name BM25 indexes: without its extension. */
export const bm25Name = (name: string) => name.replace(/\.(md|markdown|txt)$/i, "");

/** Points for the query in a note's name or path (file-name search stays first-class). */
/** Only a name with a character beyond ASCII letters, digits and plain punctuation can fold further (W13.E3). */
const PLAIN_NAME = /^[\x20\x21\x23-\x26\x28-\x7E]*$/;
function accentless(name: string): string | null {
  if (PLAIN_NAME.test(name)) return null;
  const f = normalizeForFilter(name);
  return f === name.toLowerCase() ? null : f;
}
/** The query folded once per search, not once per note. */
let lastQuery = "";
let lastFolded = "";
function foldQuery(q: string): string {
  if (q !== lastQuery) {
    lastQuery = q;
    lastFolded = normalizeForFilter(q);
  }
  return lastFolded;
}

function nameScore(e: Entry, q: string, hebrewQuery: boolean, forms: string[]): number {
  let score = 0;
  let inName = e.nameLower.includes(q);
  // The note switcher is a filter box too (W13.E3): `cafe` finds Café.md, `lodz` Łódź.md, `צהל` צה״ל.md.
  if (!inName && e.nameAccentless !== null) {
    const qf = foldQuery(q);
    inName = !!qf && e.nameAccentless.includes(qf);
  }
  if (inName) score += 10;
  if (e.nameLower === q) score += 20;
  if (e.nameLower.startsWith(q)) score += 5;
  if (e.pathLower.includes(q) && e.pathLower !== e.nameLower) score += 6;
  // Niqqud-, final-letter- and prefix-insensitive for Hebrew (T26), against the name folded at index time.
  if (!inName && hebrewQuery && e.nameFolded !== null && forms.some((f) => e.nameFolded!.includes(f))) score += 10;
  return score;
}

/** Where the first of the matched terms (best first; a `~stem` without its marker) occurs in `text`. */
function locateTerm(text: string, lower: string, terms: string[]): { start: number; end: number } | null {
  for (const t of terms) {
    const bare = t.startsWith("~") ? t.slice(1) : t;
    const at = hasHebrew(bare) ? hebrewFind(text, bare) : findIn(text, lower, bare);
    if (at) return at;
  }
  return null;
}
