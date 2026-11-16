/**
 * The AI doctor's "engine ladder" check (W11.I16): which engines this
 * device can run, in the ladder's fixed order (executors/ladder.ts), and why
 * each rung was skipped. It probes the real browser — Prompt API, WebGPU,
 * WebNN, WebAssembly, the device's memory — and the two native servers
 * through their executors, so the answer is the one the runtime's order
 * (DEFAULT_EXECUTOR_ORDER) follows on this machine.
 *
 * Loaded only when the doctor runs (doctor.ts imports it on demand).
 */
import type { DoctorFinding } from "./doctor";
import { engineLadder, detectCapabilities, executorsFor, type EngineCaps, type RungModels } from "./executors/ladder";

export interface LadderDeps {
  /** Is each native server up (its executor's available())? */
  native: () => Promise<{ ollama: boolean; lmstudio: boolean }>;
  /** The engine chosen in AI settings, and whether it runs now. */
  userChoice: () => Promise<EngineCaps["userChoice"]>;
  /** VRAM budget and the in-browser models' sizes, MB. */
  hardware: () => Promise<{ webgpuBudgetMB: number; models: RungModels }>;
  /** The WebNN flag (off unless the user turned it on). */
  webnnFlag: () => boolean;
  /** detectCapabilities, replaceable in tests. */
  detect?: typeof detectCapabilities;
}

export const WEBNN_FLAG_KEY = "lumen.ai.webnn";

/** One finding: ok with the order when a rung can run, fail with every skip when none can. */
export async function ladderFinding(deps: LadderDeps): Promise<DoctorFinding> {
  const t0 = performance.now();
  const [native, userChoice, hw] = await Promise.all([deps.native(), deps.userChoice(), deps.hardware()]);
  const caps = await (deps.detect ?? detectCapabilities)({ ...native, userChoice, webgpuBudgetMB: hw.webgpuBudgetMB, webnnFlag: deps.webnnFlag() });
  // A general agent task: tools, no schema — the Prompt API rung is for small schema tasks only.
  const r = engineLadder(caps, { schema: false, tools: true, inputChars: 0 }, hw.models);
  const skips = r.skipped.map((s) => `${s.rung}: ${s.why}`).join(" · ");
  const execs = executorsFor(r, caps);
  return {
    id: "ladder",
    title: "ai.doctor.check.ladder",
    status: r.pick ? "ok" : "fail",
    detail: r.pick ? `${r.order.join(" → ")}${execs.length ? ` (${execs.join(", ")})` : ""}${skips ? ` · skipped ${skips}` : ""}` : skips,
    fix: r.pick ? undefined : { label: "ai.doctor.fix.install", command: "ollama serve" },
    ms: Math.round(performance.now() - t0),
  };
}

/** The app's deps: the registered executors, the AI settings' choice and the hardware probe. */
export async function appLadderDeps(): Promise<LadderDeps> {
  const executors = await import("./executors");
  const up = async (id: "ollama" | "lmstudio") => {
    try {
      return (await executors.getExecutor(id)?.available())?.available === true;
    } catch {
      return false;
    }
  };
  return {
    native: async () => ({ ollama: await up("ollama"), lmstudio: await up("lmstudio") }),
    userChoice: async () => {
      const id = executors.preferredExecutor();
      if (!id) return null;
      try {
        return { id, available: (await executors.getExecutor(id)?.available())?.available === true };
      } catch {
        return { id, available: false };
      }
    },
    hardware: async () => {
      const { detectHardware, vramBudgetMB, recommendWebLlmModel, catalogEntryFor } = await import("../ai/modelManager");
      const hw = await detectHardware();
      const entry = catalogEntryFor(recommendWebLlmModel("small", hw));
      const mb = entry ? (hw.f16 ? entry.vramMB.f16 : entry.vramMB.f32) : 0;
      // The WASM rung runs the same small model on the CPU (transformers.js): its size, unquantised to f32.
      return { webgpuBudgetMB: vramBudgetMB(hw), models: { webgpuMB: mb, webnnMB: mb, wasmMB: entry?.vramMB.f32 ?? mb } };
    },
    webnnFlag: () => {
      try {
        return localStorage.getItem(WEBNN_FLAG_KEY) === "1";
      } catch {
        return false;
      }
    },
  };
}
