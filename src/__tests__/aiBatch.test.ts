/** Batch AI over a folder (Plan D: D9). Network is a mocked fetch. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchBatchResults, frontmatterTags, loadJobs, mergeTags, parseTags, planWrites, requestFor, setFrontmatterField, submitBatch, textHash } from "../ai/batch";
import { setActiveProvider } from "../ai/llm";
import { costOf, clearUsage, usageSummary } from "../ai/usage";
import { useAppStore } from "../store/useStore";


describe("batch helpers", () => {
  it("builds per-op requests and caps long notes", () => {
    expect(requestFor("tags", "x").system).toMatch(/JSON array/);
    expect(requestFor("translate", "hello", "French").user).toContain("Target language: French");
    expect(requestFor("summary", "y".repeat(30_000)).user.length).toBeLessThan(24_010);
  });

  it("sets front matter fields, replacing old values", () => {
    expect(setFrontmatterField("Body", "summary", '"S"')).toBe('---\nsummary: "S"\n---\n\nBody');
    expect(setFrontmatterField("---\ntitle: T\nsummary: old\n  continued\n---\nBody", "summary", '"New"')).toBe('---\ntitle: T\nsummary: "New"\n---\nBody');
  });

  it("parses tags and plans the writes", () => {
    expect(parseTags('```json\n["Machine Learning","#ai"]\n```')).toEqual(["machine-learning", "ai"]);
    const job = { id: "b", provider: "openai" as const, model: "m", op: "translate" as const, lang: "French", createdAt: "", status: "ended" as const, items: [{ customId: "n0", path: "a/x.md", hash: textHash("Hello") }] };
    expect(planWrites(job, new Map([["n0", "Bonjour"]]), (p) => (p === "a/x.md" ? "Hello" : null))).toEqual([{ path: "a/x.french.md", content: "Bonjour\n", created: true, source: "a/x.md" }]);
    // An existing translation is never overwritten: the next free name is used.
    const existing = new Set(["a/x.md", "a/x.french.md", "a/x.french-2.md"]);
    expect(planWrites(job, new Map([["n0", "Bonjour"]]), (p) => (p === "a/x.md" ? "Hello" : existing.has(p) ? "x" : null))[0].path).toBe("a/x.french-3.md");
    // A note edited after submission is skipped and reported.
    const changed: string[] = [];
    expect(planWrites(job, new Map([["n0", "Bonjour"]]), (p) => (p === "a/x.md" ? "Hello, edited" : null), undefined, changed)).toEqual([]);
    expect(changed).toEqual(["a/x.md"]);
    const tagJob = { ...job, op: "tags" as const, items: [{ customId: "n0", path: "a/x.md" }, { customId: "n1", path: "gone.md" }] };
    expect(planWrites(tagJob, new Map([["n0", '["alpha","beta"]'], ["n1", '["gamma"]']]), (p) => (p === "a/x.md" ? "Hi" : null))).toEqual([
      { path: "a/x.md", content: "---\ntags: [alpha, beta]\n---\n\nHi", created: false, source: "a/x.md" },
    ]);
  });

  it("merges with block-list tags and replaces block scalars whole", () => {
    const note = "---\ntitle: T\ntags:\n  - existing\n  - alpha\nsummary: |\n  line one\n\n  line three\nother: x\n---\nBody";
    expect(frontmatterTags(note)).toEqual(["existing", "alpha"]);
    const merged = mergeTags(note, ["alpha", "beta"]);
    expect(merged).toContain("tags: [existing, alpha, beta]");
    expect(merged).not.toContain("  - existing");
    expect(mergeTags("---\ntags:\n  - \"a: b\"\n  - c#d\n---\nx", ["new"])).toContain('tags: ["a: b", "c#d", new]');
    expect(frontmatterTags('---\ntags: ["a, b", c]\n---\n')).toEqual(["a, b", "c"]);
    expect(setFrontmatterField("---\n---\nBody", "summary", '"S"')).toBe('---\nsummary: "S"\n---\nBody');
    const flowNote = "---\ntitle: T\ntags: [\n  alpha,\n  beta\n]\nother: x\n---\nBody";
    expect(frontmatterTags(flowNote)).toEqual(["alpha", "beta"]);
    expect(mergeTags(flowNote, ["gamma"])).toBe("---\ntitle: T\ntags: [alpha, beta, gamma]\nother: x\n---\nBody");
    const replaced = setFrontmatterField(note, "summary", '"New"');
    expect(replaced).toContain('summary: "New"\nother: x');
    expect(replaced).not.toContain("line three");
  });

  it("prices batch usage at half", () => {
    const u = { provider: "openai", model: "gpt-4o-mini", inputTokens: 1e6, outputTokens: 1e6 };
    expect(costOf({ ...u, batch: true })).toBeCloseTo(costOf(u)! / 2, 6);
  });
});

describe("batch APIs", () => {
  beforeEach(() => {
    localStorage.clear();
    clearUsage();
  });

  it("submits and collects an Anthropic Message Batch", async () => {
    setActiveProvider("anthropic");
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    const calls: Array<[string, RequestInit | undefined]> = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/batches")) return new Response(JSON.stringify({ id: "msgbatch_1" }));
      if (url.endsWith("/msgbatch_1")) return new Response(JSON.stringify({ processing_status: "ended", results_url: "https://api.anthropic.com/results/1" }));
      return new Response(
        [
          { custom_id: "n0", result: { type: "succeeded", message: { model: "claude-haiku-4-5", content: [{ type: "text", text: '["roses"]' }], usage: { input_tokens: 100, output_tokens: 5 } } } },
          { custom_id: "n1", result: { type: "errored" } },
        ]
          .map((x) => JSON.stringify(x))
          .join("\n"),
      );
    }) as unknown as typeof fetch;
    const job = await submitBatch("tags", [{ path: "a.md", text: "Roses" }, { path: "b.md", text: "x" }], { fetchImpl: f });
    const body = JSON.parse(String(calls[0][1]!.body));
    expect(body.requests[0]).toMatchObject({ custom_id: "n0", params: { messages: [{ role: "user", content: "Roses" }] } });
    expect(loadJobs().map((j) => j.id)).toEqual(["msgbatch_1"]);
    const res = await fetchBatchResults(job, f);
    expect(res.state).toBe("ended");
    expect([...res.answers]).toEqual([["n0", '["roses"]']]);
    expect(res.failed).toBe(1);
    expect(usageSummary().rows[0]).toMatchObject({ provider: "anthropic", inputTokens: 100, outputTokens: 5 });
    // Fetching the results again (not applied yet) doesn't meter twice.
    await fetchBatchResults(job, f);
    expect(usageSummary().rows[0]).toMatchObject({ requests: 1, inputTokens: 100 });
  });

  it("reports a submitted job it couldn't save, with its ID", async () => {
    setActiveProvider("anthropic");
    localStorage.setItem("lumen.ai.key.anthropic", "a-key");
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "msgbatch_9" }))) as unknown as typeof fetch;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      await expect(submitBatch("tags", [{ path: "a.md", text: "x" }], { fetchImpl: f })).rejects.toThrow(/msgbatch_9/);
    } finally {
      spy.mockRestore();
    }
  });

  it("submits an OpenAI batch via a JSONL file and reports processing", async () => {
    setActiveProvider("openai");
    useAppStore.setState({ aiKey: "sk-test" });
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("/files")) return new Response(JSON.stringify({ id: "file_1" }));
      if (url.endsWith("/batches")) return new Response(JSON.stringify({ id: "batch_1" }));
      return new Response(JSON.stringify({ status: "in_progress" }));
    }) as unknown as typeof fetch;
    const job = await submitBatch("summary", [{ path: "a.md", text: "Long note" }], { fetchImpl: f });
    expect(job).toMatchObject({ id: "batch_1", provider: "openai", op: "summary" });
    const res = await fetchBatchResults(job, f);
    expect(res.state).toBe("processing");
  });
});
