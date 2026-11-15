/**
 * web-llm (WebGPU) through the app's own executor (plan 7.8, W10.E34): the
 * translator agent's prompt, Hebrew → English, with the model pinned (see
 * ../llm.ts for why the agent loop is not used). One variant per web-llm
 * model the app offers: its catalogue (WEBLLM_CATALOG) and the
 * function-calling models (WEBLLM_TOOL_MODELS). `webllm` alone is Qwen3
 * 0.6B, the multilingual tiny tier; `webllm:<base>` is any other.
 */
import { webllmExecutor, WEBLLM_TOOL_MODELS } from "../../agents/executors/webllm";
import { detectHardware, setWebLlmModel, webLlmModelId, WEBLLM_CATALOG } from "../../ai/modelManager";
import { translateWith } from "../llm";
import type { BenchEngine, BenchFamily } from "../types";

const toolBase = (id: string) => id.replace(/-q4f(16|32)_1-MLC$/, "");

/** The web-llm id the app would download for `base` on this device. */
async function modelIdFor(base: string): Promise<string> {
  const { f16 } = await detectHardware();
  const entry = WEBLLM_CATALOG.find((e) => e.base === base);
  if (entry) return webLlmModelId(entry, f16);
  const tools = WEBLLM_TOOL_MODELS.filter((m) => toolBase(m) === base);
  const id = tools.find((m) => m.includes(f16 ? "q4f16" : "q4f32"));
  if (!id) throw new Error(`${base}: web-llm has no ${f16 ? "f16" : "f32"} build of it (have: ${tools.join(", ")})`);
  return id;
}

function variant(base: string): BenchEngine {
  let mlcId = "";
  return {
    id: `webllm:${base}`,
    label: `web-llm ${base}, translator prompt he → en`,
    set: "mt-he-en",
    models: [base],
    async load() {
      mlcId = await modelIdFor(base);
      // The user's own choice in the AI settings: what makes the executor available under local-first.
      setWebLlmModel(mlcId);
      const status = await webllmExecutor.available();
      if (!status.available) throw new Error(`web-llm unavailable: ${status.reason}${status.detail ? ` (${status.detail})` : ""}`);
      await translateWith(webllmExecutor, mlcId, "שלום");
      return { device: "webgpu", model: base };
    },
    run: async (item) => translateWith(webllmExecutor, mlcId, (item.input as { text: string }).text),
    dispose: async () => setWebLlmModel(null),
  };
}

export const family: BenchFamily = {
  variants: [...new Set([...WEBLLM_CATALOG.map((e) => e.base), ...WEBLLM_TOOL_MODELS.map(toolBase)])],
  variant,
};

export const engine: BenchEngine = { ...variant("Qwen3-0.6B"), id: "webllm" };
