/**
 * Workspace RAG engine — BM25+ with bigram phrase matching.
 *
 * Upgraded from TF-IDF to BM25+ for better ranking of long documents.
 * Includes EN+HE stopword filtering and bigram phrase support.
 *
 * The index is stored in-memory and refreshed every 60s.
 */

import { get, set } from "idb-keyval";
import {
  ensureIndex,
} from "../storage/workspaceIndex";
import {
  isOPFSAvailable,
  listWorkspace,
  readWorkspaceFile,
  isAssetName,
} from "../storage/workspace";
import {
  buildBM25Index,
  bm25Search,
  type BM25Index,
} from "./neuralSearch";

/* ─── Types ─────────────────────────────────────────────────────── */

export interface RagResult {
  path: string;
  score: number;
  snippet: string;
  content: string;
}

const IDB_KEY = "lumen-rag-bm25";
const STALE_MS = 60_000; // rebuild if >60s old

let currentIndex: BM25Index | null = null;

/* ─── Public API ────────────────────────────────────────────────── */

/**
 * Build or refresh the BM25+ index from the workspace.
 */
export async function buildRagIndex(): Promise<void> {
  if (!isOPFSAvailable()) return;
  await ensureIndex();

  const list = await listWorkspace({ includeAssets: false });
  const docs: { path: string; content: string }[] = [];

  await Promise.all(
    list
      .filter((e) => !isAssetName(e.path))
      .map(async (e) => {
        try {
          const content = await readWorkspaceFile(e.path);
          if (content.trim().length > 10) {
            docs.push({ path: e.path, content });
          }
        } catch {
          /* skip */
        }
      }),
  );

  if (docs.length < 2) return; // Not enough docs for meaningful search

  currentIndex = buildBM25Index(docs);

  // Persist build stats
  await set(IDB_KEY, {
    builtAt: currentIndex.builtAt,
    docCount: docs.length,
  }).catch(() => {});
}

/**
 * Search the workspace using BM25+ ranking.
 * Returns ranked results with full content for context stuffing.
 */
export async function semanticSearch(
  query: string,
  opts: { topK?: number; maxContentChars?: number } = {},
): Promise<RagResult[]> {
  const topK = opts.topK ?? 8;
  const maxChars = opts.maxContentChars ?? 6000;

  // Rebuild if stale or missing
  if (!currentIndex || Date.now() - currentIndex.builtAt > STALE_MS) {
    await buildRagIndex();
  }

  if (!currentIndex || currentIndex.docs.length === 0) return [];

  const scored = bm25Search(query, currentIndex, topK);

  // Load full content for top results
  const results: RagResult[] = [];
  for (const hit of scored) {
    try {
      const content = await readWorkspaceFile(hit.path);
      results.push({
        path: hit.path,
        score: hit.score,
        snippet: hit.snippet,
        content: content.slice(0, maxChars),
      });
    } catch {
      results.push({ ...hit, content: hit.snippet });
    }
  }

  return results;
}

/**
 * Get the current index stats.
 */
export function getRagStats(): { docCount: number; vocabSize: number } | null {
  if (!currentIndex) return null;
  return {
    docCount: currentIndex.docs.length,
    vocabSize: currentIndex.df.size,
  };
}

