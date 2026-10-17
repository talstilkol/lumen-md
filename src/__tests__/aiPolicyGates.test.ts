import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = { aiKey: "sk", useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null };
vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => state, setState: vi.fn() } }));
vi.mock("../store/useToastStore", () => ({ toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));
vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/**
 * Every path that sends content to a third party outside chat() must stop
 * under the local-only policy before any request goes out.
 */
describe("AI policy gates on direct cloud paths", () => {
  const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("lumen.ai.policy", "local-only");
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("transcription: under local-only the cloud Whisper API is never contacted; local-first falls back to it", async () => {
    const { transcribe } = await import("../ai/transcribe");
    // Local by default: in jsdom the local path fails (no Web Audio) and that is final.
    await expect(transcribe(new Blob(["x"]))).rejects.toThrow(/Web Audio/);
    expect(fetchSpy).not.toHaveBeenCalled();
    localStorage.setItem("lumen.ai.policy", "local-first");
    vi.stubGlobal("fetch", fetchSpy);
    await expect(transcribe(new Blob(["x"]))).rejects.toThrow();
    // The fallback would reach OpenAI; with a key it does — proving the gate is the policy, not luck.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("api.openai.com");
  });

  it("the public LanguageTool API, but not a LanguageTool on this machine", async () => {
    const { checkGrammar } = await import("../ai/grammar");
    await expect(checkGrammar("This are a sentence with enough words to be checked by the tool.")).rejects.toMatchObject({ code: "POLICY" });
    expect(fetchSpy).not.toHaveBeenCalled();
    const { isLocalOrigin } = await import("../ai/policy");
    expect(isLocalOrigin("http://localhost:8010/v2/check")).toBe(true);
  });

  it("batch jobs (OpenAI / Anthropic batch API)", async () => {
    localStorage.setItem("lumen.ai.provider", "openai");
    const { submitBatch, fetchBatchResults } = await import("../ai/batch");
    await expect(submitBatch("translate", [{ path: "a.md", text: "hello world" }], { lang: "he" })).rejects.toMatchObject({ code: "POLICY" });
    await expect(fetchBatchResults({ id: "b", provider: "openai", model: "m", op: "translate", createdAt: "", items: [], status: "submitted" } as never)).rejects.toMatchObject({ code: "POLICY" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fine-tuning (uploads the user's writing)", async () => {
    const { startFineTune, getFineTuneJob } = await import("../ai/fineTune");
    await expect(startFineTune()).rejects.toMatchObject({ code: "POLICY" });
    await expect(getFineTuneJob("ft-1")).rejects.toMatchObject({ code: "POLICY" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("OpenAI embeddings behind smart search", async () => {
    const { indexWorkspace } = await import("../ai/semanticSearch");
    await expect(indexWorkspace({ force: true })).rejects.toMatchObject({ code: "POLICY" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Claude web search and a remote research service; a local research service is fine", async () => {
    localStorage.setItem("lumen.ai.provider", "anthropic");
    localStorage.setItem("lumen.research.provider", "claude");
    const { runResearch } = await import("../research/agent");
    await expect(runResearch({ question: "q" } as never)).rejects.toMatchObject({ code: "POLICY" });
    localStorage.setItem("lumen.research.provider", "brave");
    localStorage.setItem("lumen.research.endpoint", "https://research.example.workers.dev");
    await expect(runResearch({ question: "q" } as never)).rejects.toMatchObject({ code: "POLICY" });
    expect(fetchSpy).not.toHaveBeenCalled();
    // Injected search/extract (a local SearXNG wrapper, or tests) is not the cloud.
    const local = await runResearch({
      question: "q",
      deps: {
        search: async () => [],
        extract: async () => ({ url: "", title: "", text: "" }),
      },
    } as never).catch((e: Error) => e);
    expect((local as { code?: string }).code).not.toBe("POLICY");
  });
});
