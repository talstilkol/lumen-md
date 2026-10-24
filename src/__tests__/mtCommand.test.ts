/**
 * The translate command's routing (plan 6.4): local layers first, the LLM
 * translator agent only when none can take the pair, with the reasons.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { translateLocally, runAgentOrThrow, detect } = vi.hoisted(() => ({
  translateLocally: vi.fn(),
  runAgentOrThrow: vi.fn(async (_def: unknown, input: { text: string }) => `LLM(${input.text})`),
  detect: vi.fn((text: string) => (/[֐-׿]/.test(text) ? { lang: "he", confident: true } : { lang: "en", confident: true })),
}));
vi.mock("../ai/mt", () => ({ translateLocally }));
vi.mock("../agents/runtime", () => ({ runAgentOrThrow }));
vi.mock("../text/langId", () => ({
  detectLanguage: detect,
  languageCode: (s: string) => ({ english: "en", hebrew: "he", עברית: "he", klingon: null } as Record<string, string | null>)[s.toLowerCase()] ?? (s.length === 2 ? s : null),
}));
vi.mock("../ui/PromptDialog", () => ({ uiConfirm: vi.fn(async () => true) }));
vi.mock("../i18n", () => ({ t: (k: string) => k, getLocale: () => "en", registerEnglish: () => undefined }));

import { translateMarkdownDetailed } from "../agents/commands";

describe("translateMarkdownDetailed", () => {
  beforeEach(() => {
    translateLocally.mockReset();
    runAgentOrThrow.mockClear();
    detect.mockClear();
  });

  it("translates locally when a layer takes the pair, with the document's detected language as source", async () => {
    translateLocally.mockResolvedValueOnce({ text: "LOCAL", layer: "opus", unmeasured: true });
    const r = await translateMarkdownDetailed("שלום עולם", "English");
    expect(r).toEqual({ text: "LOCAL", layer: "opus", unmeasured: true, reasons: {} });
    expect(translateLocally.mock.calls[0][1]).toEqual({ source: "he", target: "en" });
    expect(runAgentOrThrow).not.toHaveBeenCalled();
  });

  it("falls back to the translator agent and carries the layers' reasons", async () => {
    translateLocally.mockResolvedValueOnce({ layer: null, reasons: { chrome: "mt.layer.chrome.absent", opus: "mt.layer.opus.noHost" } });
    const r = await translateMarkdownDetailed("Hello world", "עברית");
    expect(r).toEqual({ text: "LLM(Hello world)", layer: "llm", unmeasured: false, reasons: { chrome: "mt.layer.chrome.absent", opus: "mt.layer.opus.noHost" } });
  });

  it("goes to the agent when the target is unknown to the detector or the source cannot be told", async () => {
    const r = await translateMarkdownDetailed("Hello world", "Klingon");
    expect(r.layer).toBe("llm");
    expect(translateLocally).not.toHaveBeenCalled();
    detect.mockReturnValueOnce({ lang: "und", confident: false });
    const r2 = await translateMarkdownDetailed("123 456", "English");
    expect(r2).toMatchObject({ layer: "llm", reasons: { opus: "mt.layer.sourceUnknown" } });
    expect(translateLocally).not.toHaveBeenCalled();
  });

  it("a local layer that breaks mid-way is reported and the agent takes over; an abort is not swallowed", async () => {
    translateLocally.mockRejectedValueOnce(new Error("worker gone"));
    const r = await translateMarkdownDetailed("Hello world", "he");
    expect(r).toMatchObject({ layer: "llm", reasons: { opus: "mt.layer.failed" } });
    translateLocally.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    await expect(translateMarkdownDetailed("Hello world", "he")).rejects.toThrow(/aborted/);
  });
});
