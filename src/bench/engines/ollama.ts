/**
 * Ollama (a local server on this machine) through the app's own executor
 * (plan 7.8, W10.E34): the translator agent's prompt, Hebrew → English,
 * with the model pinned (see ../llm.ts). `ollama` alone is the app's
 * default model; `ollama:<name>` is any other the app offers
 * (OLLAMA_CATALOG) or the registry lists for Ollama. Needs `ollama serve`
 * with the model pulled; the bench does not pull it.
 */
import { ollamaExecutor } from "../../agents/executors/ollama";
import { OLLAMA_CATALOG } from "../../ai/modelCatalog";
import { DEFAULT_OLLAMA_MODEL, isOllamaAvailable, listOllamaModels, setOllamaConfig } from "../../ai/ollamaProvider";
import { translateWith } from "../llm";
import type { BenchEngine, BenchFamily } from "../types";

/**
 * Ollama models the executor runs by name that OLLAMA_CATALOG does not
 * offer: Aya Expanse (non-commercial; modelCatalog.ts names its licence)
 * and the real-model CI's two (scripts/real-tiny-model.mjs).
 */
const ALSO = ["aya-expanse:8b", "qwen3:0.6b", "qwen3:1.7b"];

function variant(name: string): BenchEngine {
  return {
    id: `ollama:${name}`,
    label: `Ollama ${name}, translator prompt he → en`,
    set: "mt-he-en",
    models: [name],
    async load() {
      if (!(await isOllamaAvailable())) throw new Error("Ollama is not running on this machine (ollama serve)");
      if (!(await listOllamaModels()).some((m) => m.name === name)) throw new Error(`ollama pull ${name} first`);
      setOllamaConfig({ model: name });
      await translateWith(ollamaExecutor, name, "שלום");
      // The server picks its own device (Metal, CUDA or CPU); the page cannot tell which.
      return { device: "cpu", model: name };
    },
    run: async (item) => translateWith(ollamaExecutor, name, (item.input as { text: string }).text),
  };
}

export const family: BenchFamily = { variants: [...new Set([...OLLAMA_CATALOG.map((e) => e.name), ...ALSO])], variant };

export const engine: BenchEngine = { ...variant(DEFAULT_OLLAMA_MODEL), id: "ollama" };
