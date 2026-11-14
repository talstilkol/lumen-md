/**
 * W11.I17: LM Studio as an engine. The executor talks to a mock LM Studio
 * server (OpenAI-compatible /v1 and the native /api/v1/chat) whose answers
 * come from the same scripted eval answers the Ollama wiring run uses, for
 * one case of each of the 15 agents (plus the rest of the set as a sweep).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => ({ aiKey: null, useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null }) } }));
vi.mock("../billing/aiQuota", () => ({ chargeAiCommandDispatch: vi.fn(), consumeAiPrompt: vi.fn(() => true), aiQuotaStatus: () => ({ allowed: true, limit: Infinity }), AiQuotaExceededError: class extends Error {} }));
vi.mock("../storage/workspace", async (orig) => (await import("./helpers/evalVault")).workspaceModule(await orig()));
vi.mock("../sync/git", async (orig) => (await import("./helpers/evalVault")).gitModule(await orig()));
const air = vi.hoisted(() => ({ on: false }));
vi.mock("../privacy/airplane", async (orig) => ({ ...(await orig<Record<string, unknown>>()), airplaneModeOn: () => air.on }));

import { resetExecutors, DEFAULT_EXECUTOR_ORDER, pickExecutor } from "../agents/executors";
import { EVAL_CASES, type EvalCase } from "../agents/eval/fixtures";
import { runEvalCase } from "../agents/eval/run";
import { passed } from "../agents/eval/score";
import { scriptedAnswer } from "../agents/eval/scripted";
import { installEvalWeb } from "./helpers/evalWeb";
import { setAiPolicy } from "../ai/policy";
import { __resetLmStudioState, detectLmStudio, lmstudioExecutor, LMSTUDIO_KEY_KEY, LMSTUDIO_ON_KEY, LMSTUDIO_URL_KEY } from "../agents/executors/lmstudio";
import type { ExecutorRequest, ExecutorResponse, ToolCall } from "../agents/types";

interface Seen {
  path: string;
  auth: string | null;
  body: Record<string, unknown> | null;
}
let seen: Seen[];
let current: EvalCase | null;
let nativeStatus: number;

/** The OpenAI / native request turned back into what scriptedAnswer reads. */
function asExecutorRequest(path: string, body: Record<string, unknown>): ExecutorRequest {
  if (path === "/api/v1/chat") {
    return { messages: [{ role: "system", content: String(body.system_prompt ?? "") }, { role: "user", content: String(body.input ?? "") }] } as ExecutorRequest;
  }
  const messages = (body.messages as Array<{ role: string; content: string | null; tool_calls?: Array<{ id: string; function: { name: string } }>; tool_call_id?: string }>).map((m) => ({
    role: m.role as "system",
    content: m.content ?? "",
    ...(m.tool_calls ? { toolCalls: m.tool_calls.map((c) => ({ id: c.id, name: c.function.name, args: {} }) as ToolCall) } : {}),
  }));
  const tools = (body.tools as Array<{ function: { name: string } }> | undefined)?.map((t) => ({ name: t.function.name })) as ExecutorRequest["tools"];
  const schema = (body.response_format as { json_schema?: { schema?: unknown } } | undefined)?.json_schema?.schema as ExecutorRequest["schema"];
  return { messages, tools, schema } as ExecutorRequest;
}

function install(prior: typeof fetch) {
  seen = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.port !== "1234" && url.hostname !== "lms.example.com") return prior(input, init);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      const auth = new Headers(init?.headers).get("authorization");
      seen.push({ path: url.pathname, auth, body });
      if (localStorage.getItem(LMSTUDIO_KEY_KEY) === "wrong") return new Response("unauthorized", { status: 401 });
      if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "qwen3.5-9b" }, { id: "text-embedding-nomic" }] });
      const r: ExecutorResponse = scriptedAnswer(current!, asExecutorRequest(url.pathname, body!));
      if (url.pathname === "/api/v1/chat") {
        if (nativeStatus !== 200) return new Response("not found", { status: nativeStatus });
        return Response.json({ model_instance_id: "qwen3.5-9b", output: [{ type: "reasoning", content: "hidden" }, { type: "message", content: r.content }], stats: { input_tokens: 12, total_output_tokens: 7 } });
      }
      if (url.pathname === "/v1/chat/completions") {
        const tool_calls = r.toolCalls.length ? r.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) : undefined;
        return Response.json({ model: "qwen3.5-9b", choices: [{ message: { role: "assistant", content: tool_calls ? null : r.content, ...(tool_calls ? { tool_calls } : {}) } }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  __resetLmStudioState();
  resetExecutors();
  installEvalWeb();
  install(globalThis.fetch);
  setAiPolicy("local-first");
  air.on = false;
  nativeStatus = 200;
  current = null;
  localStorage.setItem(LMSTUDIO_ON_KEY, "1");
});
afterEach(() => vi.unstubAllGlobals());

const ONE_PER_AGENT = [...new Map(EVAL_CASES.map((c) => [c.agent, c])).values()];

describe("the same eval cases as Ollama, against a mock LM Studio", () => {
  it("covers one case of each of the 15 agents", () => expect(ONE_PER_AGENT).toHaveLength(15));

  for (const c of ONE_PER_AGENT) {
    it(`${c.id} (${c.agent}) passes through LM Studio`, async () => {
      current = c;
      const r = await runEvalCase(c, { executor: "lmstudio" });
      expect(r.error).toBeUndefined();
      expect(r.executor).toBe("lmstudio");
      expect(r.checks.filter((x) => !x.ok)).toEqual([]);
      expect(passed(r)).toBe(true);
    });
  }

  it("tools and schemas go to /v1/chat/completions; a plain turn to /api/v1/chat with reasoning off and nothing stored", async () => {
    for (const c of ONE_PER_AGENT.filter((x) => x.tool)) {
      current = c;
      await runEvalCase(c, { executor: "lmstudio" });
    }
    // A local executor with schema support gets every agent turn held to the protocol's JSON Schema (runtime 5.3.5), as Ollama does.
    const constrained = seen.filter((s) => s.path === "/v1/chat/completions" && (s.body?.response_format as { type?: string } | undefined)?.type === "json_schema");
    expect(constrained.length).toBeGreaterThan(0);
    expect(seen.filter((s) => s.path === "/api/v1/chat" && (s.body?.tools || s.body?.response_format))).toEqual([]);
    // Native tools, when a request carries them: OpenAI functions out, tool_calls back.
    current = ONE_PER_AGENT.find((c) => c.tool)!;
    const tool = { name: current.tool!.name, description: "d", parameters: { type: "object", properties: {} }, scope: "read" as const, run: async () => null };
    const r = await lmstudioExecutor.chat({ messages: [{ role: "user", content: "go" }], tools: [tool], model: "qwen3.5-9b" });
    expect((seen.at(-1)!.body!.tools as Array<{ type: string; function: { name: string } }>)[0]).toMatchObject({ type: "function", function: { name: current.tool!.name } });
    expect(r.toolCalls[0]).toMatchObject({ name: current.tool!.name });
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 5, estimated: false });
    current = ONE_PER_AGENT[0]!;
    await lmstudioExecutor.chat({ messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }], model: "qwen3.5-9b" });
    const native = seen.filter((s) => s.path === "/api/v1/chat").at(-1)!;
    expect(native.body).toMatchObject({ model: "qwen3.5-9b", system_prompt: "sys", input: "hi", store: false, reasoning: "off", stream: false });
  });

  it("falls back to /v1 when the server has no /api/v1/chat (before LM Studio 0.4)", async () => {
    nativeStatus = 404;
    current = ONE_PER_AGENT.find((c) => !c.tool) ?? ONE_PER_AGENT[0]!;
    const r = await lmstudioExecutor.chat({ messages: [{ role: "user", content: "hi" }], model: "m" });
    expect(typeof r.content).toBe("string");
    expect(seen.map((s) => s.path)).toEqual(["/api/v1/chat", "/v1/chat/completions"]);
  });
});

describe("detection, permission keys and policy", () => {
  it("not set up: unavailable without a request to port 1234; the default order lists it after Ollama", async () => {
    localStorage.removeItem(LMSTUDIO_ON_KEY);
    expect(await lmstudioExecutor.available()).toEqual({ available: false, reason: "not-configured" });
    expect(seen).toEqual([]);
    expect(DEFAULT_EXECUTOR_ORDER.slice(0, 2)).toEqual(["ollama", "lmstudio"]);
  });

  it("detect finds the server, lists its chat models and turns it on", async () => {
    localStorage.removeItem(LMSTUDIO_ON_KEY);
    expect(await detectLmStudio()).toMatchObject({ found: true });
    expect(localStorage.getItem(LMSTUDIO_ON_KEY)).toBe("1");
    expect(await lmstudioExecutor.available()).toEqual({ available: true });
    expect(lmstudioExecutor.modelFor("small")).toBe("qwen3.5-9b"); // the embedding model is not a chat model
  });

  it("sends the permission key as a Bearer token, and a refused key makes it unavailable", async () => {
    localStorage.setItem(LMSTUDIO_KEY_KEY, "sk-lm-123");
    await lmstudioExecutor.available();
    expect(seen[0]!.auth).toBe("Bearer sk-lm-123");
    localStorage.setItem(LMSTUDIO_KEY_KEY, "wrong");
    expect(await lmstudioExecutor.available()).toMatchObject({ available: false, reason: "unauthorized" });
  });

  it("airplane mode blocks LM Studio when it is not on this machine, and keeps a local one", async () => {
    air.on = true;
    localStorage.setItem(LMSTUDIO_URL_KEY, "http://lms.example.com:1234");
    expect(await lmstudioExecutor.available()).toMatchObject({ available: false, reason: "airplane" });
    await expect(lmstudioExecutor.chat({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/airplane/);
    expect(seen).toEqual([]);
    localStorage.setItem(LMSTUDIO_URL_KEY, "http://127.0.0.1:1234");
    expect(await lmstudioExecutor.available()).toEqual({ available: true });
  });

  it("local-only refuses a server outside this machine or LAN; the picker then skips it", async () => {
    setAiPolicy("local-only");
    localStorage.setItem(LMSTUDIO_URL_KEY, "http://lms.example.com:1234");
    expect(await lmstudioExecutor.available()).toMatchObject({ available: false, reason: "policy" });
    const pick = await pickExecutor(["lmstudio"]);
    expect(pick.executor).toBeNull();
    expect(pick.skipped[0]).toMatchObject({ id: "lmstudio", availability: { reason: "policy" } });
  });
});
