/**
 * Saved searches in the vault (plan W12.A4): `.lumen/searches.json`, so they
 * travel with the vault's sync like any other file, instead of staying in
 * one browser's localStorage (W2.12).
 *
 *   { "v": 1,
 *     "searches": [{ "name": "…", "query": "tag:x path:daily/", "at": 1731650000000 }],
 *     "removed":  [{ "query": "…", "at": 1731650000000 }] }
 *
 * Two devices may each change the list before they sync. Every write reads
 * the file first and merges: per query, the newest change wins (a save or a
 * removal, by `at`), so neither device's additions are lost and a removal
 * is not undone by an older copy. Removals are kept as small tombstones
 * (the newest 200).
 *
 * Migration: the first time a device opens the vault with this code, its
 * localStorage list (`lumen-saved-searches`) is merged into the file once
 * — the same query is never added twice — and a marker in localStorage
 * keeps it from running again; the old key is then removed.
 */

export interface SavedSearch {
  name: string;
  query: string;
}
interface Entry extends SavedSearch {
  at: number;
}
interface Tombstone {
  query: string;
  at: number;
}
export interface SearchesFile {
  v: 1;
  searches: Entry[];
  removed: Tombstone[];
}

export const SEARCHES_PATH = ".lumen/searches.json";
export const LEGACY_KEY = "lumen-saved-searches";
export const MIGRATED_KEY = "lumen-saved-searches-migrated";
const MAX = 100;
const MAX_TOMBSTONES = 200;

export interface SearchesBackend {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}
export interface LocalLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const isStr = (x: unknown): x is string => typeof x === "string";

export function parseSearchesFile(text: string | null): SearchesFile {
  const empty: SearchesFile = { v: 1, searches: [], removed: [] };
  if (!text) return empty;
  try {
    const j = JSON.parse(text) as Partial<SearchesFile>;
    const searches = Array.isArray(j.searches) ? j.searches.filter((s): s is Entry => !!s && isStr(s.name) && isStr(s.query) && s.query.trim() !== "").map((s) => ({ name: s.name, query: s.query.trim(), at: Number(s.at) || 0 })) : [];
    const removed = Array.isArray(j.removed) ? j.removed.filter((r): r is Tombstone => !!r && isStr(r.query)).map((r) => ({ query: r.query, at: Number(r.at) || 0 })) : [];
    return { v: 1, searches, removed };
  } catch {
    return empty;
  }
}

/** Per query, the newest change wins; the result is newest first. */
export function mergeSearchFiles(...files: SearchesFile[]): SearchesFile {
  const latest = new Map<string, { at: number; entry: Entry | null }>();
  const put = (query: string, at: number, entry: Entry | null) => {
    const cur = latest.get(query);
    // On a tie a save beats a removal, so a re-save at the same millisecond is kept.
    if (!cur || at > cur.at || (at === cur.at && entry && !cur.entry)) latest.set(query, { at, entry });
  };
  for (const f of files) {
    for (const s of f.searches) put(s.query, s.at, s);
    for (const r of f.removed) put(r.query, r.at, null);
  }
  const searches = [...latest.values()].filter((x) => x.entry).map((x) => x.entry!).sort((a, b) => b.at - a.at).slice(0, MAX);
  const removed = [...latest.entries()].filter(([, x]) => !x.entry).map(([query, x]) => ({ query, at: x.at })).sort((a, b) => b.at - a.at).slice(0, MAX_TOMBSTONES);
  return { v: 1, searches, removed };
}

export const serializeSearchesFile = (f: SearchesFile) => JSON.stringify(f, null, 2) + "\n";

export interface SavedSearchStore {
  /** The list (synchronous, for the UI): every change shows at once, the file follows. */
  list(): SavedSearch[];
  /** Read the vault file again (after a sync), migrating once on the first load. */
  refresh(): Promise<SavedSearch[]>;
  save(query: string, name?: string): SavedSearch | null;
  remove(query: string): void;
  isSaved(query: string): boolean;
  /** Every change written to the vault file. */
  flush(): Promise<void>;
}

export function createSavedSearchStore(backend: SearchesBackend & { available?: () => boolean }, local: LocalLike | null, opts: { now?: () => number; onChange?: () => void } = {}): SavedSearchStore {
  const now = opts.now ?? Date.now;
  let current: SearchesFile = { v: 1, searches: [], removed: [] };
  // One write at a time: read, merge, write.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const p = chain.then(job, job);
    chain = p.catch(() => undefined);
    return p;
  };
  const available = () => backend.available?.() ?? true;

  /** The legacy localStorage list, once: as entries older than anything written since. */
  const legacy = (): SearchesFile | null => {
    if (!local) return null;
    try {
      if (local.getItem(MIGRATED_KEY) === "1") return null;
      const raw = JSON.parse(local.getItem(LEGACY_KEY) ?? "[]") as unknown;
      const list = Array.isArray(raw) ? raw.filter((x): x is SavedSearch => !!x && isStr((x as SavedSearch).name) && isStr((x as SavedSearch).query) && (x as SavedSearch).query.trim() !== "") : [];
      // Newest first in the old list: keep that order with descending times far in the past (1 ms apart).
      return { v: 1, searches: list.map((s, i) => ({ name: s.name, query: s.query.trim(), at: list.length - i })), removed: [] };
    } catch {
      return null;
    }
  };
  const markMigrated = () => {
    try {
      local?.setItem(MIGRATED_KEY, "1");
      local?.removeItem(LEGACY_KEY);
    } catch {
      // why: storage blocked: the merge is idempotent (by query), so running it again adds nothing
    }
  };
  const setCurrent = (next: SearchesFile) => {
    const before = JSON.stringify(current.searches.map((e) => [e.name, e.query]));
    current = next;
    if (before !== JSON.stringify(current.searches.map((e) => [e.name, e.query]))) opts.onChange?.();
  };

  /** Read the file, merge it with this device's list (and, once, the old localStorage list), write it when it changed. */
  const commit = async () => {
    if (!available()) return;
    const onDisk = parseSearchesFile(await backend.read());
    const old = legacy();
    const merged = mergeSearchFiles(onDisk, current, ...(old ? [old] : []));
    const text = serializeSearchesFile(merged);
    if (text !== serializeSearchesFile(onDisk)) await backend.write(text);
    if (old) markMigrated();
    setCurrent(merged);
  };
  const change = (f: SearchesFile) => {
    setCurrent(mergeSearchFiles(current, f));
    void serial(commit).catch(() => undefined); // why: a failed write is retried by the next change or refresh
  };
  const plain = () => current.searches.map(({ name, query }) => ({ name, query }));

  return {
    list: plain,
    refresh: () => serial(async () => (await commit(), plain())),
    save(query, name) {
      const q = query.trim();
      if (!q) return null;
      const entry = { name: (name ?? "").trim() || q, query: q, at: Math.max(now(), (current.searches[0]?.at ?? 0) + 1) };
      change({ v: 1, searches: [entry], removed: [] });
      return { name: entry.name, query: q };
    },
    remove(query) {
      const q = query.trim();
      const at = Math.max(now(), (current.searches.find((s) => s.query === q)?.at ?? 0) + 1);
      change({ v: 1, searches: [], removed: [{ query: q, at }] });
    },
    isSaved: (query) => current.searches.some((s) => s.query === query.trim()),
    flush: () => serial(async () => undefined),
  };
}
