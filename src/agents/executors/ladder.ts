/**
 * The engine ladder for real browsers (W11.I16): one fixed order, decided
 * from what the device can do, the same every time.
 *
 *   1. the user's choice (AI settings), when it can run;
 *   2. a native server on this machine or LAN: Ollama, then LM Studio;
 *   3. Chrome's built-in Prompt API (Gemini Nano), only for a small task
 *      with a JSON schema and no tools — it is a small model with a short
 *      context, good at constrained extraction, not at agent loops;
 *   4. WebGPU (web-llm);
 *   5. WebNN, only behind its flag (an origin-trial API that changes);
 *   6. WASM (CPU), the slowest rung that still runs everywhere.
 *
 * Memory guard: an in-browser rung is skipped when its model, with a
 * quarter more for the context and the runtime, does not fit in the
 * device's memory (navigator.deviceMemory, which browsers cap at 8 GB) or,
 * for WebGPU, in the VRAM budget. A native server holds its model in its
 * own process, so the guard does not apply to it.
 *
 * Pure: the capabilities come in (detectCapabilities probes them), the
 * order comes out, with why each rung was skipped.
 */
import type { ExecutorId } from "../types";

export type Rung = "user" | "ollama" | "lmstudio" | "prompt-api" | "webgpu" | "webnn" | "wasm";

export interface EngineCaps {
  /** The engine the user chose in AI settings, and whether it can run now. */
  userChoice: { id: ExecutorId; available: boolean } | null;
  ollama: boolean;
  lmstudio: boolean;
  /** `LanguageModel.availability()`: only "available" runs without a download first. */
  promptApi: "available" | "downloadable" | "downloading" | "unavailable";
  webgpu: boolean;
  /** VRAM budget for a WebGPU model, MB (modelManager.vramBudgetMB). */
  webgpuBudgetMB: number;
  webnn: boolean;
  /** The WebNN flag (settings, off by default). */
  webnnFlag: boolean;
  wasm: boolean;
  /** navigator.deviceMemory in MB, or null when the browser does not say. */
  deviceMemoryMB: number | null;
}

export interface TaskShape {
  schema: boolean;
  tools: boolean;
  /** Characters of input (prompt + document). */
  inputChars: number;
}

/** The model each in-browser rung would load, MB. */
export interface RungModels {
  webgpuMB: number;
  webnnMB: number;
  wasmMB: number;
}

/** Inputs the Prompt API takes on: about 1K tokens (Gemini Nano's context is small). */
export const PROMPT_API_MAX_CHARS = 4_000;
/** Model + context + runtime: the model's size times this must fit in memory. */
export const MEMORY_HEADROOM = 1.25;

export interface LadderResult {
  /** The rungs that can run, in order; the first is the pick. */
  order: Rung[];
  pick: Rung | null;
  skipped: Array<{ rung: Rung; why: string }>;
}

const fitsMemory = (modelMB: number, caps: EngineCaps) => caps.deviceMemoryMB === null || modelMB * MEMORY_HEADROOM <= caps.deviceMemoryMB;

export function engineLadder(caps: EngineCaps, task: TaskShape, models: RungModels): LadderResult {
  const order: Rung[] = [];
  const skipped: LadderResult["skipped"] = [];
  const consider = (rung: Rung, ok: boolean, why: string) => (ok ? order.push(rung) : skipped.push({ rung, why }));

  if (caps.userChoice) consider("user", caps.userChoice.available, `${caps.userChoice.id} is not available`);
  consider("ollama", caps.ollama, "no Ollama server");
  consider("lmstudio", caps.lmstudio, "no LM Studio server");

  if (caps.promptApi !== "available") skipped.push({ rung: "prompt-api", why: `Prompt API ${caps.promptApi}` });
  else if (!task.schema || task.tools) skipped.push({ rung: "prompt-api", why: "only for a task with a JSON schema and no tools" });
  else consider("prompt-api", task.inputChars <= PROMPT_API_MAX_CHARS, `input over ${PROMPT_API_MAX_CHARS} characters`);

  if (!caps.webgpu) skipped.push({ rung: "webgpu", why: "no WebGPU" });
  else if (models.webgpuMB > caps.webgpuBudgetMB) skipped.push({ rung: "webgpu", why: `model ${models.webgpuMB} MB over the VRAM budget ${caps.webgpuBudgetMB} MB` });
  else consider("webgpu", fitsMemory(models.webgpuMB, caps), "model over the device's memory");

  if (!caps.webnnFlag) skipped.push({ rung: "webnn", why: "WebNN flag off" });
  else if (!caps.webnn) skipped.push({ rung: "webnn", why: "no WebNN" });
  else consider("webnn", fitsMemory(models.webnnMB, caps), "model over the device's memory");

  if (!caps.wasm) skipped.push({ rung: "wasm", why: "no WebAssembly" });
  else consider("wasm", fitsMemory(models.wasmMB, caps), "model over the device's memory");

  return { order, pick: order[0] ?? null, skipped };
}

/** The executors for a ladder order (the user's rung is their executor). Rungs without an executor yet are dropped. */
export function executorsFor(result: LadderResult, caps: EngineCaps): ExecutorId[] {
  const map: Partial<Record<Rung, ExecutorId>> = { ollama: "ollama", lmstudio: "lmstudio", webgpu: "webllm", wasm: "transformers" };
  const out: ExecutorId[] = [];
  for (const r of result.order) {
    const id = r === "user" ? caps.userChoice?.id : map[r];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

type Nav = { gpu?: unknown; ml?: unknown; deviceMemory?: number };

/** Probe what this browser offers (never throws). Native servers come from their executors. */
export async function detectCapabilities(opts: { ollama: boolean; lmstudio: boolean; userChoice: EngineCaps["userChoice"]; webgpuBudgetMB: number; webnnFlag: boolean }): Promise<EngineCaps> {
  const nav = (typeof navigator !== "undefined" ? navigator : {}) as Nav;
  let promptApi: EngineCaps["promptApi"] = "unavailable";
  try {
    const lm = (globalThis as { LanguageModel?: { availability?: () => Promise<string> } }).LanguageModel;
    const a = lm?.availability ? await lm.availability() : "unavailable";
    promptApi = a === "available" || a === "downloadable" || a === "downloading" ? a : "unavailable";
  } catch {
    promptApi = "unavailable";
  }
  return {
    ...opts,
    promptApi,
    webgpu: !!nav.gpu,
    webnn: !!nav.ml,
    wasm: typeof WebAssembly === "object",
    deviceMemoryMB: typeof nav.deviceMemory === "number" ? nav.deviceMemory * 1024 : null,
  };
}
