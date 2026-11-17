/**
 * Search results a page at a time (plan W13.V3): with thousands of matches
 * the first page arrives at once and the rest follow, while the list on
 * screen only grows — a result never moves once shown, and nothing jumps
 * while the user types (the next keystroke aborts the stream).
 *
 * Pages come from the index engine (the worker) in relevance order: BM25
 * (plan 5.2) with the name and phrase bonuses, page after page from the same
 * ranking (vaultIndexCore `offset`). The first page is small so the first
 * result is fast; later pages are larger. A result the first page lifted with
 * the phrase bonus is not repeated.
 */
import type { SearchHit } from "./vaultIndexCore";

export interface StreamOptions {
  /** Size of the first page (default 50) and of the next ones (default 500). */
  firstPage?: number;
  pageSize?: number;
  /** Stop after this many results (default 5,000). */
  max?: number;
  signal?: AbortSignal;
  /** Every page as it arrives: the new hits and how many are shown so far. */
  onPage: (hits: SearchHit[], shown: number) => void;
}

export type PageSearch = (query: string, opts: { limit: number; offset: number }) => Promise<SearchHit[]>;

/** Run `search` page by page until it runs dry, `max` is reached or `signal` aborts. Resolves with every hit, in order. */
export async function streamSearch(search: PageSearch, query: string, opts: StreamOptions): Promise<SearchHit[]> {
  const first = opts.firstPage ?? 50;
  const size = opts.pageSize ?? 500;
  const max = opts.max ?? 5000;
  const seen = new Set<string>();
  const all: SearchHit[] = [];
  let offset = 0;
  let limit = first;
  while (all.length < max) {
    if (opts.signal?.aborted) break;
    const page = await search(query, { limit, offset });
    if (opts.signal?.aborted) break;
    const fresh = page.filter((h) => !seen.has(h.path)).slice(0, max - all.length);
    for (const h of fresh) seen.add(h.path);
    all.push(...fresh);
    if (fresh.length) opts.onPage(fresh, all.length);
    // The engine returns the slice it ranked; fewer than asked for means the ranking ran out.
    if (page.length < limit) break;
    offset += limit;
    limit = size;
  }
  return all;
}
