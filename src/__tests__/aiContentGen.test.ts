/**
 * Tests for the AI content-generation helpers (diagram / action items /
 * translate). The LLM is mocked, so we verify prompt routing and output
 * shaping deterministically — no network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../ai/llm", () => ({
  chat: vi.fn(),
  chatStream: vi.fn(),
}));

import { chat } from "../ai/llm";
import {
  stripCodeFences,
  generateDiagram,
  extractActionItems,
  translateMarkdown,
  generateChart,
} from "../ai/agents";

const mockChat = vi.mocked(chat);

beforeEach(() => mockChat.mockReset());

describe("stripCodeFences", () => {
  it("removes a surrounding fenced block", () => {
    expect(stripCodeFences("```mermaid\nflowchart TD\nA-->B\n```")).toBe("flowchart TD\nA-->B");
  });
  it("leaves bare text untouched", () => {
    expect(stripCodeFences("flowchart TD\nA-->B")).toBe("flowchart TD\nA-->B");
  });
});

describe("generateDiagram", () => {
  it("wraps the model output in a ```mermaid block, stripping model fences", async () => {
    mockChat.mockResolvedValue("```mermaid\nflowchart TD\nA-->B\n```");
    const out = await generateDiagram("A leads to B");
    expect(out).toBe("```mermaid\nflowchart TD\nA-->B\n```");
  });
  it("wraps a bare diagram definition", async () => {
    mockChat.mockResolvedValue("flowchart TD\nX-->Y");
    expect(await generateDiagram("x then y")).toBe("```mermaid\nflowchart TD\nX-->Y\n```");
  });
});

describe("extractActionItems", () => {
  it("returns the task list from the model", async () => {
    mockChat.mockResolvedValue("- [ ] Ship it (Bob)\n- [ ] Review (Ann)");
    const out = await extractActionItems("notes...");
    expect(out).toContain("- [ ] Ship it (Bob)");
    expect(out).toContain("- [ ] Review (Ann)");
  });
});

describe("translateMarkdown", () => {
  it("passes the target language and returns the translation", async () => {
    mockChat.mockResolvedValue("# Hola\n\nMundo");
    const out = await translateMarkdown("# Hello\n\nWorld", "Spanish");
    expect(out).toBe("# Hola\n\nMundo");
    const userMsg = mockChat.mock.calls[0][0][1].content;
    expect(userMsg).toContain("Target language: Spanish");
    expect(userMsg).toContain("# Hello");
  });
});

describe("generateChart", () => {
  it("wraps an ECharts spec in a ```chart block and strips model fences", async () => {
    mockChat.mockResolvedValue('```json\n{"xAxis":{},"yAxis":{},"series":[]}\n```');
    const out = await generateChart("month,sales\nJan,10\nFeb,20");
    expect(out).toBe('```chart\n{"xAxis":{},"yAxis":{},"series":[]}\n```');
  });
  it("routes through the visualization system prompt", async () => {
    mockChat.mockResolvedValue('{"xAxis":{},"yAxis":{},"series":[]}');
    await generateChart("a,b\n1,2");
    const systemMsg = mockChat.mock.calls[0][0][0].content;
    expect(systemMsg).toContain("data visualization");
    expect(systemMsg).toContain("ECharts");
  });
});
