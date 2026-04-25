/**
 * Lightweight embedding engine for workspace RAG.
 *
 * Uses TF-IDF vectors with cosine similarity — works offline, zero dependencies,
 * and performs well for workspace-sized corpora (<1000 docs).
 *
 * The index is stored in IndexedDB via idb-keyval for persistence across sessions.
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

/* ─── Types ─────────────────────────────────────────────────────── */

interface DocVector {
  path: string;
  /** TF-IDF weight for each term index. */
  vec: Float32Array;
  /** First 300 chars of content for snippet display. */
  snippet: string;
}

interface VectorIndex {
  /** Term → column index mapping. */
  vocab: Map<string, number>;
  /** IDF weight per term. */
  idf: Float32Array;
  /** Per-document vectors. */
  docs: DocVector[];
  /** Timestamp of last build. */
  builtAt: number;
}

const IDB_KEY = "lumen-rag-vectors";
const STALE_MS = 60_000; // rebuild if >60s old

let currentIndex: VectorIndex | null = null;

/* ─── Tokenizer ─────────────────────────────────────────────────── */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && w.length < 40);
}

/* ─── TF-IDF Builder ────────────────────────────────────────────── */

function buildVectors(
  docs: { path: string; content: string }[],
): VectorIndex {
  // Step 1: Build vocabulary from all documents
  const df = new Map<string, number>(); // document frequency
  const allTokens: string[][] = [];

  for (const doc of docs) {
    const tokens = tokenize(doc.content);
    allTokens.push(tokens);
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }
  }

  // Step 2: Build vocab (top 5000 terms by df, excluding too-rare/too-common)
  const N = docs.length;
  const entries = [...df.entries()]
    .filter(([, count]) => count >= 2 && count < N * 0.9)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5000);

  const vocab = new Map<string, number>();
  entries.forEach(([term], i) => vocab.set(term, i));
  const vocabSize = vocab.size;

  // Step 3: Compute IDF
  const idf = new Float32Array(vocabSize);
  for (const [term, idx] of vocab) {
    idf[idx] = Math.log(1 + N / (df.get(term) ?? 1));
  }

  // Step 4: Compute TF-IDF vectors for each document
  const docVecs: DocVector[] = docs.map((doc, i) => {
    const tokens = allTokens[i];
    const tf = new Map<number, number>();
    for (const t of tokens) {
      const idx = vocab.get(t);
      if (idx !== undefined) {
        tf.set(idx, (tf.get(idx) ?? 0) + 1);
      }
    }

    const vec = new Float32Array(vocabSize);
    const docLen = tokens.length || 1;
    for (const [idx, count] of tf) {
      vec[idx] = (count / docLen) * idf[idx];
    }

    // L2 normalize
    let norm = 0;
    for (let j = 0; j < vocabSize; j++) norm += vec[j] * vec[j];
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < vocabSize; j++) vec[j] /= norm;

    return {
      path: doc.path,
      vec,
      snippet: doc.content.slice(0, 300).replace(/\s+/g, " ").trim(),
    };
  });

  return { vocab, idf, docs: docVecs, builtAt: Date.now() };
}

/* ─── Cosine Similarity ─────────────────────────────────────────── */

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // Vectors are already L2 normalized, so dot = cosine
}

/* ─── Query Vectorizer ──────────────────────────────────────────── */

function vectorizeQuery(
  query: string,
  vocab: Map<string, number>,
  idf: Float32Array,
): Float32Array {
  const tokens = tokenize(query);
  const vec = new Float32Array(vocab.size);
  const tf = new Map<number, number>();

  for (const t of tokens) {
    const idx = vocab.get(t);
    if (idx !== undefined) {
      tf.set(idx, (tf.get(idx) ?? 0) + 1);
    }
  }

  const docLen = tokens.length || 1;
  for (const [idx, count] of tf) {
    vec[idx] = (count / docLen) * idf[idx];
  }

  let norm = 0;
  for (let j = 0; j < vec.length; j++) norm += vec[j] * vec[j];
  norm = Math.sqrt(norm) || 1;
  for (let j = 0; j < vec.length; j++) vec[j] /= norm;

  return vec;
}

/* ─── Public API ────────────────────────────────────────────────── */

export interface RagResult {
  path: string;
  score: number;
  snippet: string;
  content: string;
}

/**
 * Build or refresh the vector index from the workspace.
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

  currentIndex = buildVectors(docs);

  // Persist vocab size + build time (vectors are in-memory only for speed)
  await set(IDB_KEY, {
    builtAt: currentIndex.builtAt,
    docCount: docs.length,
  }).catch(() => {});
}

/**
 * Search the workspace using semantic similarity.
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

  const queryVec = vectorizeQuery(query, currentIndex.vocab, currentIndex.idf);

  // Score all documents
  const scored = currentIndex.docs
    .map((doc) => ({
      path: doc.path,
      score: cosineSimilarity(queryVec, doc.vec),
      snippet: doc.snippet,
    }))
    .filter((d) => d.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

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
    vocabSize: currentIndex.vocab.size,
  };
}
