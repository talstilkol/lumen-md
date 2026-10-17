import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = { aiKey: null as string | null, useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null };
vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => state } }));
vi.mock("../store/useToastStore", () => ({ toast: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const ollamaUp = vi.fn().mockResolvedValue(false);
vi.mock("../ai/ollamaProvider", () => ({
  isOllamaAvailable: () => ollamaUp(),
  chatOllama: vi.fn().mockResolvedValue("from ollama"),
  chatOllamaStream: vi.fn(),
  getBaseUrl: () => "http://127.0.0.1:11434",
}));
vi.mock("../ai/localLlm", () => ({
  localLlmAvailable: () => ({ available: false }),
  chatLocal: vi.fn(),
  onLocalLlmProgress: () => () => {},
}));
vi.mock("../ai/anthropicProvider", () => ({ chatAnthropic: vi.fn().mockResolvedValue("from claude"), chatAnthropicStream: vi.fn() }));

import { getAiPolicy, setAiPolicy, cloudAllowed, providerAllowed, hasExplicitAiPolicy, hasAnyCloudKey } from "../ai/policy";
import { chat, chatStream } from "../ai/llm";
import { hasAiCredentials } from "../ai/credentials";

const KEYS = ["lumen.ai.policy", "lumen.ai.provider", "lumen.ai.key.anthropic", "lumen.ai.key.gemini"];

describe("AI policy", () => {
  beforeEach(() => {
    for (const k of KEYS) localStorage.removeItem(k);
    state.aiKey = null;
    state.useLocalAi = false;
    ollamaUp.mockResolvedValue(false);
  });
  afterEach(() => {
    for (const k of KEYS) localStorage.removeItem(k);
  });

  it("defaults to local-only on a fresh install", () => {
    expect(getAiPolicy()).toBe("local-only");
    expect(hasExplicitAiPolicy()).toBe(false);
    expect(cloudAllowed()).toBe(false);
    expect(providerAllowed("openai")).toBe(false);
    expect(providerAllowed("ollama")).toBe(true);
  });

  it("keeps a pre-policy cloud setup working as local-first", () => {
    localStorage.setItem("lumen.ai.key.anthropic", "k");
    expect(hasAnyCloudKey()).toBe(true);
    expect(getAiPolicy()).toBe("local-first");
    localStorage.removeItem("lumen.ai.key.anthropic");
    localStorage.setItem("lumen.ai.provider", "gemini");
    expect(getAiPolicy()).toBe("local-first");
    localStorage.removeItem("lumen.ai.provider");
    state.aiKey = "sk";
    expect(getAiPolicy()).toBe("local-first");
  });

  it("an explicit choice wins over the compatibility default", () => {
    state.aiKey = "sk";
    setAiPolicy("local-only");
    expect(getAiPolicy()).toBe("local-only");
    expect(hasExplicitAiPolicy()).toBe(true);
    expect(() => setAiPolicy("nope" as never)).toThrow();
  });

  it("chat(): no cloud fallback under local-only when Ollama is down (NO_LOCAL, not NO_KEY)", async () => {
    localStorage.setItem("lumen.ai.provider", "ollama");
    await expect(chat([{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "NO_LOCAL" });
    // Streaming takes the same gate.
    const gen = chatStream([{ role: "user", content: "hi" }]);
    await expect(gen.next()).rejects.toMatchObject({ code: "NO_LOCAL" });
  });

  it("chat(): Ollama answers normally under local-only", async () => {
    localStorage.setItem("lumen.ai.provider", "ollama");
    ollamaUp.mockResolvedValue(true);
    await expect(chat([{ role: "user", content: "hi" }])).resolves.toBe("from ollama");
  });

  it("chat(): a cloud provider is refused under an explicit local-only policy (POLICY)", async () => {
    localStorage.setItem("lumen.ai.provider", "anthropic");
    localStorage.setItem("lumen.ai.key.anthropic", "k");
    setAiPolicy("local-only");
    await expect(chat([{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "POLICY" });
    expect(hasAiCredentials()).toBe(false);
    setAiPolicy("cloud");
    await expect(chat([{ role: "user", content: "hi" }])).resolves.toBe("from claude");
    expect(hasAiCredentials()).toBe(true);
  });

  it("chat(): local-first still falls back to OpenAI (NO_KEY when no key)", async () => {
    localStorage.setItem("lumen.ai.provider", "ollama");
    setAiPolicy("local-first");
    await expect(chat([{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "NO_KEY" });
  });

  it("chat(): WebGPU unavailable under local-only stops before OpenAI", async () => {
    state.useLocalAi = true;
    await expect(chat([{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "NO_LOCAL" });
    expect(hasAiCredentials()).toBe(false);
  });
});
