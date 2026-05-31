/**
 * Tests for the Claude (Anthropic) and Gemini providers: pure body-shaping
 * helpers, and end-to-end routing through llm.chat() with a mocked fetch so we
 * verify the right endpoint/headers are hit and the response is parsed —
 * without making real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildAnthropicBody } from "../ai/anthropicProvider";
import { buildGeminiBody } from "../ai/geminiProvider";
import { chat, getActiveProvider, setActiveProvider, getProviderKey } from "../ai/llm";

const MSGS = [
  { role: "system" as const, content: "You are terse." },
  { role: "user" as const, content: "Hi" },
  { role: "assistant" as const, content: "Hello" },
  { role: "user" as const, content: "Bye" },
];

describe("buildAnthropicBody", () => {
  it("hoists system messages and maps turns; defaults max_tokens", () => {
    const body = buildAnthropicBody(MSGS, {});
    expect(body.system).toBe("You are terse.");
    expect(body.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Bye" },
    ]);
    expect(body.max_tokens).toBe(1024);
    expect(body.stream).toBeUndefined();
  });

  it("honors maxTokens + stream flag", () => {
    const body = buildAnthropicBody(MSGS, { maxTokens: 50 }, true);
    expect(body.max_tokens).toBe(50);
    expect(body.stream).toBe(true);
  });
});

describe("buildGeminiBody", () => {
  it("maps assistant→model, hoists systemInstruction, sets generationConfig", () => {
    const body = buildGeminiBody(MSGS, { maxTokens: 100, temperature: 0.5 });
    expect(body.systemInstruction).toEqual({ parts: [{ text: "You are terse." }] });
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[0].parts[0].text).toBe("Hi");
    expect(body.generationConfig).toEqual({ maxOutputTokens: 100, temperature: 0.5 });
  });
});

describe("provider selection + key resolution", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips the active provider", () => {
    setActiveProvider("anthropic");
    expect(getActiveProvider()).toBe("anthropic");
  });
  it("reads a per-provider key from localStorage", () => {
    localStorage.setItem("lumen.ai.key.gemini", "g-key");
    expect(getProviderKey("gemini")).toBe("g-key");
  });
  it("throws a NO_KEY error when missing", () => {
    expect(() => getProviderKey("anthropic")).toThrowError(/anthropic API key/i);
  });
});

describe("llm.chat() routes to the selected cloud provider", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("calls the Anthropic endpoint and parses text blocks", async () => {
    setActiveProvider("anthropic");
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "claude says hi" }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await chat([{ role: "user", content: "hi" }]);
    expect(out).toBe("claude says hi");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("api.anthropic.com");
    expect(init.headers).toMatchObject({ "x-api-key": "a-key" });
  });

  it("calls the Gemini endpoint and parses candidate parts", async () => {
    setActiveProvider("gemini");
    localStorage.setItem("lumen.ai.key.gemini", "g-key");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "gemini says hi" }] } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await chat([{ role: "user", content: "hi" }]);
    expect(out).toBe("gemini says hi");
    const [gurl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(gurl)).toContain("generativelanguage.googleapis.com");
    expect(String(gurl)).toContain("key=g-key");
  });

  it("calls the Mistral endpoint (OpenAI-compatible) with a bearer key", async () => {
    setActiveProvider("mistral");
    localStorage.setItem("lumen.ai.key.mistral", "m-key");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "mistral says hi" } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await chat([{ role: "user", content: "hi" }]);
    expect(out).toBe("mistral says hi");
    const [murl, minit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(murl)).toContain("api.mistral.ai");
    expect(minit.headers).toMatchObject({ Authorization: "Bearer m-key" });
  });
});
