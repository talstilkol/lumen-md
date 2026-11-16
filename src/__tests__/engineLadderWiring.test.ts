/**
 * W11.I16: the engine ladder is on the runtime's path, not only in the AI
 * doctor. The WebGPU executor applies its memory guard (a model that does not
 * fit the VRAM budget or the device's memory is skipped, so pickExecutor moves
 * on to the next rung), and structured output puts the Prompt API rung before
 * WebGPU for a schema task whose input fits its short context.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hardware } from "../ai/modelManager";

let hardware: Hardware = { webgpu: true, f16: true, maxBufferMB: 2048, deviceMemoryGB: 8, cores: 8, mobile: false };
vi.mock("../ai/webllmEngine", () => ({ webLlmChat: vi.fn() }));
vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => ({ useLocalAi: true, aiKey: null, useFineTunedModel: false, fineTunedModelId: null }) } }));
vi.mock("../store/useToastStore", () => ({ toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../ai/modelManager", async (orig) => {
  const real = await orig<typeof import("../ai/modelManager")>();
  return { ...real, detectHardware: async () => hardware };
});

import { webllmExecutor, webgpuGuard } from "../agents/executors/webllm";
import { pickExecutor, registerExecutor, resetExecutors } from "../agents/executors";
import { setWebLlmModel } from "../ai/modelManager";
import { engineOrder, generateStructured, type StructuredEngine } from "../ai/structured";
import { PROMPT_API_MAX_CHARS } from "../agents/executors/ladder";
import { fakeExecutor, sequence } from "./helpers/fakeExecutor";

beforeEach(() => {
  resetExecutors();
  setWebLlmModel(null);
  localStorage.setItem("lumen.ai.policy", "local-only");
  hardware = { webgpu: true, f16: true, maxBufferMB: 2048, deviceMemoryGB: 8, cores: 8, mobile: false };
});

describe("the WebGPU rung's memory guard (W11.I16)", () => {
  it("a device whose memory cannot hold even the smallest model skips WebGPU, and pickExecutor goes on to the next rung", async () => {
    // deviceMemory 0.5 GB: every catalogue model × 1.25 is over 512 MB.
    hardware = { ...hardware, deviceMemoryGB: 0.5 };
    const a = await webllmExecutor.available();
    expect(a).toMatchObject({ available: false, reason: "memory" });
    expect(a.detail).toMatch(/memory/);
    registerExecutor(fakeExecutor(sequence("ok"), { id: "chat" }));
    const pick = await pickExecutor(["webllm", "chat"]);
    expect(pick.executor?.id).toBe("chat");
    expect(pick.skipped).toEqual([{ id: "webllm", availability: expect.objectContaining({ reason: "memory" }) }]);
  });

  it("a chosen model over the VRAM budget is skipped with the ladder's reason; one that fits runs", async () => {
    // 8 GB: a 6,500 MB budget. Gemma 2 9B at f32 is 8,383 MB.
    hardware = { ...hardware, f16: false };
    expect(webgpuGuard(hardware, "gemma-2-9b-it-q4f32_1-MLC")).toMatch(/over the VRAM budget 6500 MB/);
    expect(webgpuGuard(hardware, "Qwen3-4B-q4f32_1-MLC")).toBeNull();
    setWebLlmModel("gemma-2-9b-it-q4f32_1-MLC");
    expect(await webllmExecutor.available()).toMatchObject({ available: false, reason: "memory" });
    setWebLlmModel("Qwen3-4B-q4f32_1-MLC");
    expect(await webllmExecutor.available()).toEqual({ available: true });
  });

  it("an ordinary device keeps WebGPU; a browser that does not report its memory is not guessed at", async () => {
    expect(await webllmExecutor.available()).toEqual({ available: true });
    hardware = { ...hardware, deviceMemoryGB: null };
    expect(await webllmExecutor.available()).toEqual({ available: true });
    // A model outside the catalogue has no known size: nothing to guard.
    expect(webgpuGuard(hardware, "my-own-model-MLC")).toBeNull();
  });
});

describe("structured output follows the ladder's Prompt API rung (W11.I16)", () => {
  const fake = (id: StructuredEngine["id"], ok: boolean, used: string[]): StructuredEngine => ({
    id,
    onDevice: id !== "ollama",
    available: async () => ok,
    generate: async () => {
      used.push(id);
      return '{"tag":"x"}';
    },
  });

  it("a general schema task: native first, then the Prompt API when the input fits, else WebGPU before it", () => {
    const all = [fake("builtin", true, []), fake("ollama", true, []), fake("webllm", true, [])];
    expect(engineOrder(all, "general", 800).map((e) => e.id)).toEqual(["ollama", "builtin", "webllm"]);
    expect(engineOrder(all, "general", PROMPT_API_MAX_CHARS + 1).map((e) => e.id)).toEqual(["ollama", "webllm", "builtin"]);
    expect(engineOrder(all, "general").map((e) => e.id)).toEqual(["ollama", "webllm", "builtin"]);
  });

  it("generateStructured measures the input: no Ollama, a short prompt goes to the built-in model before web-llm", async () => {
    const schema = { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] } as const;
    const used: string[] = [];
    const engines = [fake("builtin", true, used), fake("ollama", false, used), fake("webllm", true, used)];
    const short = await generateStructured({ prompt: "tag this", schema }, { engines, builtinAllowed: () => true });
    expect(short.engine).toBe("builtin");
    const long = await generateStructured({ prompt: "x".repeat(PROMPT_API_MAX_CHARS + 10), schema }, { engines, builtinAllowed: () => true });
    expect(long.engine).toBe("webllm");
    expect(used).toEqual(["builtin", "webllm"]);
  });
});

describe("the ladder is imported on the runtime's path (W11.I16)", () => {
  it("the WebGPU executor and structured output import executors/ladder", () => {
    const src = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");
    expect(src("agents/executors/webllm.ts")).toMatch(/from "\.\/ladder"/);
    expect(src("ai/structured/index.ts")).toMatch(/from "\.\.\/\.\.\/agents\/executors\/ladder"/);
  });
});
