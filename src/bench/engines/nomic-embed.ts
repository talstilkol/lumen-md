/**
 * Dense retrieval with Ollama's nomic-embed-text through the app's own
 * embedding provider (src/ai/embeddingProvider.ts, the `ollama:` provider
 * the smart search picks when Ollama has an embedding model, W10.E35):
 * cosine over each part's corpus. Needs `ollama serve` with
 * nomic-embed-text pulled; the bench does not pull it.
 */
import { __providers } from "../../ai/embeddingProvider";
import { isOllamaAvailable, listOllamaModels } from "../../ai/ollamaProvider";
import type { RetrievalDoc, RetrievalInput } from "../retrieval";
import type { BenchEngine } from "../types";

const MODEL = "nomic-embed-text";
const provider = __providers.ollamaProvider(MODEL);
const parts = new Map<string, { ids: string[]; vectors: Float32Array[] }>();

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

async function embed(texts: string[], kind: "query" | "passage"): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 16) out.push(...(await provider.embed(texts.slice(i, i + 16), kind)));
  return out;
}

export const engine: BenchEngine = {
  id: "nomic-embed",
  label: "Ollama nomic-embed-text, dense",
  set: "retrieval",
  models: [MODEL],
  async load() {
    if (!(await isOllamaAvailable())) throw new Error("Ollama is not running on this machine (ollama serve)");
    if (!(await listOllamaModels()).some((m) => m.name.split(":")[0] === MODEL)) throw new Error(`ollama pull ${MODEL} first`);
    await embed(["טעינה"], "query");
    return { device: "cpu", model: MODEL };
  },
  async prepare(part, shared) {
    const docs = shared as RetrievalDoc[];
    parts.set(part, { ids: docs.map((d) => d.id), vectors: await embed(docs.map((d) => `${d.title ? `${d.title}. ` : ""}${d.text}`.slice(0, 2000)), "passage") });
  },
  async run(item) {
    const p = parts.get(item.part)!;
    const input = item.input as RetrievalInput;
    const skip = new Set(input.skip);
    const [q] = await embed([input.query], "query");
    return p.ids
      .map((id, i) => ({ id, s: cosine(q, p.vectors[i]) }))
      .filter((x) => !skip.has(x.id))
      .sort((a, b) => b.s - a.s)
      .slice(0, 10)
      .map((x) => x.id);
  },
  dispose: async () => parts.clear(),
};
