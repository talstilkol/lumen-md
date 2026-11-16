/**
 * Plan 5.5: every AI command goes through the agent runtime.
 *
 *   5.5.3  static check: 0 direct `chat()` / `chatStream()` calls (or their
 *          imports) outside the executors; no `executor.chat()` outside the
 *          runtime and its critic; no provider-level calls outside the
 *          executor layer.
 *   5.5.1  the commands that bypassed it run as agents, and each run is in
 *          the trace.
 *   5.5.2  the style profile applies to writer, templater and Rewrite.
 */
import { describe, it, expect, vi, beforeEach, onTestFinished } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => ({ aiKey: null, useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null }) } }));
vi.mock("../billing/aiQuota", () => ({ chargeAiCommandDispatch: vi.fn(), consumeAiPrompt: vi.fn(() => true), aiQuotaStatus: () => ({ allowed: true, limit: Infinity }), AiQuotaExceededError: class extends Error {} }));

import { registerExecutor, resetExecutors } from "../agents/executors";
import { runAgent, runLocalRequest } from "../agents/runtime";
import { clearTrace, listRuns, loadTrace } from "../agents/trace";
import {
  answererAgent,
  batchAgent,
  builderArchAgent,
  builderDocsAgent,
  builderTestAgent,
  cleanCompletion,
  completerAgent,
  memoSummarizerAgent,
  rewriterAgent,
  templaterAgent,
  writerAgent,
} from "../agents/defs";
import type { AgentDefinition, AgentInput } from "../agents/types";
import { fakeExecutor, sequence } from "./helpers/fakeExecutor";

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__") continue;
      out.push(...sources(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|eval)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Comments out of the way, so a doc comment that names chat() is not a call. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("static check (5.5.3)", () => {
  const files = sources(SRC).map((p) => ({ path: relative(SRC, p).replace(/\\/g, "/"), text: code(readFileSync(p, "utf8")) }));

  it("no module outside the executors imports chat() / chatStream() from ai/llm", () => {
    const offenders = files
      .filter((f) => !f.path.startsWith("agents/executors/") && f.path !== "ai/llm.ts")
      .filter((f) => /import\s*\{[^}]*\b(chat|chatStream)\b[^}]*\}\s*from\s*["'][./]*(ai\/)?llm["']/.test(f.text) || /\{[^}]*\b(chat|chatStream)\b[^}]*\}\s*=\s*await import\(["'][./]*(ai\/)?llm["']\)/.test(f.text) || /llm["']\)\)\.(chat|chatStream)\b/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("only the runtime (and its critic) call an executor's chat()", () => {
    const offenders = files.filter((f) => /\bexecutor\.chat\(/.test(f.text) && !["agents/runtime.ts", "agents/modelCritic.ts"].includes(f.path)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("provider-level calls stay in the executor layer", () => {
    const allowed = new Set(["ai/llm.ts", "ai/anthropicProvider.ts", "ai/ollamaProvider.ts", "ai/localLlm.ts"]);
    const offenders = files.filter((f) => !allowed.has(f.path) && !f.path.startsWith("agents/executors/") && /\b(chatAnthropic|chatAnthropicStream|chatOllama|chatOllamaStream|chatLocal|chatLocalStream)\(/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("a module's own local request goes through the runtime: traced, no tools, never the cloud", async () => {
    await clearTrace();
    const ex = fakeExecutor(() => ({ content: '{"ok":true}', toolCalls: [], model: "qwen3:4b" }));
    const res = await runLocalRequest(ex, { messages: [{ role: "user", content: "paragraph" }], temperature: 0, seed: 7, ...({ tools: [{ name: "write_file" }] } as object) }, { agentId: "entity-relations" });
    expect(res.content).toBe('{"ok":true}');
    expect(ex.calls[0].tools).toBeUndefined();
    expect(ex.calls[0].seed).toBe(7);
    await vi.waitFor(() => expect(listRuns()[0]).toMatchObject({ agentId: "entity-relations", executor: "ollama", model: "qwen3:4b", status: "ok" }));
    expect(JSON.stringify(listRuns()[0])).not.toContain("paragraph");
    const failing = fakeExecutor(() => {
      throw new Error("engine down");
    });
    await expect(runLocalRequest(failing, { messages: [] }, { agentId: "eval-here" })).rejects.toThrow("engine down");
    await vi.waitFor(() => expect(listRuns()[0]).toMatchObject({ agentId: "eval-here", status: "failed", errorCode: "error" }));
    const cloud = fakeExecutor(() => ({ content: "", toolCalls: [], model: "x" }), { id: "chat" });
    await expect(runLocalRequest(cloud, { messages: [] }, { agentId: "knesset-law-answer" })).rejects.toThrow(/local engine only/);
    expect(cloud.calls).toHaveLength(0);
  });

  it("no module outside the executor layer posts to a chat endpoint itself", () => {
    // A raw fetch to Ollama's /api/chat (or an OpenAI-style /v1/chat/completions)
    // is a model call the trace never sees, and one the executor's "local only"
    // check never refuses (5.5: the image describer and the screenshot note did this).
    const allowed = new Set(["ai/llm.ts", "ai/ollamaProvider.ts", "ai/mistralProvider.ts", "ai/batch.ts"]);
    const offenders = files
      .filter((f) => !allowed.has(f.path) && !f.path.startsWith("agents/executors/") && !f.path.startsWith("agents/eval/"))
      .filter((f) => /["'`][^"'`\n]*\/(api\/chat|v1\/chat\/completions)\b/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("no module outside the runtime calls an executor's chat({...}) itself, whatever the variable is named", () => {
    // `executor.chat(` alone missed `ex.chat({` (ai/structured, 5.5).
    const allowed = new Set(["agents/runtime.ts", "agents/modelCritic.ts"]);
    const offenders = files.filter((f) => !allowed.has(f.path) && !f.path.startsWith("agents/executors/") && !f.path.startsWith("agents/eval/") && /\.chat\(\s*\{/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("an image description, a screenshot note and a structured answer are runs in the trace", async () => {
    await clearTrace();
    const { ollamaExecutor } = await import("../agents/executors/ollama");
    const chat = vi.spyOn(ollamaExecutor, "chat").mockResolvedValue({ content: "  A cat on a mat.  ", toolCalls: [], model: "qwen2.5vl:7b" });
    onTestFinished(() => chat.mockRestore());
    const { describeImage } = await import("../ai/vision");
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    expect(await describeImage(blob, "en", "qwen2.5vl:7b")).toBe("A cat on a mat.");
    expect(chat.mock.calls[0][0]).toMatchObject({ model: "qwen2.5vl:7b", temperature: 0, messages: [{ role: "user", images: ["AQID"] }] });
    expect(chat.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    await vi.waitFor(() => expect(listRuns().find((r) => r.agentId === "image-describe")).toMatchObject({ executor: "ollama", status: "ok" }));

    const { appScreenshotDeps } = await import("../ai/screenshotNote");
    const deps = await appScreenshotDeps();
    expect(await deps.chat!("qwen2.5vl:7b", "to markdown", "AQID")).toBe("A cat on a mat.");
    expect(chat.mock.calls[1][0].messages[0].images).toEqual(["AQID"]);
    await vi.waitFor(() => expect(listRuns().find((r) => r.agentId === "screenshot-note")).toMatchObject({ executor: "ollama", status: "ok" }));

    const { executorEngine } = await import("../ai/structured");
    const ex = fakeExecutor(() => ({ content: '{"tags":["a"]}', toolCalls: [], model: "qwen3:4b" }), { supportsSchema: () => true });
    expect(await executorEngine("ollama", async () => ex).generate({ prompt: "tags?", schema: { type: "object" } } as never)).toBe('{"tags":["a"]}');
    expect(ex.calls[0].tools).toBeUndefined();
    await vi.waitFor(() => expect(listRuns().find((r) => r.agentId === "structured-output")).toMatchObject({ executor: "ollama", status: "ok" }));
  });

  it("the image describer obeys \"local only\": a remote Ollama gets no image", async () => {
    // Before 5.5 it posted to `${getBaseUrl()}/api/chat` itself, whatever the policy.
    const { setAiPolicy } = await import("../ai/policy");
    setAiPolicy("local-only");
    localStorage.setItem("lumen.ollama.baseUrl", "https://ollama.example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ model: "llava", message: { content: "a photo" }, done: true })));
    try {
      const { describeImage } = await import("../ai/vision");
      expect(await describeImage(new Blob([new Uint8Array([1])]), "en", "llava")).toBeNull();
      expect(fetchSpy.mock.calls.filter(([u]: unknown[]) => String(u).includes("/api/chat"))).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
      localStorage.removeItem("lumen.ollama.baseUrl");
      localStorage.removeItem("lumen.ai.policy");
    }
  });

  it("the check sees a direct call when there is one", () => {
    const sample = code('import { chat } from "../ai/llm";\nawait chat([]);');
    expect(/import\s*\{[^}]*\bchat\b[^}]*\}\s*from\s*["'][./]*(ai\/)?llm["']/.test(sample)).toBe(true);
    expect(code("// chat() in a comment").includes("chat(")).toBe(false);
  });
});

describe("the commands that bypassed the runtime run as agents (5.5.1)", () => {
  beforeEach(async () => {
    resetExecutors();
    await clearTrace();
    localStorage.clear();
  });

  const cases: Array<[string, AgentDefinition<AgentInput, unknown>, AgentInput, string]> = [
    ["ghost text", completerAgent as never, { text: "The quick brown", extra: { mode: "ghost" } }, "fox jumps"],
    ["inline suggestion", completerAgent as never, { text: "Dear Ma", extra: { mode: "inline" } }, "ria,"],
    ["AI Rewrite", rewriterAgent as never, { text: "hi there", extra: { instruction: "make it formal" } }, "Good day."],
    ["Ask Workspace", answererAgent as never, { text: "When is the launch?", extra: { context: "📄 [1] a.md\nTuesday", history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] } }, 'Tuesday [1] "Tuesday"'],
    ["voice memo", memoSummarizerAgent as never, { text: "We met and decided to ship on Tuesday." }, "- Met.\n- Ship Tuesday."],
    ["builder: architecture", builderArchAgent as never, { text: "spec", extra: { system: "Design." } }, "# Architecture"],
    ["builder: tests", builderTestAgent as never, { text: "file", extra: { system: "Test." } }, "test('x', () => {});"],
    ["builder: docs", builderDocsAgent as never, { text: "files", extra: { system: "Docs." } }, "# README"],
    ["batch step", batchAgent as never, { text: "note", extra: { system: "Summarise.", maxTokens: 300 } }, "A summary."],
  ];

  for (const [name, def, input, answer] of cases) {
    it(`${name}: runs through the runtime and is in the trace`, async () => {
      const ex = fakeExecutor(sequence(answer));
      registerExecutor(ex);
      const run = await runAgent(def, input, { executor: "ollama" });
      expect(run.status).toBe("ok");
      expect(ex.calls).toHaveLength(1);
      await loadTrace();
      expect(listRuns().some((r) => r.id === run.id && r.agentId === def.id)).toBe(true);
    });
  }

  it("the batch step uses the job's token budget and is not charged again", async () => {
    const ex = fakeExecutor(sequence("ok"));
    registerExecutor(ex);
    const { chargeAiCommandDispatch, consumeAiPrompt } = await import("../billing/aiQuota");
    vi.mocked(chargeAiCommandDispatch).mockClear();
    vi.mocked(consumeAiPrompt).mockClear();
    await runAgent(batchAgent, { text: "n", extra: { system: "s", maxTokens: 321 } }, { executor: "ollama", prepaid: true });
    expect(ex.calls[0].maxTokens).toBe(321);
    expect(chargeAiCommandDispatch).not.toHaveBeenCalled();
    expect(consumeAiPrompt).not.toHaveBeenCalled();
  });

  it("the history of Ask Workspace goes along; the completer keeps one short line", async () => {
    const ex = fakeExecutor(sequence("Tuesday"));
    registerExecutor(ex);
    await runAgent(answererAgent, { text: "And the budget?", extra: { context: "ctx", history: [{ role: "user", content: "When?" }, { role: "assistant", content: "Tuesday" }] } }, { executor: "ollama" });
    expect(ex.calls[0].messages[1].content).toContain("Q: When?\nA: Tuesday");
    expect(cleanCompletion('Completion: "The quick brown fox jumps"\nand more', "The quick brown")).toBe(" fox jumps");
  });
});

describe("the style profile applies to writer, templater and Rewrite (5.5.2)", () => {
  it("each system prompt carries the active profile", () => {
    localStorage.setItem("lumen.ai.styleProfile", JSON.stringify({ tone: "Terse", rules: ["Short sentences"], examples: [], notes: 2, builtAt: "x", sampleV: 2 }));
    localStorage.setItem("lumen.ai.styleProfile.active", "1");
    for (const def of [writerAgent, templaterAgent, rewriterAgent] as Array<AgentDefinition<AgentInput, unknown>>) {
      const sys = typeof def.system === "function" ? def.system({ text: "x", extra: { instruction: "y", templateId: "t" } }) : def.system;
      expect(sys, def.id).toContain("Short sentences");
    }
  });
});
