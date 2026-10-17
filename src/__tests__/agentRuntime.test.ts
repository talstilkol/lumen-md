import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentDefinition, Executor, ExecutorRequest, ExecutorResponse } from "../agents/types";
import { defineTool } from "../agents/tools/define";
import { jsonValidator } from "../agents/tools/validate";

vi.mock("../store/useStore", () => ({
  useAppStore: { getState: () => ({ aiKey: null, useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null }) },
}));
vi.mock("../store/useToastStore", () => ({ toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { runAgent, runAgentOrThrow, AgentRunError } from "../agents/runtime";
import { registerExecutor, resetExecutors } from "../agents/executors";
import { clearTrace, listRuns, loadTrace } from "../agents/trace";

type Script = (req: ExecutorRequest, n: number) => ExecutorResponse | Promise<ExecutorResponse>;

/** A scripted executor: the n-th call gets the n-th response. */
function fakeExecutor(script: Script, opts: Partial<Executor> = {}): Executor & { calls: ExecutorRequest[] } {
  const calls: ExecutorRequest[] = [];
  return {
    id: "ollama",
    label: "fake",
    calls,
    available: async () => ({ available: true }),
    supportsTools: () => false,
    supportsSchema: () => false,
    modelFor: (tier) => `fake-${tier}`,
    async chat(req) {
      calls.push(req);
      return script(req, calls.length);
    },
    ...opts,
  };
}

const reply = (content: string, model = "fake-small"): ExecutorResponse => ({ content, toolCalls: [], model, usage: { inputTokens: 10, outputTokens: 5, estimated: true } });

const echo = defineTool<{ text: string }, { upper: string }>({
  name: "upper",
  description: "upper-case text",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  run: async (a) => ({ upper: String(a.text).toUpperCase() }),
});
const writer = defineTool<{ path: string }, { ok: true }>({
  name: "write_something",
  description: "writes",
  parameters: { type: "object", properties: { path: { type: "string" } } },
  scope: "write",
  run: async () => ({ ok: true }),
});

const textAgent: AgentDefinition = { id: "t", description: "text", system: "sys", user: (i) => i.text ?? "" };

describe("agent runtime", () => {
  beforeEach(async () => {
    resetExecutors();
    await clearTrace();
  });
  afterEach(() => {
    resetExecutors();
  });

  it("returns the model's text for a plain text agent and records a trace", async () => {
    registerExecutor(fakeExecutor(() => reply("hello")));
    const run = await runAgent(textAgent, { text: "hi" });
    expect(run.status).toBe("ok");
    expect(run.output).toBe("hello");
    expect(run.executor).toBe("ollama");
    expect(run.model).toBe("fake-small");
    expect(run.attempts).toBe(1);
    expect(run.tokens).toEqual({ input: 10, output: 5, estimated: true });
    await loadTrace();
    expect(listRuns()[0]?.id).toBe(run.id);
  });

  it("retries a JSON agent with temperature 0 and the error fed back, then climbs a tier", async () => {
    const ex = fakeExecutor((_req, n) => (n < 3 ? reply("not json") : reply('{"tags":["a"]}')));
    registerExecutor(ex);
    const def: AgentDefinition<{ text: string }, { tags: string[] }> = {
      id: "tagger",
      description: "tags",
      system: "sys",
      user: (i) => i.text,
      outputSchema: { type: "object", properties: { tags: { type: "array" } }, required: ["tags"] },
      validators: [jsonValidator(["tags"])],
    };
    const run = await runAgent(def, { text: "doc" });
    expect(run.status).toBe("ok");
    expect(run.output).toEqual({ tags: ["a"] });
    expect(run.attempts).toBe(3);
    // 2nd call: temperature 0 + the rejection reason appended to the user turn.
    expect(ex.calls[1].temperature).toBe(0);
    expect(ex.calls[1].messages[1].content).toContain("rejected");
    expect(ex.calls[1].tier).toBe("small");
    // 3rd call climbs a tier.
    expect(ex.calls[2].tier).toBe("medium");
    // The system prompt tells a schema-less executor to answer with JSON.
    expect(ex.calls[0].messages[0].content).toContain("Reply with JSON only");
    expect(run.steps.filter((s) => s.kind === "retry")).toHaveLength(2);
  });

  it("fails with suggestions after the retries are exhausted", async () => {
    registerExecutor(fakeExecutor(() => reply("still not json")));
    const def: AgentDefinition<{ text: string }, unknown> = {
      id: "j",
      description: "json",
      system: "sys",
      user: (i) => i.text,
      outputSchema: { type: "object" },
    };
    const run = await runAgent(def, { text: "x".repeat(7000) });
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("parse");
    expect(run.attempts).toBe(3);
    const ids = run.suggestions.map((s) => s.id);
    expect(ids).toContain("larger-model");
    expect(ids).toContain("split-input");
    expect(ids).toContain("retry");
    await expect(runAgentOrThrow(def, { text: "y" })).rejects.toBeInstanceOf(AgentRunError);
  });

  it("drives tools through the JSON-ReAct protocol on an executor without native tools", async () => {
    const ex = fakeExecutor((req, n) => {
      if (n === 1) return reply('{"tool":"upper","args":{"text":"abc"}}');
      // The tool result arrived as a user turn.
      const last = req.messages[req.messages.length - 1];
      expect(last.role).toBe("tool");
      expect(last.content).toContain('"ABC"');
      return reply('{"final":"done: ABC"}');
    });
    registerExecutor(ex);
    const def: AgentDefinition = { id: "tooly", description: "", system: "sys", user: (i) => i.text ?? "", tools: [echo] };
    const run = await runAgent(def, { text: "go" });
    expect(run.status).toBe("ok");
    expect(run.output).toBe("done: ABC");
    expect(ex.calls[0].messages[0].content).toContain('"upper"');
    expect(ex.calls[0].tools).toBeUndefined();
    expect(run.steps.filter((s) => s.kind === "tool").map((s) => s.label)).toEqual(["upper"]);
  });

  it("uses native tool calls when the executor supports them", async () => {
    const ex = fakeExecutor(
      (req, n) => {
        if (n === 1) return { content: "", toolCalls: [{ id: "c1", name: "upper", args: { text: "q" } }], model: "m" };
        const last = req.messages[req.messages.length - 1];
        expect(last.toolCallId).toBe("c1");
        return reply("final text");
      },
      { supportsTools: () => true },
    );
    registerExecutor(ex);
    const def: AgentDefinition = { id: "native", description: "", system: "sys", user: () => "u", tools: [echo] };
    const run = await runAgent(def, {});
    expect(run.status).toBe("ok");
    expect(run.output).toBe("final text");
    expect(ex.calls[0].tools?.map((t) => t.name)).toEqual(["upper"]);
    expect(ex.calls[0].messages[0].content).not.toContain("To call a tool");
  });

  it("refuses a write tool the run was not granted, and tells the model", async () => {
    const ex = fakeExecutor((req, n) => {
      if (n === 1) return reply('{"tool":"write_something","args":{"path":"a.md"}}');
      const last = req.messages[req.messages.length - 1];
      expect(last.content).toContain("permission");
      return reply('{"final":"gave up"}');
    });
    registerExecutor(ex);
    const def: AgentDefinition = { id: "w", description: "", system: "sys", user: () => "u", tools: [writer] };
    const run = await runAgent(def, {});
    expect(run.status).toBe("ok");
    expect(run.steps.find((s) => s.kind === "tool")?.ok).toBe(false);
  });

  it("fails up front when the agent requires a grant the caller did not give", async () => {
    registerExecutor(fakeExecutor(() => reply("x")));
    const def: AgentDefinition = { id: "needs-write", description: "", system: "s", user: () => "u", requires: ["write"] };
    const run = await runAgent(def, {});
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("denied");
    expect((await runAgent(def, {}, { grants: ["write"] })).status).toBe("ok");
  });

  it("reports no executor with actionable suggestions", async () => {
    registerExecutor(fakeExecutor(() => reply("x"), { available: async () => ({ available: false, reason: "ollama-offline" }) }));
    const run = await runAgent(textAgent, { text: "hi" }, { executor: "ollama" });
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("no-executor");
    expect(run.suggestions.map((s) => s.id)).toContain("start-ollama");
  });

  it("stops with status aborted when the signal fires", async () => {
    const ctrl = new AbortController();
    registerExecutor(
      fakeExecutor(async (req) => {
        ctrl.abort();
        if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return reply("x");
      }),
    );
    const run = await runAgent(textAgent, { text: "hi" }, { signal: ctrl.signal });
    expect(run.status).toBe("aborted");
  });

  it("classifies an executor error and suggests the fix (Ollama 403 → OLLAMA_ORIGINS)", async () => {
    registerExecutor(
      fakeExecutor(async () => {
        throw new Error("Ollama API error 403: forbidden origin");
      }),
    );
    const run = await runAgent(textAgent, { text: "hi" });
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("error");
    expect(run.suggestions.map((s) => s.id)).toContain("ollama-origins");
  });

  it("streams deltas for a streaming text agent", async () => {
    registerExecutor(
      fakeExecutor(async (req) => {
        req.onDelta?.("he");
        req.onDelta?.("llo");
        return reply("hello");
      }),
    );
    const chunks: string[] = [];
    const run = await runAgent({ ...textAgent, streaming: true }, { text: "hi" }, { onDelta: (c) => chunks.push(c) });
    expect(run.output).toBe("hello");
    expect(chunks.join("")).toBe("hello");
  });

  it("gives up when the model never produces a final answer within maxSteps", async () => {
    registerExecutor(fakeExecutor(() => reply('{"tool":"upper","args":{"text":"a"}}')));
    const def: AgentDefinition = { id: "loop", description: "", system: "s", user: () => "u", tools: [echo], maxSteps: 3, maxRetries: 0 };
    const run = await runAgent(def, {});
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("empty");
    expect(run.steps.filter((s) => s.kind === "tool")).toHaveLength(3);
  });
});
