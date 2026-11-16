/**
 * Ollama (a local server on this machine) through the app's own path (plan
 * 7.8, W10.E34): the translator agent forced onto the `ollama` executor,
 * Hebrew → English, with the app's default model (qwen2.5:7b). Needs
 * `ollama serve` with the model pulled; the bench does not pull it.
 */
import { runAgentOrThrow } from "../../agents/runtime";
import { translatorAgent } from "../../agents/defs";
import { DEFAULT_OLLAMA_MODEL, isOllamaAvailable, listOllamaModels, setOllamaConfig } from "../../ai/ollamaProvider";
import type { BenchEngine } from "../types";

/** A stuck model fails its item instead of hanging the whole bench (T55: every run carries a cancel signal). */
const ITEM_TIMEOUT_MS = 120_000;

async function translate(text: string): Promise<string> {
  const signal = AbortSignal.timeout(ITEM_TIMEOUT_MS);
  return runAgentOrThrow(translatorAgent, { text, extra: { targetLanguage: "English" } }, { executor: "ollama", signal });
}

export const engine: BenchEngine = {
  id: "ollama",
  label: `Ollama ${DEFAULT_OLLAMA_MODEL}, translator agent he → en`,
  set: "mt-he-en",
  models: [DEFAULT_OLLAMA_MODEL],
  async load() {
    if (!(await isOllamaAvailable())) throw new Error("Ollama is not running on this machine (ollama serve)");
    if (!(await listOllamaModels()).some((m) => m.name === DEFAULT_OLLAMA_MODEL)) throw new Error(`ollama pull ${DEFAULT_OLLAMA_MODEL} first`);
    setOllamaConfig({ model: DEFAULT_OLLAMA_MODEL });
    await translate("שלום");
    // The server picks its own device (Metal, CUDA or CPU); the page cannot tell which.
    return { device: "cpu", model: DEFAULT_OLLAMA_MODEL };
  },
  run: async (item) => translate((item.input as { text: string }).text),
};
