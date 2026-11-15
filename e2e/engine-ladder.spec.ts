/**
 * W11.I16 (run in W11.M7): the engine ladder in real browsers. Each project
 * probes what its browser really offers (WebGPU adapter, WebNN, WebAssembly,
 * deviceMemory, Chrome's Prompt API) on a page of the app, then the ladder
 * (src/agents/executors/ladder.ts) must pick the rung expected for that
 * browser with no native server running: Chromium → WebGPU when it has an
 * adapter, else WASM; Firefox (no WebGPU by default) → WASM; WebKit →
 * WebGPU when it has an adapter, else WASM.
 */
import { test, expect } from "@playwright/test";
import { engineLadder, type EngineCaps } from "../src/agents/executors/ladder";

const MODELS = { webgpuMB: 1400, webnnMB: 1400, wasmMB: 600 };

test("the ladder picks this browser's expected rung", async ({ page, browserName }) => {
  await page.goto("/");
  const probed = await page.evaluate(async () => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> }; ml?: unknown; deviceMemory?: number };
    let adapter = false;
    try {
      adapter = !!(await nav.gpu?.requestAdapter());
    } catch {
      adapter = false;
    }
    let promptApi = "unavailable";
    try {
      const lm = (globalThis as { LanguageModel?: { availability(): Promise<string> } }).LanguageModel;
      if (lm) promptApi = await lm.availability();
    } catch {
      promptApi = "unavailable";
    }
    return { adapter, webnn: !!nav.ml, wasm: typeof WebAssembly === "object", deviceMemoryMB: typeof nav.deviceMemory === "number" ? nav.deviceMemory * 1024 : null, promptApi };
  });
  const caps: EngineCaps = {
    userChoice: null,
    ollama: false,
    lmstudio: false,
    promptApi: (["available", "downloadable", "downloading"].includes(probed.promptApi) ? probed.promptApi : "unavailable") as EngineCaps["promptApi"],
    webgpu: probed.adapter,
    webgpuBudgetMB: 4500,
    webnn: probed.webnn,
    webnnFlag: false,
    wasm: probed.wasm,
    deviceMemoryMB: probed.deviceMemoryMB,
  };
  const agentTask = engineLadder(caps, { schema: false, tools: true, inputChars: 800 }, MODELS);
  const expected = probed.adapter ? "webgpu" : "wasm";
  test.info().annotations.push({ type: "ladder", description: JSON.stringify({ browserName, probed, pick: agentTask.pick, skipped: agentTask.skipped }) });
  expect(probed.wasm).toBe(true);
  if (browserName === "firefox") expect(probed.adapter, "Firefox ships without WebGPU by default").toBe(false);
  expect(agentTask.pick).toBe(expected);
  // A small schema task uses the Prompt API only where Chrome reports it ready.
  const extract = engineLadder(caps, { schema: true, tools: false, inputChars: 800 }, MODELS);
  expect(extract.pick).toBe(caps.promptApi === "available" ? "prompt-api" : expected);
});
