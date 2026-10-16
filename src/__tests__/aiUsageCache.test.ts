/**
 * AI usage meter, response cache and Anthropic prompt caching (Plan D:
 * D1, D2). The network is a mocked fetch.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildAnthropicBody, CACHE_MIN_CHARS } from "../ai/anthropicProvider";
import { chat, chatStream, setActiveProvider } from "../ai/llm";
import { clearAiCache, setAiCacheEnabled } from "../ai/responseCache";
import { costOf, formatUsageReport, priceFor, recordUsage, usageSummary, clearUsage } from "../ai/usage";

const sse = (events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { status: 200 });

describe("prices and cost", () => {
  it("estimates tokens by script", async () => {
    const { estimateTokens } = await import("../ai/usage");
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("שלום עולם")).toBe(5); // 8 Hebrew letters / 2 + 1 space / 4
    expect(estimateTokens("你好世界")).toBe(4);
  });

  it("matches the longest model prefix and prices cache reads / writes", () => {
    expect(priceFor("openai", "gpt-4o-mini-2024-07-18")).toMatchObject({ input: 0.15, output: 0.6, cachedInput: 0.075 });
    expect(priceFor("openai", "gpt-4o-2024-08-06")).toMatchObject({ input: 2.5, output: 10, cachedInput: 1.25 });
    expect(priceFor("ollama", "llama3.1")).toEqual({ input: 0, output: 0, cachedInput: 0, cacheWrite: 0 });
    expect(priceFor("openai", "some-new-model")).toBeNull();
    // Anthropic: 1M in at $3, 1M cache-read at 10%, 1M cache-write at 125%, 1M out at $15.
    expect(costOf({ provider: "anthropic", model: "claude-sonnet-5-5", inputTokens: 1e6, outputTokens: 1e6 })).toBeCloseTo(12, 6);
    expect(costOf({ provider: "anthropic", model: "claude-haiku-5-5", inputTokens: 1e6, outputTokens: 0 })).toBeCloseTo(0.5, 6); // > 100K: long-context rate
    expect(costOf({ provider: "anthropic", model: "claude-haiku-5-5", inputTokens: 50_000, outputTokens: 0 })).toBeCloseTo(0.005, 6);
    const c = costOf({ provider: "anthropic", model: "claude-sonnet-4-5", inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 1e6, cacheWriteTokens: 1e6 });
    expect(c).toBeCloseTo(3 + 0.3 + 3.75 + 15, 6);
    // OpenAI cached input is half price for GPT-4o; Gemini 25%.
    expect(costOf({ provider: "openai", model: "gpt-4o", inputTokens: 0, outputTokens: 0, cacheReadTokens: 1e6 })).toBeCloseTo(1.25, 6);
    expect(costOf({ provider: "gemini", model: "gemini-2.5-pro", inputTokens: 0, outputTokens: 0, cacheReadTokens: 1e5 })).toBeCloseTo(0.03125, 6);
    // Gemini 2.5 Pro above 200K prompt tokens: long-context rates.
    expect(costOf({ provider: "gemini", model: "gemini-2.5-pro", inputTokens: 300_000, outputTokens: 1e6 })).toBeCloseTo(0.75 + 15, 6);
  });

  it("sums a month per provider / model", () => {
    localStorage.clear();
    const now = new Date(2026, 9, 16);
    recordUsage({ provider: "openai", model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 500 }, now);
    recordUsage({ provider: "openai", model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 500, estimated: true }, now);
    recordUsage({ provider: "openai", model: "mystery", inputTokens: 10, outputTokens: 10 }, now);
    const s = usageSummary("2026-10");
    expect(s.total.requests).toBe(3);
    expect(s.total.inputTokens).toBe(2010);
    expect(s.total.unpriced).toBe(1);
    expect(s.total.estimated).toBe(1);
    expect(s.rows[0].model).toBe("gpt-4o-mini");
    expect(formatUsageReport(s)).toMatch(/3 requests/);
  });
});

describe("Anthropic prompt caching", () => {
  it("marks a long system prompt and a long first user turn as cacheable", () => {
    const long = "x".repeat(CACHE_MIN_CHARS);
    const body = buildAnthropicBody([
      { role: "system", content: long },
      { role: "user", content: long },
      { role: "assistant", content: "ok" },
      { role: "user", content: "short" },
    ]);
    expect(body.system).toEqual([{ type: "text", text: long, cache_control: { type: "ephemeral" } }]);
    expect(body.messages[0].content).toEqual([{ type: "text", text: long, cache_control: { type: "ephemeral" } }]);
    expect(body.messages[2].content).toBe("short");
    // Short prompts stay plain strings.
    expect(buildAnthropicBody([{ role: "system", content: "terse" }, { role: "user", content: "hi" }]).system).toBe("terse");
  });
});

describe("chat(): response cache and usage", () => {
  beforeEach(async () => {
    localStorage.clear();
    clearUsage();
    await clearAiCache();
    setAiCacheEnabled(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("answers an identical cacheable request locally and records exact usage once", async () => {
    setActiveProvider("anthropic");
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: "tags: a, b" }],
          usage: { input_tokens: 120, output_tokens: 8, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const msgs = [{ role: "user" as const, content: "tag this" }];
    expect(await chat(msgs, { cache: true })).toBe("tags: a, b");
    expect(await chat(msgs, { cache: true })).toBe("tags: a, b");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A different text misses.
    await chat([{ role: "user", content: "tag that" }], { cache: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const s = usageSummary();
    expect(s.total.requests).toBe(2);
    expect(s.total.cacheHits).toBe(1);
    expect(s.total.inputTokens).toBe(240);
    expect(s.total.cacheReadTokens).toBe(4000);
    expect(s.total.estimated).toBe(0);
  });

  it("doesn't cache without opt-in or when the user turned the cache off", async () => {
    setActiveProvider("mistral");
    localStorage.setItem("lumen.ai.key.mistral", "m-key");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ model: "mistral-small-latest", choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const msgs = [{ role: "user" as const, content: "x" }];
    await chat(msgs);
    await chat(msgs);
    setAiCacheEnabled(false);
    await chat(msgs, { cache: true });
    await chat(msgs, { cache: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const row = usageSummary().rows[0];
    expect([row.provider, row.model, row.requests, row.inputTokens]).toEqual(["mistral", "mistral-small-latest", 4, 20]);
  });

  it("doesn't cache an answer that came from a fallback provider", async () => {
    // WebGPU selected but unavailable here → OpenAI answers.
    setActiveProvider("local-webgpu");
    const { useAppStore } = await import("../store/useStore");
    useAppStore.setState({ aiKey: "sk-test" });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ model: "gpt-4o-mini", choices: [{ message: { content: "cloud" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const msgs = [{ role: "user" as const, content: "y" }];
    await chat(msgs, { cache: true });
    await chat(msgs, { cache: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(usageSummary().rows.map((r) => r.provider)).toEqual(["openai"]);
  });

  it("an estimate for a stream that fell back to OpenAI is OpenAI's", async () => {
    setActiveProvider("local-webgpu");
    const { useAppStore } = await import("../store/useStore");
    useAppStore.setState({ aiKey: "sk-test" });
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ choices: [{ delta: { content: "12345678" } }] }, { choices: [{ delta: { content: "more" } }] }])));
    const { chatStream: stream } = await import("../ai/llm");
    for await (const _ of stream([{ role: "user", content: "1234" }])) break;
    expect(usageSummary().rows.map((r) => [r.provider, r.estimated])).toEqual([["openai", 1]]);
  });

  it("asks Mistral for streamed usage", async () => {
    setActiveProvider("mistral");
    localStorage.setItem("lumen.ai.key.mistral", "m-key");
    const fetchMock = vi.fn(async () => sse([{ choices: [{ delta: { content: "ok" } }] }, { model: "mistral-small-latest", choices: [], usage: { prompt_tokens: 9, completion_tokens: 2 } }]));
    vi.stubGlobal("fetch", fetchMock);
    for await (const _ of chatStream([{ role: "user", content: "x" }])) void _;
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).stream_options).toEqual({ include_usage: true });
    expect(usageSummary().rows[0]).toMatchObject({ provider: "mistral", inputTokens: 9, outputTokens: 2, estimated: 0 });
  });

  it("caches only answers the caller accepts, under the provider's real default model", async () => {
    setActiveProvider("anthropic");
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    const replies = ["not json", '["a"]', "unused"];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: replies.shift() }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const msgs = [{ role: "user" as const, content: "tags?" }];
    const cacheIf = (r: string) => r.startsWith("[");
    expect(await chat(msgs, { cache: true, cacheIf })).toBe("not json"); // rejected: not cached
    expect(await chat(msgs, { cache: true, cacheIf })).toBe('["a"]'); // accepted: cached
    expect(await chat(msgs, { cache: true, cacheIf })).toBe('["a"]');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const { effectiveModel } = await import("../ai/llm");
    expect(effectiveModel("anthropic")).toBe("claude-sonnet-5-5");
    expect(usageSummary().rows.map((r) => r.model)).toEqual(["claude-sonnet-5-5"]);
  });

  it("records streamed Anthropic usage from message_start / message_delta", async () => {
    setActiveProvider("anthropic");
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          { type: "message_start", message: { model: "claude-haiku-4-5", usage: { input_tokens: 50, output_tokens: 1 } } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
          { type: "message_delta", usage: { output_tokens: 7 } },
        ]),
      ),
    );
    let out = "";
    for await (const c of chatStream([{ role: "user", content: "hi" }])) out += c;
    expect(out).toBe("Hello");
    const row = usageSummary().rows[0];
    expect([row.model, row.inputTokens, row.outputTokens, row.estimated]).toEqual(["claude-haiku-4-5", 50, 7, 0]);
  });

  it("counts Gemini thinking tokens as output and records usage of a blocked prompt", async () => {
    setActiveProvider("gemini");
    localStorage.setItem("lumen.ai.key.gemini", "g-key");
    localStorage.setItem("lumen.ai.model.gemini", "gemini-2.5-flash");
    const replies = [
      { candidates: [{ content: { parts: [{ text: "hi" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 30 } },
      { promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 7 } },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(replies.shift()), { status: 200 })));
    await chat([{ role: "user", content: "a" }]);
    await expect(chat([{ role: "user", content: "b" }])).rejects.toThrow(/Empty Gemini/);
    const row = usageSummary().rows[0];
    expect([row.requests, row.inputTokens, row.outputTokens]).toEqual([2, 17, 32]);
  });

  it("records an estimate when the consumer stops a stream early", async () => {
    setActiveProvider("anthropic");
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          { type: "content_block_delta", delta: { type: "text_delta", text: "12345678" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "more" } },
        ]),
      ),
    );
    for await (const c of chatStream([{ role: "user", content: "1234" }])) {
      expect(c).toBe("12345678");
      break; // stop after the first chunk
    }
    const row = usageSummary().rows[0];
    expect([row.inputTokens, row.outputTokens, row.estimated]).toEqual([1, 2, 1]);
  });

  it("estimates when the provider reports nothing", async () => {
    setActiveProvider("gemini");
    localStorage.setItem("lumen.ai.key.gemini", "g-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "abcdefgh" }] } }] }), { status: 200 })),
    );
    await chat([{ role: "user", content: "1234567890123456" }]);
    const row = usageSummary().rows[0];
    expect([row.provider, row.inputTokens, row.outputTokens, row.estimated]).toEqual(["gemini", 4, 2, 1]);
  });
});
