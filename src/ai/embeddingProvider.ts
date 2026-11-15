/**
 * Embedding providers for smart search, local first:
 *
 *   1. Ollama `/api/embed` with `nomic-embed-text` (or another installed
 *      embedding model) — when a local-origin Ollama has one installed;
 *   2. transformers.js in a worker — always available in the browser: the
 *      measured winner of the embeddings competition when an ingested run
 *      chose one (./embeddingDefault.json, written by `npm run
 *      eval:embed-ingest`, plan W7.13), at its Matryoshka size (256: the
 *      first 256 dimensions, renormalised), else `multilingual-e5-small`
 *      (384 dims, ~100 languages incl. Hebrew);
 *   3. OpenAI `text-embedding-3-small` — only under the `cloud` policy.
 *
 * Vectors from different models are not comparable, so the index records
 * which provider/model built it (`embeddingId()`), and a mismatch forces a
 * rebuild. e5 models expect "query: " / "passage: " prefixes.
 */

import { useAppStore } from "../store/useStore";
import { fetchWithRetry } from "../lib/fetchRetry";
import { assertCloudAllowed, getAiPolicy, isLocalOrigin } from "./policy";
import measuredDefault from "./embeddingDefault.json";

export type EmbeddingKind = "query" | "passage";

export interface EmbeddingProvider {
  /** Stable id: provider + model, stored with the index. */
  id: string;
  dims: number | null;
  embed(texts: string[], kind: EmbeddingKind): Promise<Float32Array[]>;
}

const OLLAMA_EMBED_MODELS = /^(nomic-embed-text|embeddinggemma|mxbai-embed-large|all-minilm|bge-m3|snowflake-arctic-embed)/i;

async function ollamaEmbeddingModel(): Promise<string | null> {
  const { getBaseUrl, listOllamaModels, isOllamaAvailable } = await import("./ollamaProvider");
  if (!isLocalOrigin(getBaseUrl()) || !(await isOllamaAvailable())) return null;
  const models = await listOllamaModels();
  return models.find((m) => OLLAMA_EMBED_MODELS.test(m.name))?.name ?? null;
}

function ollamaProvider(model: string): EmbeddingProvider {
  return {
    id: `ollama:${model}`,
    dims: null,
    async embed(texts) {
      const { getBaseUrl } = await import("./ollamaProvider");
      const res = await fetch(`${getBaseUrl()}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`Ollama embed error ${res.status}`);
      const data = (await res.json()) as { embeddings?: number[][] };
      return (data.embeddings ?? []).map((v) => Float32Array.from(v));
    },
  };
}

const transformersProvider: EmbeddingProvider = {
  id: "transformers:Xenova/multilingual-e5-small",
  dims: 384,
  async embed(texts, kind) {
    const { embedTextsLocal } = await import("./transformersEngine");
    const prefixed = texts.map((t) => `${kind}: ${t}`);
    const out = await embedTextsLocal(prefixed);
    return out.vectors.map((v) => Float32Array.from(v));
  },
};

/** src/ai/embeddingDefault.json's `default`: the competition's winner, as eval:embed-ingest wrote it. */
export interface MeasuredEmbedding {
  id: string;
  hf: string;
  dtype: string;
  sha256: string;
  dims: number;
  prefix: { query: string; document: string };
  measured?: { file: string | null; date: string | null; heldoutNdcg10: number | null; msPerQuery: number | null; reason: string };
}

/** Matryoshka: the first `dims` values, renormalised to unit length (embed-compete.mjs truncateMatryoshka). */
export function truncateMatryoshka(v: ArrayLike<number>, dims: number): Float32Array {
  const out = Float32Array.from(Array.prototype.slice.call(v, 0, dims) as number[]);
  let n = 0;
  for (const x of out) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

/**
 * The measured winner as a provider. Its id carries the size, so an index
 * built with another model or size is rebuilt (embeddingId()).
 */
export function measuredProvider(m: MeasuredEmbedding): EmbeddingProvider {
  return {
    id: `transformers:${m.hf}@${m.dims}`,
    dims: m.dims,
    async embed(texts, kind) {
      const { embedTextsLocal } = await import("./transformersEngine");
      const prefix = kind === "query" ? m.prefix.query : m.prefix.document;
      const out = await embedTextsLocal(texts.map((t) => prefix + t), { model: m.hf });
      return out.vectors.map((v) => truncateMatryoshka(v, m.dims));
    },
  };
}

/** The ingested default, when there is a complete one; null keeps multilingual-e5-small. */
export function measuredEmbedding(raw: unknown = (measuredDefault as { default: unknown }).default): MeasuredEmbedding | null {
  const m = raw as Partial<MeasuredEmbedding> | null;
  if (!m || typeof m.hf !== "string" || typeof m.sha256 !== "string" || !Number.isInteger(m.dims) || (m.dims ?? 0) <= 0 || typeof m.prefix?.query !== "string" || typeof m.prefix?.document !== "string") return null;
  return m as MeasuredEmbedding;
}

const openAiProvider: EmbeddingProvider = {
  id: "openai:text-embedding-3-small",
  dims: 1536,
  async embed(texts) {
    assertCloudAllowed("OpenAI embeddings (smart search)");
    const key = useAppStore.getState().aiKey;
    if (!key) throw new Error("Configure your AI Key (⌘K → AI Settings) to use cloud embeddings.");
    const res = await fetchWithRetry(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
      },
      { label: "semantic.embed", maxRetries: 2, baseDelayMs: 500, maxDelayMs: 2000 },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Embedding API ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => Float32Array.from(d.embedding));
  },
};

/** The provider for this device and policy. */
export async function pickEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (getAiPolicy() === "cloud" && useAppStore.getState().aiKey) return openAiProvider;
  const ollama = await ollamaEmbeddingModel().catch(() => null);
  if (ollama) return ollamaProvider(ollama);
  // Plan W7.13: the competition's measured winner, once an ingested run chose one.
  const m = measuredEmbedding();
  return m ? measuredProvider(m) : transformersProvider;
}

/** Tests. */
export const __providers = { transformersProvider, openAiProvider, ollamaProvider };
