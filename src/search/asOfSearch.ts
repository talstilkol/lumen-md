/**
 * W12.S1 — search the vault as it was at a date.
 *
 * A throwaway BM25 index (the same `Bm25Index` the main search uses) is
 * built over the texts `vaultAsOf` returns. It is a new instance: the main
 * index is never read or changed. In the browser the index is built and
 * queried in a worker (`asOf.worker.ts`); where workers are absent (tests,
 * SSR) the same code runs inline.
 */
import { Bm25Index, type Bm25Hit } from "./bm25";
import type { AsOfVault } from "../storage/asOf";

export interface AsOfDoc {
  name: string;
  content: string;
  timestamp: number;
}

export interface AsOfHit extends Bm25Hit {
  /** When the matched version was saved. */
  timestamp: number;
}

/** The display name of a note path, for the name boost. */
const baseName = (p: string) => p.replace(/^.*\//, "").replace(/\.[a-z]+$/i, "");

/** A fresh index over `docs`. */
export function buildAsOfIndex(docs: readonly AsOfDoc[]): Bm25Index {
  const idx = new Bm25Index();
  for (const d of docs) idx.set(d.name, d.content, baseName(d.name));
  return idx;
}

/** Search `docs` (inline). */
export function searchDocs(docs: readonly AsOfDoc[], query: string, limit = 50): AsOfHit[] {
  const when = new Map(docs.map((d) => [d.name, d.timestamp]));
  return buildAsOfIndex(docs)
    .search(query, { limit, prefix: true })
    .map((h) => ({ ...h, timestamp: when.get(h.id) ?? 0 }));
}

export const docsOf = (v: AsOfVault): AsOfDoc[] => [...v.notes.values()].map(({ name, content, timestamp }) => ({ name, content, timestamp }));

type WorkerFactory = () => Worker;
const defaultWorker: WorkerFactory = () => new Worker(new URL("./asOf.worker.ts", import.meta.url), { type: "module", name: "as-of-search" });

/**
 * Search the vault as of `v.asOf`. Runs in a worker when one can be made
 * (one worker per call: the index lives only as long as the query); falls
 * back to inline when it cannot or it fails.
 */
export async function searchAsOf(v: AsOfVault, query: string, opts: { limit?: number; worker?: WorkerFactory | null } = {}): Promise<AsOfHit[]> {
  const docs = docsOf(v);
  const limit = opts.limit ?? 50;
  const make = opts.worker === undefined ? (typeof Worker === "function" ? defaultWorker : null) : opts.worker;
  if (!make) return searchDocs(docs, query, limit);
  let w: Worker;
  try {
    w = make();
  } catch {
    return searchDocs(docs, query, limit);
  }
  try {
    return await new Promise<AsOfHit[]>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<{ hits?: AsOfHit[]; error?: string }>) =>
        e.data.hits ? resolve(e.data.hits) : reject(new Error(e.data.error ?? "as-of search failed"));
      w.onerror = (e) => reject(new Error(e.message || "as-of worker error"));
      w.postMessage({ docs, query, limit });
    });
  } catch {
    return searchDocs(docs, query, limit);
  } finally {
    w.terminate();
  }
}
