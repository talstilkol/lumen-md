/**
 * W11.I16: the engine ladder picks the expected rung in every combination of
 * capabilities (an exhaustive sweep over 2·2·2·4·2·2·2·2·2·3 device states ×
 * 4 task shapes), plus the named cases the spec checks in real browsers (W11.M7).
 */
import { describe, it, expect } from "vitest";
import { engineLadder, executorsFor, MEMORY_HEADROOM, PROMPT_API_MAX_CHARS, type EngineCaps, type Rung, type TaskShape } from "../agents/executors/ladder";

const MODELS = { webgpuMB: 1400, webnnMB: 1400, wasmMB: 600 };
const NONE: EngineCaps = { userChoice: null, ollama: false, lmstudio: false, promptApi: "unavailable", webgpu: false, webgpuBudgetMB: 0, webnn: false, webnnFlag: false, wasm: false, deviceMemoryMB: null };
const EXTRACT: TaskShape = { schema: true, tools: false, inputChars: 800 };
const AGENT: TaskShape = { schema: false, tools: true, inputChars: 800 };

describe("named cases", () => {
  it("Chromium with WebGPU and nothing native: WebGPU; with the Prompt API, a small schema task goes there first", () => {
    const chromium: EngineCaps = { ...NONE, webgpu: true, webgpuBudgetMB: 4000, wasm: true, deviceMemoryMB: 8192, promptApi: "available" };
    expect(engineLadder(chromium, AGENT, MODELS).pick).toBe("webgpu");
    expect(engineLadder(chromium, EXTRACT, MODELS).pick).toBe("prompt-api");
    expect(engineLadder(chromium, { ...EXTRACT, inputChars: PROMPT_API_MAX_CHARS + 1 }, MODELS).pick).toBe("webgpu");
  });

  it("Firefox without WebGPU: WASM; WebKit with WebGPU: WebGPU", () => {
    expect(engineLadder({ ...NONE, wasm: true, deviceMemoryMB: null }, AGENT, MODELS).pick).toBe("wasm");
    expect(engineLadder({ ...NONE, webgpu: true, webgpuBudgetMB: 4500, wasm: true }, AGENT, MODELS).pick).toBe("webgpu");
  });

  it("the user's choice first; then Ollama, then LM Studio", () => {
    const all: EngineCaps = { ...NONE, ollama: true, lmstudio: true, webgpu: true, webgpuBudgetMB: 4000, wasm: true };
    expect(engineLadder(all, AGENT, MODELS).order).toEqual(["ollama", "lmstudio", "webgpu", "wasm"]);
    expect(engineLadder({ ...all, userChoice: { id: "webllm", available: true } }, AGENT, MODELS).order[0]).toBe("user");
    expect(engineLadder({ ...all, ollama: false }, AGENT, MODELS).pick).toBe("lmstudio");
    expect(executorsFor(engineLadder({ ...all, userChoice: { id: "webllm", available: true } }, AGENT, MODELS), { ...all, userChoice: { id: "webllm", available: true } })).toEqual(["webllm", "ollama", "lmstudio", "transformers"]);
  });

  it("memory guard: a 2 GB device skips a 1.4 GB WebGPU model and a 600 MB WASM one still runs", () => {
    const small: EngineCaps = { ...NONE, webgpu: true, webgpuBudgetMB: 2000, wasm: true, deviceMemoryMB: 1536 };
    const r = engineLadder(small, AGENT, MODELS);
    expect(r.pick).toBe("wasm");
    expect(r.skipped.find((s) => s.rung === "webgpu")?.why).toMatch(/memory/);
  });

  it("WebNN only behind its flag", () => {
    const nn: EngineCaps = { ...NONE, webnn: true, wasm: true };
    expect(engineLadder(nn, AGENT, MODELS).order).toEqual(["wasm"]);
    expect(engineLadder({ ...nn, webnnFlag: true }, AGENT, MODELS).order).toEqual(["webnn", "wasm"]);
  });

  it("nothing at all: no pick, every rung says why", () => {
    const r = engineLadder(NONE, AGENT, MODELS);
    expect(r.pick).toBeNull();
    expect(r.skipped.map((s) => s.rung)).toEqual(["ollama", "lmstudio", "prompt-api", "webgpu", "webnn", "wasm"]);
  });
});

/** The ladder's rules, written out a second way: the first rung, in the fixed order, that may run. */
function expected(c: EngineCaps, t: TaskShape): Rung | null {
  const fits = (mb: number) => c.deviceMemoryMB === null || mb * MEMORY_HEADROOM <= c.deviceMemoryMB;
  if (c.userChoice?.available) return "user";
  if (c.ollama) return "ollama";
  if (c.lmstudio) return "lmstudio";
  if (c.promptApi === "available" && t.schema && !t.tools && t.inputChars <= PROMPT_API_MAX_CHARS) return "prompt-api";
  if (c.webgpu && MODELS.webgpuMB <= c.webgpuBudgetMB && fits(MODELS.webgpuMB)) return "webgpu";
  if (c.webnnFlag && c.webnn && fits(MODELS.webnnMB)) return "webnn";
  if (c.wasm && fits(MODELS.wasmMB)) return "wasm";
  return null;
}

describe("every combination of capabilities", () => {
  it("picks the expected rung, never runs an in-browser model above memory, never uses WebNN unflagged or the Prompt API for tools", () => {
    const B = [false, true];
    const tasks: TaskShape[] = [EXTRACT, AGENT, { schema: false, tools: false, inputChars: 100 }, { schema: true, tools: false, inputChars: 9000 }];
    let n = 0;
    for (const user of [null, { id: "ollama" as const, available: false }, { id: "webllm" as const, available: true }])
      for (const ollama of B)
        for (const lmstudio of B)
          for (const promptApi of ["available", "downloadable", "downloading", "unavailable"] as const)
            for (const webgpu of B)
              for (const budget of [1000, 4000])
                for (const webnn of B)
                  for (const webnnFlag of B)
                    for (const wasm of B)
                      for (const mem of [null, 1024, 8192])
                        for (const t of tasks) {
                          const caps: EngineCaps = { userChoice: user, ollama, lmstudio, promptApi, webgpu, webgpuBudgetMB: budget, webnn, webnnFlag, wasm, deviceMemoryMB: mem };
                          const r = engineLadder(caps, t, MODELS);
                          n++;
                          expect(r.pick, JSON.stringify({ caps, t })).toBe(expected(caps, t));
                          if (r.order.includes("prompt-api")) expect(t.tools || !t.schema).toBe(false);
                          if (r.order.includes("webnn")) expect(webnnFlag).toBe(true);
                          for (const rung of ["webgpu", "webnn", "wasm"] as const) if (r.order.includes(rung) && mem !== null) expect(MODELS[`${rung}MB`] * MEMORY_HEADROOM).toBeLessThanOrEqual(mem);
                          expect(r.order.length + r.skipped.length).toBe(6 + (user ? 1 : 0));
                        }
    expect(n).toBe(3 * 2 * 2 * 4 * 2 * 2 * 2 * 2 * 2 * 3 * 4);
  });
});
