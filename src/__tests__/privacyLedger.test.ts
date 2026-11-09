/** T37 — the privacy ledger records AI requests and enforces local-only. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { __resetLedger, classify, ledgerEntries, ledgerSummary, PrivacyBlockedError, withLedger } from "../ai/privacyLedger";
import { setAiPolicy } from "../ai/policy";

function fakeFetch() {
  return vi.fn(async () => new Response("ok", { status: 200, headers: { "content-length": "2" } }));
}

describe("privacy ledger", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetLedger();
  });

  it("classifies AI destinations and ignores everything else", () => {
    expect(classify("https://api.openai.com/v1/chat/completions")?.category).toBe("cloud-ai");
    expect(classify("https://api.anthropic.com/v1/messages")?.category).toBe("cloud-ai");
    expect(classify("https://api.languagetool.org/v2/check")?.category).toBe("cloud-text");
    expect(classify("https://huggingface.co/x/resolve/main/model.onnx")?.category).toBe("model-download");
    expect(classify("http://localhost:11434/api/chat")?.category).toBe("local-ai");
    expect(classify("https://fonts.googleapis.com/css2")).toBeNull();
    expect(classify("/assets/app.js")).toBeNull();
  });

  it("records a cloud request with sizes, never its body", async () => {
    setAiPolicy("cloud");
    const inner = fakeFetch();
    const f = withLedger(inner as unknown as typeof fetch);
    await f("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ prompt: "secret plan שלום" }) });
    const [e] = ledgerEntries();
    expect(e).toMatchObject({ host: "api.anthropic.com", method: "POST", decision: "allowed", category: "cloud-ai", bytesIn: 2, status: 200 });
    expect(e.bytesOut).toBeGreaterThan(20);
    expect(JSON.stringify(e)).not.toContain("secret plan");
    expect(ledgerSummary().cloudRequests).toBe(1);
  });

  it("blocks cloud AI under local-only and never calls the network", async () => {
    setAiPolicy("local-only");
    const inner = fakeFetch();
    const f = withLedger(inner as unknown as typeof fetch);
    await expect(f("https://api.openai.com/v1/chat/completions", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(PrivacyBlockedError);
    expect(inner).not.toHaveBeenCalled();
    expect(ledgerEntries()[0]).toMatchObject({ decision: "blocked", policy: "local-only" });
  });

  it("local-only still allows local Ollama and model downloads", async () => {
    setAiPolicy("local-only");
    const inner = fakeFetch();
    const f = withLedger(inner as unknown as typeof fetch);
    await f("http://localhost:11434/api/tags");
    await f("https://huggingface.co/m/resolve/main/w.bin");
    expect(inner).toHaveBeenCalledTimes(2);
    expect(ledgerEntries().map((e) => e.decision)).toEqual(["allowed", "allowed"]);
  });

  it("passes other traffic through untouched and unrecorded", async () => {
    const inner = fakeFetch();
    const f = withLedger(inner as unknown as typeof fetch);
    await f("https://example.com/a");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(ledgerEntries()).toHaveLength(0);
  });
});
