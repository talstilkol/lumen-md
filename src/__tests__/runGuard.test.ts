/**
 * R12.18: the runaway guard (from talstilkol/tasker's guard.js, adapted) and
 * its place in the runtime's tool loop: five identical calls stop the run,
 * and the log keeps the prompt's hash and size, never its text.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import type { Executor, ExecutorRequest, ExecutorResponse } from "../agents/types";
import { defineTool } from "../agents/tools/define";

vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => ({ aiKey: null, useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null }) } }));
vi.mock("../ai/ollamaProvider", () => ({ isOllamaAvailable: async () => false, getBaseUrl: () => "http://localhost:11434", chatOllama: vi.fn(), chatOllamaStream: vi.fn() }));
vi.mock("../ai/localLlm", () => ({ localLlmAvailable: () => ({ available: false }), chatLocal: vi.fn(), chatLocalStream: vi.fn(), onLocalLlmProgress: () => () => {} }));
vi.mock("../store/useToastStore", () => ({ toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../billing/aiQuota", () => ({ chargeAiCommandDispatch: vi.fn(), consumeAiPrompt: vi.fn(() => true), aiQuotaStatus: () => ({ allowed: true, limit: Infinity }), AiQuotaExceededError: class extends Error {} }));

import { callKey, createRunGuard, normalizeError, stableHash, stops } from "../agents/runGuard";
import { runAgent } from "../agents/runtime";
import { registerExecutor, resetExecutors } from "../agents/executors";

afterEach(() => resetExecutors());

describe("runGuard (from tasker's guard.js)", () => {
  it("normalizeError gives one key to the same error with other numbers, paths and hex", () => {
    expect(normalizeError("TypeError at src/a.js:12 (0x1f) after 340ms")).toBe(normalizeError("TypeError at lib/b.js:7 (0xff) after 12ms"));
    expect(normalizeError("TypeError: x")).not.toBe(normalizeError("RangeError: x"));
    expect(stableHash("abc")).toMatch(/^[0-9a-f]{16}$/);
    expect(callKey("search", { q: "x", limit: 3 })).toBe(callKey("search", { limit: 3, q: "x" }));
    expect(callKey("search", { q: "x" })).not.toBe(callKey("search", { q: "y" }));
  });

  it("grades its response: notify → pause, a budget → block; a healthy run raises nothing", () => {
    const g = createRunGuard();
    expect(g.observe({ call: { name: "s", args: { q: 1 } } }).action).toBe("ok");
    expect(g.observe({ call: { name: "s", args: { q: 1 } } }).action).toBe("notify");
    const third = g.observe({ call: { name: "s", args: { q: 1 } } });
    expect(third.action).toBe("pause");
    expect(stops(third)).toBe(true);
    const e = createRunGuard();
    e.observe({ error: "ENOENT /a/1" });
    e.observe({ error: "ENOENT /b/2" });
    expect(e.observe({ error: "ENOENT /c/3" }).action).toBe("pause");
    expect(createRunGuard({ caps: { tokensPerRun: 500 } }).observe({ tokens: 600 }).action).toBe("block");
    const t = createRunGuard();
    t.observe({ call: { name: "s", args: {} }, tokens: 100 });
    expect(t.observe({ tokens: 250 }).action).toBe("require_approval");
    const ok = createRunGuard();
    for (let i = 0; i < 5; i++) ok.observe({ call: { name: "s", args: { q: i } }, tokens: 10 });
    expect(ok.worst()).toBe("ok");
  });

  it("the log has the prompt's hash and size, not its text", () => {
    const g = createRunGuard();
    g.observe({ call: { name: "s", args: {} } });
    g.observe({ call: { name: "s", args: {} } });
    const log = g.log("my secret question about the budget");
    expect(log.promptChars).toBe(35);
    expect(log.promptHash).toBe(stableHash("my secret question about the budget"));
    expect(JSON.stringify(log)).not.toContain("secret");
    expect(log.events.map((x) => x.action)).toEqual(["notify"]);
  });
});

describe("the runtime stops a runaway tool loop", () => {
  const runs: string[] = [];
  const search = defineTool<{ q: string }, { hits: number }>({
    name: "lookup",
    description: "look something up",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    run: async (a) => (runs.push(a.q), { hits: 0 }),
  });
  const loopy = (calls: ExecutorRequest[]): Executor => ({
    id: "ollama",
    label: "fake",
    available: async () => ({ available: true }),
    supportsTools: () => false,
    supportsSchema: () => false,
    modelFor: (tier) => `fake-${tier}`,
    async chat(req): Promise<ExecutorResponse> {
      calls.push(req);
      // A model stuck in a loop: the same call, five times and more.
      return { content: '{"tool":"lookup","args":{"q":"the same thing"}}', toolCalls: [], model: "fake-small", usage: { inputTokens: 10, outputTokens: 5, estimated: true } };
    },
  });

  it("a synthetic loop of 5 identical calls is stopped at the third, with a runaway error and no prompt text in the log", async () => {
    runs.length = 0;
    const calls: ExecutorRequest[] = [];
    registerExecutor(loopy(calls));
    const run = await runAgent({ id: "loopy", description: "", system: "You are careful.", user: (i) => i.text ?? "", tools: [search], maxSteps: 5, maxRetries: 0 }, { text: "where is my private note about Dana" });
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("runaway");
    expect(run.error).toMatch(/the same lookup call 3 times/);
    expect(runs).toHaveLength(3);
    expect(run.steps.filter((s) => s.label === "runaway").map((s) => s.detail)).toEqual(["notify: the same lookup call again", "pause: the same lookup call 3 times"]);
    expect(run.guard?.promptChars).toBeGreaterThan(0);
    expect(run.guard?.promptHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(run.guard)).not.toContain("private note");
  });
});
