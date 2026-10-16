/**
 * AI inline prompt history — the localStorage store and the ArrowUp /
 * ArrowDown cycling in <AiInlinePromptOverlay />.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import {
  rememberAiPrompt,
  getAiPromptHistory,
  clearAiPromptHistory,
  AI_PROMPT_HISTORY_MAX,
} from "../storage/aiPromptHistory";
import { AiInlinePromptOverlay, openAiPrompt } from "../ui/AiInlinePrompt";

beforeEach(() => {
  clearAiPromptHistory();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("aiPromptHistory store", () => {
  it("keeps most-recent-first, trims, dedupes and ignores blanks", () => {
    rememberAiPrompt("  first ");
    rememberAiPrompt("second");
    rememberAiPrompt("   ");
    rememberAiPrompt("first");
    expect(getAiPromptHistory()).toEqual(["first", "second"]);
  });

  it(`caps at ${AI_PROMPT_HISTORY_MAX} entries`, () => {
    for (let i = 0; i < 30; i++) rememberAiPrompt(`p${i}`);
    const h = getAiPromptHistory();
    expect(h).toHaveLength(AI_PROMPT_HISTORY_MAX);
    expect(h[0]).toBe("p29");
    expect(h[h.length - 1]).toBe("p10");
  });

  it("persists to localStorage", () => {
    rememberAiPrompt("saved");
    expect(JSON.parse(localStorage.getItem("lumen.ai.promptHistory")!)).toEqual(["saved"]);
  });

  it("survives corrupt data and throwing storage", () => {
    localStorage.setItem("lumen.ai.promptHistory", "{not json");
    expect(getAiPromptHistory()).toEqual([]);

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => rememberAiPrompt("in memory")).not.toThrow();
    expect(getAiPromptHistory()).toEqual(["in memory"]);
  });
});

function openOverlay() {
  render(<AiInlinePromptOverlay />);
  let promise!: Promise<string | null>;
  act(() => {
    promise = openAiPrompt("Rewrite how?");
  });
  return { input: screen.getByRole("textbox") as HTMLInputElement, promise };
}

describe("AiInlinePromptOverlay history navigation", () => {
  it("records submitted prompts", async () => {
    const { input, promise } = openOverlay();
    fireEvent.change(input, { target: { value: "make it shorter" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await expect(promise).resolves.toBe("make it shorter");
    expect(getAiPromptHistory()).toEqual(["make it shorter"]);
  });

  it("ArrowUp / ArrowDown cycle through history from an empty input", () => {
    rememberAiPrompt("oldest");
    rememberAiPrompt("middle");
    rememberAiPrompt("newest");
    const { input } = openOverlay();
    expect(screen.getByTestId("ai-prompt-history-hint")).toBeTruthy();

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("newest");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("middle");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("oldest");
    fireEvent.keyDown(input, { key: "ArrowUp" }); // clamps at the oldest
    expect(input.value).toBe("oldest");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("middle");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("newest");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // back to an empty draft
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // no-op when not browsing
    expect(input.value).toBe("");
  });

  it("does not overwrite text the user is typing", () => {
    rememberAiPrompt("from history");
    const { input } = openOverlay();
    fireEvent.change(input, { target: { value: "my draft" } });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("my draft");
  });

  it("editing a recalled prompt leaves history mode", () => {
    rememberAiPrompt("a");
    rememberAiPrompt("b");
    const { input } = openOverlay();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("b");
    fireEvent.change(input, { target: { value: "b edited" } });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("b edited");
  });

  it("hides the history hint when there is no history", () => {
    openOverlay();
    expect(screen.queryByTestId("ai-prompt-history-hint")).toBeNull();
  });
});
