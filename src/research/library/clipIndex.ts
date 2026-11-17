/**
 * The reading library's own embedding index (plan 7.6, W10.E36): clips only,
 * updated when a clip is saved, searched from the library panel.
 *
 * - **Clips only.** A note is a clip when it is in the library folder
 *   (`Library/`, `ספרייה/`) or its frontmatter has `clipped:` (every clip
 *   template writes it). The workspace's smart-search index covers every
 *   note; this one is small and stays about what was read.
 * - **On save.** `indexClipOnSave` embeds a new or changed clip as it is
 *   saved, once the library index exists on this device (the panel builds
 *   it, or smart search has built its own). Before that nothing is embedded
 *   on save: the first build may download an embedding model, and that
 *   happens on a person's request (opening the panel), not as a side effect
 *   of clipping a page.
 * - **Its own vectors, same provider rules.** The provider is the one smart
 *   search picks (pickEmbeddingProvider: Ollama or transformers.js on this
 *   device; OpenAI only under the cloud policy). The index records the
 *   provider and model; vectors of another one are discarded, as they are
 *   not comparable.
 * - **Stored like the smart-search index:** IndexedDB, sealed in an
 *   encrypted vault (forStore/fromStore), nothing written while it is locked.
 */
import { chunkMarkdown, packVectors, bestChunk, type FileVectors } from "../../ai/semanticSearch";
import { isLibraryPath } from "../clipper";
import { log } from "../../lib/logger";
import { compareNames } from "../../i18n/collate";

export const LIBRARY_INDEX_KEY = "lumen-library-index";
const LABEL = "library-index";
const BATCH = 16;
const PREVIEW = 240;

export interface ClipChunk {
  start: number;
  end: number;
  preview: string;
  /** base64 of the Float32Array's bytes. */
  vector: string;
}

export interface ClipEntry {
  path: string;
  title: string;
  source: string;
  /** SHA-1 of the clip's text when it was embedded. */
  hash: string;
  chunks: ClipChunk[];
}

export interface LibraryIndex {
  /** Provider + model that made the vectors. */
  embedding: string;
  builtAt: number;
  clips: Record<string, ClipEntry>;
}

export interface LibraryHit {
  path: string;
  title: string;
  source: string;
  score: number;
  snippet: string;
}

/** What the index needs from outside: an embedder and a place to keep the index. */
export interface LibraryDeps {
  embedder(): Promise<{ id: string; embed(texts: string[], kind: "query" | "passage"): Promise<Float32Array[]> }>;
  load(): Promise<LibraryIndex | undefined>;
  save(index: LibraryIndex): Promise<void>;
}

/* ─── The app's deps ─────────────────────────────────────────────────── */

let override: LibraryDeps | null = null;
/** Tests: another embedder or store for the whole app (null: the real ones). */
export function __setLibraryDeps(deps: LibraryDeps | null): void {
  override = deps;
}

export function appDeps(): LibraryDeps {
  if (override) return override;
  return {
    embedder: async () => (await import("../../ai/embeddingProvider")).pickEmbeddingProvider(),
    async load() {
      const { get } = await import("idb-keyval");
      const { fromStore } = await import("../../storage/vault/restStore");
      const stored = await get(LIBRARY_INDEX_KEY).catch(() => undefined);
      return fromStore<LibraryIndex>(LABEL, stored);
    },
    async save(index) {
      const { set } = await import("idb-keyval");
      const { forStore } = await import("../../storage/vault/restStore");
      const v = await forStore(LABEL, index);
      if (v !== undefined) await set(LIBRARY_INDEX_KEY, v);
    },
  };
}

/* ─── Pure parts ─────────────────────────────────────────────────────── */

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function field(fm: string, name: string): string {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(fm);
  if (!m) return "";
  const v = m[1].trim();
  if (v.startsWith('"')) {
    try {
      return String(JSON.parse(v));
    } catch {
      /* why: not a JSON string; use it as written */
    }
  }
  return v.replace(/^'(.*)'$/, "$1");
}

/** True when `path` with `markdown` is a clip: in the library folder, or with a `clipped:` field. */
export function isClip(path: string, markdown: string): boolean {
  if (isLibraryPath(path)) return true;
  const fm = FRONTMATTER.exec(markdown);
  return !!fm && /^clipped:/m.test(fm[1]);
}

/** A clip's title, source and body (the text after the frontmatter), with the body's offset in the note. */
export function readClip(path: string, markdown: string): { title: string; source: string; body: string; offset: number } {
  const fm = FRONTMATTER.exec(markdown);
  const meta = fm ? fm[1] : "";
  const body = fm ? markdown.slice(fm[0].length) : markdown;
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? "";
  const name = (path.split("/").pop() ?? path).replace(/\.(md|markdown|txt)$/i, "");
  return { title: field(meta, "title") || heading || name, source: field(meta, "source"), body, offset: fm ? fm[0].length : 0 };
}

async function sha1(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(s: string): Float32Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/* ─── The index ──────────────────────────────────────────────────────── */

// One operation at a time: a save during a rebuild must not be lost by the rebuild's write.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.then(op, op);
  queue = run.catch(() => undefined);
  return run;
}

const packedCache = new Map<string, FileVectors | null>();
const vectorsOf = (c: ClipEntry): FileVectors | null => {
  const key = `${c.path}\n${c.hash}`;
  if (!packedCache.has(key)) packedCache.set(key, packVectors(c.chunks.map((k) => fromBase64(k.vector))));
  return packedCache.get(key) ?? null;
};

async function current(deps: LibraryDeps, embedding: string): Promise<LibraryIndex> {
  const stored = await deps.load().catch(() => undefined);
  // Another model's vectors are not comparable: start again.
  if (!stored || stored.embedding !== embedding || typeof stored.clips !== "object") return { embedding, builtAt: Date.now(), clips: {} };
  return stored;
}

/** Embed one clip into `index` (unchanged text: nothing to do). True when it changed the index. */
async function embedInto(index: LibraryIndex, path: string, markdown: string, embed: (t: string[]) => Promise<Float32Array[]>): Promise<boolean> {
  const hash = await sha1(markdown);
  if (index.clips[path]?.hash === hash) return false;
  const { title, source, body, offset } = readClip(path, markdown);
  const parts = chunkMarkdown(body).filter((c) => c.text.trim());
  // The title is part of what a clip is about: the first chunk carries it.
  const texts = parts.map((c, i) => (i === 0 && title && !c.text.includes(title) ? `${title}\n${c.text}` : c.text));
  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH) vectors.push(...(await embed(texts.slice(i, i + BATCH))));
  if (vectors.length !== texts.length) throw new Error(`the embedder returned ${vectors.length} vectors for ${texts.length} passages`);
  index.clips[path] = {
    path,
    title,
    source,
    hash,
    chunks: parts.map((c, i) => ({ start: c.start + offset, end: c.end + offset, preview: c.text.trim().slice(0, PREVIEW), vector: toBase64(vectors[i]) })),
  };
  return true;
}

/** Add or refresh one clip. */
export function indexClip(path: string, markdown: string, deps: LibraryDeps = appDeps()): Promise<void> {
  return serial(async () => {
    const e = await deps.embedder();
    const index = await current(deps, e.id);
    if (await embedInto(index, path, markdown, (t) => e.embed(t, "passage"))) {
      index.builtAt = Date.now();
      await deps.save(index);
    }
  });
}

/** Take a clip out (deleted, or no longer a clip). */
export function removeClip(path: string, deps: LibraryDeps = appDeps()): Promise<void> {
  return serial(async () => {
    const index = await deps.load().catch(() => undefined);
    if (!index?.clips?.[path]) return;
    delete index.clips[path];
    await deps.save(index);
  });
}

/** True once a library index exists on this device (any model). */
export async function libraryIndexExists(deps: LibraryDeps = appDeps()): Promise<boolean> {
  const index = await deps.load().catch(() => undefined);
  return !!index && typeof index.embedding === "string";
}

/**
 * A clip was just saved: embed it now when the library is set up here (its
 * index exists, or smart search built one on this device); otherwise the
 * panel's first build picks it up. Never throws: a failed embedding must
 * not fail the save.
 */
export async function indexClipOnSave(path: string, markdown: string, deps: LibraryDeps = appDeps(), smartSearchBuilt: () => Promise<boolean> = defaultSmartSearchBuilt): Promise<boolean> {
  try {
    if (!(await libraryIndexExists(deps)) && !(await smartSearchBuilt())) return false;
    await indexClip(path, markdown, deps);
    return true;
  } catch (e) {
    log.warn("[library] the clip was saved but not indexed", e);
    return false;
  }
}

async function defaultSmartSearchBuilt(): Promise<boolean> {
  const { semanticIndexEmbedding } = await import("../../ai/semanticSearch");
  return !!(await semanticIndexEmbedding().catch(() => null));
}

/**
 * Bring the index up to date with the vault's clips: new and changed ones
 * are embedded, missing ones dropped. `files` lists the vault's notes and
 * `read` reads one. Returns how many clips are indexed.
 */
export function syncLibrary(files: readonly string[], read: (path: string) => Promise<string>, deps: LibraryDeps = appDeps(), onProgress?: (done: number, total: number) => void): Promise<number> {
  return serial(async () => {
    const e = await deps.embedder();
    const index = await current(deps, e.id);
    const notes = files.filter((p) => /\.(md|markdown|txt)$/i.test(p));
    let changed = false;
    const seen = new Set<string>();
    let done = 0;
    for (const path of notes) {
      let text: string;
      try {
        text = await read(path);
      } catch {
        continue;
      }
      if (isClip(path, text)) {
        seen.add(path);
        if (await embedInto(index, path, text, (t) => e.embed(t, "passage"))) changed = true;
      }
      onProgress?.(++done, notes.length);
    }
    for (const path of Object.keys(index.clips)) {
      if (!seen.has(path)) {
        delete index.clips[path];
        changed = true;
      }
    }
    if (changed || !(await libraryIndexExists(deps))) {
      index.builtAt = Date.now();
      await deps.save(index);
    }
    return Object.keys(index.clips).length;
  });
}

/** The clips closest in meaning to `query`, best first (one hit per clip, its best passage). */
export async function searchLibrary(query: string, k = 10, deps: LibraryDeps = appDeps()): Promise<LibraryHit[]> {
  const q = query.trim();
  if (!q) return [];
  const e = await deps.embedder();
  const index = await deps.load().catch(() => undefined);
  if (!index || index.embedding !== e.id) return [];
  const clips = Object.values(index.clips);
  if (!clips.length) return [];
  const [qv] = await e.embed([q], "query");
  const hits: LibraryHit[] = [];
  for (const c of clips) {
    const v = vectorsOf(c);
    const best = v ? bestChunk(qv, v) : null;
    if (!best) continue;
    hits.push({ path: c.path, title: c.title, source: c.source, score: best.score, snippet: c.chunks[best.index]?.preview ?? "" });
  }
  return hits.sort((a, b) => b.score - a.score || compareNames(a.path, b.path)).slice(0, k);
}
