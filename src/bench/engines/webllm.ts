/**
 * web-llm (WebGPU) through the app's own path (plan 7.8, W10.E34): the
 * translator agent on the runtime, forced onto the `webllm` executor, on
 * the Hebrew → English set. The model is pinned to Qwen3 0.6B (the
 * multilingual tiny tier) so the numbers belong to one registry entry.
 */
import { runAgentOrThrow } from "../../agents/runtime";
import { translatorAgent } from "../../agents/defs";
import { catalogEntryFor, detectHardware, setWebLlmModel, webLlmModelId, WEBLLM_CATALOG } from "../../ai/modelManager";
import { localLlmAvailable } from "../../ai/localLlm";
import type { BenchEngine } from "../types";

const MODEL = "Qwen3-0.6B";

/** A stuck model fails its item instead of hanging the whole bench (T55: every run carries a cancel signal). */
const ITEM_TIMEOUT_MS = 120_000;

async function translate(text: string): Promise<string> {
  const signal = AbortSignal.timeout(ITEM_TIMEOUT_MS);
  return runAgentOrThrow(translatorAgent, { text, extra: { targetLanguage: "English" } }, { executor: "webllm", signal });
}

export const engine: BenchEngine = {
  id: "webllm",
  label: "web-llm Qwen3 0.6B, translator agent he → en",
  set: "mt-he-en",
  models: [MODEL],
  async load() {
    const status = localLlmAvailable();
    if (!status.available) throw new Error(`web-llm unavailable: ${status.reason}`);
    const entry = WEBLLM_CATALOG.find((e) => e.base === MODEL)!;
    const hw = await detectHardware();
    const id = webLlmModelId(entry, hw.f16);
    if (!catalogEntryFor(id)) throw new Error(`not in the web-llm catalog: ${id}`);
    setWebLlmModel(id);
    await translate("שלום");
    return { device: "webgpu", model: MODEL };
  },
  run: async (item) => translate((item.input as { text: string }).text),
  dispose: async () => setWebLlmModel(null),
};
