import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AiError, parseJsonResponse } from "../ai/llm";

vi.mock("../store/useStore", () => ({
  useAppStore: {
    getState: vi.fn().mockReturnValue({
      aiKey: null,
      useLocalAi: false,
      useFineTunedModel: false,
      fineTunedModelId: null,
    }),
  },
}));
vi.mock("../store/useToastStore", () => ({
  toast: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("AiError", () => {
  it("is an Error instance", () => {
    const e = new AiError("NO_KEY", "test message");
    expect(e).toBeInstanceOf(Error);
  });

  it("has the correct code", () => {
    const e = new AiError("API_ERROR", "bad request");
    expect(e.code).toBe("API_ERROR");
  });

  it("has the correct message", () => {
    const e = new AiError("PARSE_ERROR", "parse failed");
    expect(e.message).toBe("parse failed");
  });

  it("has name AiError", () => {
    const e = new AiError("ABORTED", "aborted");
    expect(e.name).toBe("AiError");
  });
});

describe("parseJsonResponse", () => {
  it("parses a plain JSON string", () => {
    const result = parseJsonResponse<{ x: number }>('{"x": 42}');
    expect(result.x).toBe(42);
  });

  it("strips markdown json code fences", () => {
    const fenced = "```json\n{\"a\": 1}\n```";
    const result = parseJsonResponse<{ a: number }>(fenced);
    expect(result.a).toBe(1);
  });

  it("strips plain code fences", () => {
    const fenced = "```\n{\"b\": 2}\n```";
    const result = parseJsonResponse<{ b: number }>(fenced);
    expect(result.b).toBe(2);
  });

  it("throws AiError on invalid JSON", () => {
    expect(() => parseJsonResponse("not json")).toThrow(AiError);
  });

  it("throws with PARSE_ERROR code", () => {
    try {
      parseJsonResponse("{ bad }");
    } catch (e) {
      expect((e as AiError).code).toBe("PARSE_ERROR");
    }
  });
});

describe("getAiKey", () => {
  it("throws AiError NO_KEY when key is null", async () => {
    const { getAiKey } = await import("../ai/llm");
    expect(() => getAiKey()).toThrow(AiError);
  });

  it("returns key when set in store", async () => {
    const { useAppStore } = await import("../store/useStore") as any;
    useAppStore.getState.mockReturnValue({
      aiKey: "sk-test-key",
      useLocalAi: false,
      useFineTunedModel: false,
      fineTunedModelId: null,
    });
    const { getAiKey } = await import("../ai/llm");
    expect(getAiKey()).toBe("sk-test-key");
  });
});
