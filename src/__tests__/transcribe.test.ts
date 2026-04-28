/**
 * Tests for the voice-memo transcription module (γ.4 / F2).
 *
 * The local backend (`@xenova/transformers`) is dynamic-imported and
 * fails fast in jsdom (no WebGPU + the package isn't installed).
 * The cloud backend hits OpenAI's `/v1/audio/transcriptions`. We mock
 * `fetch` and `useAppStore` to drive both paths deterministically.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAppStore } from "../store/useStore";
import { transcribe, summarizeMemo, formatVoiceMemo } from "../ai/transcribe";

beforeEach(() => {
  vi.unstubAllGlobals();
  // Reset Privacy Mode + AI key between tests.
  useAppStore.setState({ useLocalAi: false, aiKey: "sk-test" });
});

describe("transcribe — cloud backend", () => {
  it("POSTs the blob to OpenAI Whisper and returns the trimmed text", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "  hello world  " }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const blob = new Blob(["fake-audio"], { type: "audio/webm" });

    const result = await transcribe(blob);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(result.text).toBe("hello world");
    expect(result.backend).toBe("cloud");
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it("forwards the language hint when provided", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "x" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await transcribe(new Blob(["x"], { type: "audio/webm" }), { language: "fr" });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const form = init.body as FormData;
    expect(form.get("language")).toBe("fr");
    expect(form.get("model")).toBe("whisper-1");
  });

  it("throws AiError on a non-200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("rate-limited", { status: 429 })),
    );
    await expect(transcribe(new Blob(["x"]))).rejects.toThrow(/Whisper failed \(429\)/);
  });

  it("throws AiError when AI key is missing", async () => {
    useAppStore.setState({ aiKey: null });
    await expect(transcribe(new Blob(["x"]))).rejects.toThrow(/configure your AI Key/i);
  });
});

describe("transcribe — local backend (Privacy Mode)", () => {
  it("falls through to AiError when @xenova/transformers isn't installed", async () => {
    useAppStore.setState({ useLocalAi: true });
    // The dynamic import will fail in test env (package not installed).
    await expect(transcribe(new Blob(["x"]))).rejects.toThrow(
      /Local transcription requires/,
    );
  });
});

describe("formatVoiceMemo", () => {
  it("emits a `> 🎙 Voice memo` quote with date + summary + collapsible transcript", () => {
    const out = formatVoiceMemo({
      transcript: "Long transcript body",
      summary: "- bullet one\n- bullet two",
      date: new Date("2026-04-28T10:30:00Z"),
      backend: "cloud",
    });
    expect(out).toMatch(/> 🎙 Voice memo · 2026-04-28 10:30/);
    expect(out).toContain("- bullet one");
    expect(out).toContain("<details><summary>Full transcript</summary>");
    expect(out).toContain("Long transcript body");
    expect(out).toContain("</details>");
  });

  it("appends a 🛡 local marker when the local backend was used", () => {
    const out = formatVoiceMemo({
      transcript: "x",
      summary: "y",
      date: new Date("2026-04-28T10:30:00Z"),
      backend: "local",
    });
    expect(out).toContain("🛡 local");
  });

  it("falls back to '_(no summary available)_' when summary is empty", () => {
    const out = formatVoiceMemo({
      transcript: "x",
      summary: "",
      date: new Date("2026-04-28T10:30:00Z"),
      backend: "cloud",
    });
    expect(out).toContain("_(no summary available)_");
  });
});

describe("summarizeMemo", () => {
  it("returns empty string for empty transcripts (no API call)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await summarizeMemo("");
    expect(out).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
