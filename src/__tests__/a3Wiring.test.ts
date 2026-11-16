/**
 * Audit A3 (round 2), lane A34: the wiring added for modules that were built
 * and tested but unreachable. appReachable.test.ts proves each is reached
 * from index.html; this file checks what each new entry point does.
 *
 *  - W11.I16: the AI doctor's engine-ladder finding (fake capabilities).
 *  - W11.H8/H9: read-aloud's Chatterbox seam stays closed without a passing
 *    public CER verdict, whatever runtime is registered; the committed
 *    verdicts (none) keep it closed.
 *  - W11.I23: the ACP agents launch installed programs, never `npx -y`
 *    (the desktop bridge refuses it), and the palette entry is desktop only.
 *  - R12.10: ⌘K "Where my notes disagree" stages one report and writes nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ladderFinding, type LadderDeps } from "../agents/doctorLadder";
import type { EngineCaps } from "../agents/executors/ladder";
import { chatterboxForReadAloud, type ChatterboxRuntime } from "../ai/tts/chatterbox";
import { ACP_AGENTS } from "../agents/acp/agents";
import { buildExternalAgentCommands } from "../commands/domains/agents";
import { buildEntityCommands } from "../commands/domains/entities";
import type { CommandContext } from "../commands/domains/context";
import { clearStagedChanges, listStagedChanges } from "../agents/staging";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { listWorkspace, writeWorkspaceFile } from "../storage/workspace";

const models = { webgpuMB: 2_000, webnnMB: 2_000, wasmMB: 3_000 };
const caps = (over: Partial<EngineCaps>): EngineCaps => ({
  userChoice: null,
  ollama: false,
  lmstudio: false,
  promptApi: "unavailable",
  webgpu: false,
  webgpuBudgetMB: 0,
  webnn: false,
  webnnFlag: false,
  wasm: false,
  deviceMemoryMB: 8_192,
  ...over,
});
const deps = (c: EngineCaps): LadderDeps => ({
  native: async () => ({ ollama: c.ollama, lmstudio: c.lmstudio }),
  userChoice: async () => c.userChoice,
  hardware: async () => ({ webgpuBudgetMB: c.webgpuBudgetMB, models }),
  webnnFlag: () => c.webnnFlag,
  detect: async (o) => ({ ...c, ...o }),
});

describe("W11.I16 — the doctor's engine-ladder check", () => {
  it("names the order and the skipped rungs; Ollama first when it is up", async () => {
    const f = await ladderFinding(deps(caps({ ollama: true, webgpu: true, webgpuBudgetMB: 4_000, wasm: true })));
    expect(f).toMatchObject({ id: "ladder", title: "ai.doctor.check.ladder", status: "ok" });
    expect(f.detail).toMatch(/^ollama → webgpu → wasm \(ollama, webllm, transformers\)/);
    expect(f.detail).toContain("lmstudio: no LM Studio server");
    // A general agent task has tools: the Prompt API rung is never offered for it.
    expect(f.detail).toContain("prompt-api: Prompt API unavailable");
  });

  it("the memory guard drops a WebGPU model the device cannot hold", async () => {
    const f = await ladderFinding(deps(caps({ webgpu: true, webgpuBudgetMB: 4_000, wasm: true, deviceMemoryMB: 2_048 })));
    expect(f.detail).toContain("webgpu: model over the device's memory");
  });

  it("fails, with every reason, when nothing can run", async () => {
    const f = await ladderFinding(deps(caps({})));
    expect(f.status).toBe("fail");
    expect(f.detail).toContain("wasm: no WebAssembly");
    expect(f.fix?.command).toBe("ollama serve");
  });
});

describe("W11.H8/H9 — Chatterbox in read-aloud only after the public gate", () => {
  const runtime: ChatterboxRuntime = { synthesize: async () => ({ samples: new Float32Array(1), sampleRate: 24_000 }) };
  const has = async () => runtime;

  it("a closed gate hides it even with a runtime; an open gate without a runtime too", async () => {
    expect(await chatterboxForReadAloud(async () => false, has)).toBeNull();
    expect(await chatterboxForReadAloud(async () => true)).toBeNull(); // no runtime exists yet (W11.M)
    expect(await chatterboxForReadAloud(async () => true, has)).toBe(runtime);
  });

  it("the committed verdicts (no voice has passed) keep it hidden, whatever runtime there is", async () => {
    expect(await chatterboxForReadAloud(undefined, has)).toBeNull();
  });
});

describe("W11.I23 — external agents over ACP", () => {
  it("each agent is an installed program: no npx -y, which the desktop bridge refuses", () => {
    for (const a of ACP_AGENTS) {
      expect(["npx", "npx.cmd", "pnpx", "bunx"].includes(a.command) && a.args.some((x) => x === "-y" || x === "--yes")).toBe(false);
      expect(a.command).not.toMatch(/\s/);
    }
  });

  it("the palette entry is desktop only", () => {
    expect(buildExternalAgentCommands()).toEqual([]);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      expect(buildExternalAgentCommands().map((c) => c.id)).toEqual(["agents.acp"]);
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });
});

describe("R12.10 — ⌘K Where my notes disagree", () => {
  beforeEach(() => installFakeOpfs());
  afterEach(() => clearStagedChanges());

  it("stages one report note through the review queue and writes nothing", async () => {
    await writeWorkspaceFile("אנשים/דנה לוי.md", "# דנה לוי\n");
    await writeWorkspaceFile("a.md", "דנה לוי נולדה ב-1980 בחיפה.\n");
    await writeWorkspaceFile("b.md", "דנה לוי נולדה בשנת 1982.\n");
    const before = (await listWorkspace()).map((e) => e.path).sort();
    let opened = 0;
    const on = () => opened++;
    window.addEventListener("lumen-open-agent-review", on);
    const cmd = buildEntityCommands({ liveDoc: () => ({}) } as unknown as CommandContext).find((c) => c.id === "entities.contradictions")!;
    expect(cmd.label).toBe("Where my notes disagree");
    await cmd.action();
    await new Promise<void>((r) => {
      const tick = () => (listStagedChanges().length ? r() : setTimeout(tick, 10));
      tick();
    });
    window.removeEventListener("lumen-open-agent-review", on);
    const staged = listStagedChanges();
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({ kind: "file", status: "pending", agentId: "contradictor" });
    expect((staged[0] as { path: string }).path).toMatch(/^סתירות\/\d{4}-\d{2}-\d{2}\.md$/);
    expect((staged[0] as { after: string }).after).toContain("דנה לוי נולדה בשנת 1982");
    expect((await listWorkspace()).map((e) => e.path).sort()).toEqual(before);
    await new Promise((r) => setTimeout(r, 20));
    expect(opened).toBe(1);
  });
});
