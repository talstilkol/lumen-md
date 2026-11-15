/**
 * The workspace index's queries (plan W6.25: moved out of workspaceIndex.ts
 * unchanged; ./workspaceIndex.ts re-exports every one).
 */
import { listWorkspaceTree, type WorkspaceNode } from "./workspace";
import type { BacklinkHit, IndexStats, SearchHit, SearchResult } from "./vaultIndexCore";
import type { IndexEngine } from "./vaultIndexProtocol";
import { checkedIndex, getEngine, restartEngine, verified, withEngine } from "./workspaceIndex";
import { log } from "../lib/logger";
import { cache, type IndexedFile } from "./workspaceIndexState";

// ── Queries ─────────────────────────────────────────────────────────────

/**
 * Every indexed note (after ensureIndex) — for the tags panel and other views.
 * Review 14.11 T7: while a trusted snapshot is still being checked against
 * the vault, none — a note deleted while the app was closed must not show its
 * name, tags or links. Views wait for `indexChecked()` (or re-derive on
 * `indexVersion()`).
 */
export function indexedFiles(): IndexedFile[] {
  if (cache.verify) return [];
  return [...cache.byPath.values()];
}

/**
 * The file tree (directories first, then files, by name) — the same
 * listing the index re-validates against, so after a structural change the
 * vault is listed once for both.
 */
export async function workspaceTree(): Promise<WorkspaceNode[]> {
  const generation = cache.generation;
  const tree = await listWorkspaceTree();
  if (generation === cache.generation) cache.listing = { generation, tree };
  return tree;
}

/** Find files whose wiki-links point at the given target (path or basename). */
export async function findBacklinks(targetPath: string): Promise<BacklinkHit[]> {
  await checkedIndex();
  if (!cache.byPath.size) return [];
  return withEngine((e) => e.backlinks(targetPath));
}

/** A search with a /regex/ that runs longer than this (ms) in the worker is stopped (2.39). */
export const REGEX_TIME_LIMIT_MS = 3_000;

/**
 * Does the query hold a /regex/ operator (../search/queryOps.ts)? The same token shape, checked here without
 * loading the query parser on the main thread; a false positive (a slash inside a quoted phrase) only arms the timer.
 */
const REGEX_TOKEN = /(?:^|\s)-?\/(?:\\.|[^/\\])+\/[imsu]*(?=\s|$)/;
const hasRegexOp = (query: string) => REGEX_TOKEN.test(query);

/** Cheap fuzzy + substring search across filenames, paths, and content. */
export async function searchWorkspace(
  query: string,
  /** `filter`: only these paths — applied before `limit`. */
  opts: {
    limit?: number;
    filter?: (path: string) => boolean;
    /** Told what a /regex/ could not check (2.39): notes too long for it, or a search stopped at the time limit. */
    onRegexInfo?: (info: Omit<SearchResult, "hits">) => void;
    /** Test hook: the /regex/ time limit (default REGEX_TIME_LIMIT_MS). */
    timeLimitMs?: number;
  } = {},
): Promise<SearchHit[]> {
  const { hits, ...info } = await searchDetailed(query, opts);
  opts.onRegexInfo?.(info);
  return hits;
}

/**
 * The search, and what a /regex/ could not check (2.39): how many notes were too long for it, and whether it ran
 * past REGEX_TIME_LIMIT_MS. A /regex/ search in the index worker that runs past the limit is stopped by restarting
 * the worker (restartEngine: a fresh one is filled again), and answers with no hits and `regexTimedOut`. Without a
 * worker the regex runs in this thread and cannot be stopped; only the size cap (REGEX_MAX_CHARS) holds.
 */
async function searchDetailed(query: string, opts: { limit?: number; filter?: (path: string) => boolean; timeLimitMs?: number }): Promise<SearchResult> {
  await checkedIndex();
  if (!cache.byPath.size) return { hits: [], regexSkipped: 0 };
  const filter = opts.filter;
  // A function cannot cross into the worker: send the paths it allows.
  const paths = filter ? [...cache.byPath.keys()].filter((p) => filter(p)) : undefined;
  const req = { limit: opts.limit ?? 30, paths };
  if (hasRegexOp(query)) {
    const current = getEngine();
    const e = await current;
    if (e.kind === "worker") {
      const limitMs = opts.timeLimitMs ?? REGEX_TIME_LIMIT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), limitMs);
      });
      const answer = e.query(query, req);
      try {
        const res = await Promise.race([answer, timedOut]);
        if (res !== "timeout") return res;
      } catch {
        // The worker failed for another reason: withEngine's fallback (an in-thread engine).
        return withEngine((x) => x.query(query, req));
      } finally {
        clearTimeout(timer);
      }
      answer.catch(() => undefined);
      log.warn(`search: /regex/ ran past ${limitMs} ms; restarting the index worker`);
      void restartEngine(current, e);
      return { hits: [], regexSkipped: 0, regexTimedOut: true };
    }
  }
  return withEngine((x) => x.query(query, req));
}

/**
 * W2.22 — the text of indexed notes, read from the index (the main thread
 * keeps summaries only). For a view that reads the text once and lets it go:
 * each note's summary with its `content`. All notes when `paths` is omitted.
 */
export async function indexedNotes(paths?: readonly string[]): Promise<Array<IndexedFile & { content: string }>> {
  await checkedIndex();
  if (!cache.byPath.size) return [];
  const want = paths ? paths.filter((p) => cache.byPath.has(p)) : undefined;
  if (want && !want.length) return [];
  const texts = await withEngine((e) => e.texts(want ? [...want] : undefined));
  const out: Array<IndexedFile & { content: string }> = [];
  for (const t of texts) {
    const f = cache.byPath.get(t.path);
    if (f) out.push({ ...f, content: t.content });
  }
  return out;
}

/** One note's text from the index, or null when it is not indexed. */
export async function indexedNoteText(path: string): Promise<string | null> {
  return (await indexedNotes([path]))[0]?.content ?? null;
}

/**
 * Every highlight in the vault (plan W1.15), built in the index worker from
 * the notes it already holds (W10.C25): the main thread neither reads the
 * notes again nor parses them. Follows the index, so a note a sync round
 * changed is answered as it is now.
 */
export async function indexedHighlights(): Promise<import("../highlights/hub").HighlightItem[]> {
  await checkedIndex();
  return withEngine((e) => e.highlights());
}

/** Notes related to a paragraph (plan W2.2), ranked by the index's BM25 in the index worker. */
export async function relatedInIndex(query: import("./vaultIndexProtocol").RelatedQuery): Promise<import("../related/related").RelatedHit[]> {
  await checkedIndex();
  return withEngine((e) => e.related(query));
}

/**
 * Run a ```tasks``` query over every note in the vault (plan 4.13), in the
 * index worker. Dates in the query are relative to the user's local today.
 */
export async function queryVaultTasks(query: string, today = new Date()): Promise<import("../tasks/taskQuery").QueryResult> {
  await checkedIndex();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return withEngine((e) => e.tasks(query, iso));
}

/**
 * W6.36: resolves once the snapshot the index opened from has been checked
 * against the vault (at once when it opened otherwise). Queries wait for it
 * themselves; a view showing `indexedFiles()` can wait for it to re-derive.
 */
export function indexChecked(): Promise<void> {
  return verified();
}

/** Changes whenever the indexed files do: a cache of something derived from them is good while it is the same. */
export function indexVersion(): number {
  return cache.version;
}

/** Work counters of the index (files, notes indexed so far…) — for tests and the perf spec. */
export async function indexStats(): Promise<IndexStats & { engine: IndexEngine["kind"] }> {
  const stats = await withEngine((e) => e.stats());
  return { ...stats, engine: (await getEngine()).kind };
}
