/**
 * Semantic search — workspace RAG layer that complements the existing BM25
 * keyword index with OpenAI text-embedding-3-small vectors.
 *
 * Flow:
 *   1. `indexWorkspace()` chunks every workspace file at heading boundaries,
 *      embeds each chunk, and stores the vectors keyed by path + content hash.
 *   2. `searchSemantic(query, k)` embeds the query and returns the top-k
 *      chunks ranked by cosine similarity.
 *   3. `searchHybrid(query, k)` merges semantic and BM25 hits with weighted
 *      reciprocal-rank fusion so a query like "deep learning" still finds
 *      a doc titled "Neural networks" even when the surface words don't
 *      match.
 *
 * Vectors live in IndexedDB so the index survives reloads. Re-indexing only
 * re-embeds chunks whose hash changed, keeping the API cost bounded.
 */

import { get, set } from "idb-keyval";
import { useAppStore } from "../store/useStore";
import { log } from "../lib/logger";
import {
  isOPFSAvailable,
  listWorkspace,
  readWorkspaceFile,
  isAssetName,
} from "../storage/workspace";
import { searchWorkspace } from "../storage/workspaceIndex";

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_URL = "https://api.openai.com/v1/embeddings";
const EMBED_DIMS = 1536;
const IDB_KEY = "lumen-semantic-index";
const MAX_CHUNK_CHARS = 1800; // ~450 tokens
const EMBED_BATCH_SIZE = 16;

export interface ChunkRecord {
  hash: string;
  start: number;
  end: number;
  preview: string;
  /** base64-encoded Float32Array bytes for storage; deserialised on read. */
  vector: string;
}

export interface FileRecord {
  path: string;
  chunks: ChunkRecord[];
}

export interface SemanticIndex {
  builtAt: number;
  files: Record<string, FileRecord>;
}

export interface SemanticHit {
  path: string;
  score: number;
  snippet: string;
}

/* ─── Hash + base64 helpers ──────────────────────────────────────────── */

async function sha1(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function vectorToBase64(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToVector(s: string): Float32Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/* ─── Chunking ──────────────────────────────────────────────────────── */

/**
 * Split markdown along heading boundaries first, then any chunk that's still
 * too long is sliced at the closest paragraph break under the size limit.
 */
export function chunkMarkdown(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const lines = text.split("\n");
  let cursor = 0;
  let buffer = "";
  let bufferStart = 0;

  const flush = () => {
    if (!buffer.trim()) return;
    let chunk = buffer;
    let chunkStart = bufferStart;
    // Slice oversized buffers at paragraph breaks.
    while (chunk.length > MAX_CHUNK_CHARS) {
      const sliceEnd = chunk.lastIndexOf("\n\n", MAX_CHUNK_CHARS);
      const cut = sliceEnd > 200 ? sliceEnd : MAX_CHUNK_CHARS;
      out.push({ start: chunkStart, end: chunkStart + cut, text: chunk.slice(0, cut) });
      chunk = chunk.slice(cut);
      chunkStart += cut;
    }
    out.push({ start: chunkStart, end: chunkStart + chunk.length, text: chunk });
    buffer = "";
  };

  for (const line of lines) {
    const isHeading = /^#{1,6}\s+/.test(line);
    if (isHeading && buffer.trim().length > 0) flush();
    if (!buffer) bufferStart = cursor;
    buffer += (buffer ? "\n" : "") + line;
    cursor += line.length + 1;
  }
  flush();
  return out;
}

/* ─── OpenAI embedding ──────────────────────────────────────────────── */

async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const key = useAppStore.getState().aiKey;
  if (!key) throw new Error("Configure your AI Key (⌘K → AI Settings) to use semantic search.");
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding API ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => Float32Array.from(d.embedding));
}

async function embedTextsInBatches(texts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const slice = texts.slice(i, i + EMBED_BATCH_SIZE);
    const vecs = await embedTexts(slice);
    out.push(...vecs);
  }
  return out;
}

/* ─── Index lifecycle ───────────────────────────────────────────────── */

async function loadIndex(): Promise<SemanticIndex> {
  const cached = (await get(IDB_KEY).catch(() => undefined)) as SemanticIndex | undefined;
  return cached ?? { builtAt: 0, files: {} };
}

async function saveIndex(index: SemanticIndex): Promise<void> {
  await set(IDB_KEY, index).catch((err) => log.warn("semantic index persist failed", err));
}

let inFlightIndex: Promise<SemanticIndex> | null = null;

/**
 * Build (or refresh) the semantic index over the OPFS workspace.
 * Concurrent calls share the same in-flight promise.
 */
export async function indexWorkspace(opts: { force?: boolean } = {}): Promise<SemanticIndex> {
  if (inFlightIndex && !opts.force) return inFlightIndex;
  inFlightIndex = (async () => {
    if (!isOPFSAvailable()) return { builtAt: 0, files: {} };
    const entries = await listWorkspace({ includeAssets: false });
    const files = entries.filter(
      (n) => /\.(md|markdown|txt)$/i.test(n.path) && !isAssetName(n.name),
    );
    const index = await loadIndex();
    const wantedPaths = new Set(files.map((f) => f.path));

    // Drop entries for files that no longer exist.
    for (const path of Object.keys(index.files)) {
      if (!wantedPaths.has(path)) delete index.files[path];
    }

    for (const file of files) {
      const content = await readWorkspaceFile(file.path).catch(() => "");
      if (!content.trim()) {
        delete index.files[file.path];
        continue;
      }
      const chunks = chunkMarkdown(content);
      const existing = index.files[file.path]?.chunks ?? [];
      const hashes = await Promise.all(chunks.map((c) => sha1(c.text)));
      // Re-use vectors for chunks whose hash matches the previous run.
      const reusable = new Map(existing.map((c) => [c.hash, c]));
      const toEmbedIdx: number[] = [];
      const toEmbedTexts: string[] = [];
      const records: (ChunkRecord | null)[] = chunks.map((c, i) => {
        const hash = hashes[i];
        const cached = reusable.get(hash);
        if (cached) return cached;
        toEmbedIdx.push(i);
        toEmbedTexts.push(c.text);
        return null;
      });

      if (toEmbedTexts.length > 0) {
        const vecs = await embedTextsInBatches(toEmbedTexts);
        toEmbedIdx.forEach((idx, k) => {
          const c = chunks[idx];
          records[idx] = {
            hash: hashes[idx],
            start: c.start,
            end: c.end,
            preview: c.text.slice(0, 200),
            vector: vectorToBase64(vecs[k]),
          };
        });
      }
      index.files[file.path] = {
        path: file.path,
        chunks: records.filter((r): r is ChunkRecord => r !== null),
      };
    }

    index.builtAt = Date.now();
    await saveIndex(index);
    return index;
  })();
  try {
    return await inFlightIndex;
  } finally {
    inFlightIndex = null;
  }
}

/* ─── Search ────────────────────────────────────────────────────────── */

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export async function searchSemantic(query: string, k = 8): Promise<SemanticHit[]> {
  if (!query.trim()) return [];
  const index = await loadIndex();
  if (!Object.keys(index.files).length) return [];
  const [qVec] = await embedTexts([query]);
  if (qVec.length !== EMBED_DIMS) {
    log.warn("query vector unexpected dim", qVec.length);
  }
  const all: SemanticHit[] = [];
  for (const file of Object.values(index.files)) {
    let best: { chunk: ChunkRecord; score: number } | null = null;
    for (const chunk of file.chunks) {
      const v = base64ToVector(chunk.vector);
      const s = cosine(qVec, v);
      if (!best || s > best.score) best = { chunk, score: s };
    }
    if (best) {
      all.push({ path: file.path, score: best.score, snippet: best.chunk.preview });
    }
  }
  return all.sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Hybrid retrieval: pulls the top BM25 hits and the top semantic hits, then
 * fuses them with reciprocal rank weighting. The result favours documents
 * that match BOTH the keyword and the semantic intent.
 */
export async function searchHybrid(query: string, k = 8): Promise<SemanticHit[]> {
  const [bmHits, semHits] = await Promise.all([
    searchWorkspace(query, { limit: k * 2 }).catch(() => []),
    searchSemantic(query, k * 2).catch(() => [] as SemanticHit[]),
  ]);
  // Reciprocal Rank Fusion (k=60 is the conventional constant).
  const fusion = new Map<string, { score: number; snippet: string }>();
  const RRF_K = 60;
  bmHits.forEach((h, i) => {
    const cur = fusion.get(h.path) ?? { score: 0, snippet: h.snippet ?? "" };
    cur.score += 1 / (RRF_K + i + 1);
    cur.snippet = cur.snippet || (h.snippet ?? "");
    fusion.set(h.path, cur);
  });
  semHits.forEach((h, i) => {
    const cur = fusion.get(h.path) ?? { score: 0, snippet: h.snippet };
    cur.score += 1.2 * (1 / (RRF_K + i + 1)); // slight semantic boost
    cur.snippet = cur.snippet || h.snippet;
    fusion.set(h.path, cur);
  });
  return [...fusion.entries()]
    .map(([path, v]) => ({ path, score: v.score, snippet: v.snippet }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function clearSemanticIndex(): Promise<void> {
  await set(IDB_KEY, undefined).catch(() => {});
}
