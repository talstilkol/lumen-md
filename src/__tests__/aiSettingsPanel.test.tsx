import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../store/useStore", () => ({ useAppStore: { getState: () => ({ aiKey: null, useLocalAi: false, useFineTunedModel: false, fineTunedModelId: null }) } }));
vi.mock("../agents/executors/ollama", async (orig) => ({
  ...(await orig<object>()),
  refreshOllama: vi.fn(async () => ({ models: [{ name: "qwen2.5:7b", params: 7, family: "qwen2" }] })),
}));
vi.mock("../ai/modelManager", async (orig) => ({
  ...(await orig<object>()),
  detectHardware: vi.fn(async () => ({ webgpu: true, f16: true, maxBufferMB: 2048, deviceMemoryGB: 8, cores: 8, mobile: false })),
}));

import { pickExecutor, registerExecutor, resetExecutors, setPreferredExecutor, withPreference, preferredExecutor } from "../agents/executors";
import { AiSettingsPanel } from "../ui/AiSettingsPanel";
import { fakeExecutor, sequence } from "./helpers/fakeExecutor";
import type { Executor } from "../agents/types";

function fake(id: Executor["id"], available: boolean): Executor {
  return { ...fakeExecutor(sequence("x")), id, available: async () => (available ? { available: true } : { available: false, reason: "offline" }) };
}

beforeEach(() => {
  localStorage.clear();
  resetExecutors();
});

describe("preferred executor", () => {
  it("moves the preference to the front only when the agent allows it", () => {
    expect(withPreference(["ollama", "webllm", "chat"], "chat")).toEqual(["chat", "ollama", "webllm"]);
    expect(withPreference(["ollama", "chat"], "webllm")).toEqual(["ollama", "chat"]);
    expect(withPreference(["ollama", "chat"], null)).toEqual(["ollama", "chat"]);
  });

  it("pickExecutor honours the stored preference and falls back when it is unavailable", async () => {
    registerExecutor(fake("ollama", true));
    registerExecutor(fake("webllm", true));
    registerExecutor(fake("chat", true));
    setPreferredExecutor("webllm");
    expect(preferredExecutor()).toBe("webllm");
    expect((await pickExecutor()).executor?.id).toBe("webllm");
    registerExecutor(fake("webllm", false));
    expect((await pickExecutor()).executor?.id).toBe("ollama");
    setPreferredExecutor(null);
    expect(localStorage.getItem("lumen.ai.executor")).toBeNull();
  });
});

describe("AiSettingsPanel", () => {
  it("shows availability, hardware and installed models; writes the same keys the runtime reads", async () => {
    registerExecutor(fake("ollama", true));
    registerExecutor(fake("webllm", false));
    registerExecutor(fake("chat", false));
    render(<AiSettingsPanel open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("exec-status-ollama").textContent).toBe("Available"));
    expect(screen.getByTestId("exec-status-webllm").textContent).toContain("offline");
    await waitFor(() => expect(screen.getByText("Installed: qwen2.5:7b")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("hw-card").textContent).toContain("WebGPU ready"));

    fireEvent.click(screen.getByLabelText(/Local first/));
    await waitFor(() => expect(localStorage.getItem("lumen.ai.policy")).toBe("local-first"));
    fireEvent.click(screen.getByLabelText(/Model in the browser/));
    await waitFor(() => expect(localStorage.getItem("lumen.ai.executor")).toBe("webllm"));
    fireEvent.click(screen.getByLabelText(/^Automatic/));
    await waitFor(() => expect(localStorage.getItem("lumen.ai.executor")).toBeNull());

    const [ollamaUrl] = screen.getAllByPlaceholderText("http://localhost:11434");
    fireEvent.change(ollamaUrl, { target: { value: "http://127.0.0.1:11434" } });
    fireEvent.change(screen.getByPlaceholderText("http://localhost:8010/v2/check"), { target: { value: "http://localhost:8010/v2/check" } });
    for (const b of screen.getAllByText("Save")) fireEvent.click(b);
    await waitFor(() => expect(localStorage.getItem("lumen.ollama.baseUrl")).toBe("http://127.0.0.1:11434"));
    await waitFor(() => expect(localStorage.getItem("lumen.grammar.endpoint")).toBe("http://localhost:8010/v2/check"));
  });

  it("buttons hand off to the existing commands", async () => {
    const ids: string[] = [];
    const on = (e: Event) => ids.push((e as CustomEvent).detail.id);
    window.addEventListener("lumen-run-command", on);
    const onClose = vi.fn();
    render(<AiSettingsPanel open onClose={onClose} />);
    fireEvent.click(await screen.findByText("AI: Recent Agent Runs"));
    expect(ids).toEqual(["ai.trace"]);
    expect(onClose).toHaveBeenCalled();
    window.removeEventListener("lumen-run-command", on);
  });
});
