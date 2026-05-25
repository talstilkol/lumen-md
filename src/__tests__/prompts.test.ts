import { describe, it, expect } from "vitest";
import { PROMPTS } from "../ai/prompts";

describe("PROMPTS", () => {
  it("exports PROMPTS object", () => {
    expect(PROMPTS).toBeDefined();
    expect(typeof PROMPTS).toBe("object");
  });

  it("has a ghostwriter prompt", () => {
    expect(typeof PROMPTS.ghostwriter).toBe("string");
    expect(PROMPTS.ghostwriter.length).toBeGreaterThan(10);
  });

  it("has a rewrite prompt", () => {
    expect(typeof PROMPTS.rewrite).toBe("string");
    expect(PROMPTS.rewrite.length).toBeGreaterThan(10);
  });

  it("has an autocomplete prompt", () => {
    expect(typeof PROMPTS.autocomplete).toBe("string");
    expect(PROMPTS.autocomplete.toLowerCase()).toContain("autocomplete");
  });

  it("has a visualization prompt", () => {
    expect(typeof PROMPTS.visualization).toBe("string");
    expect(PROMPTS.visualization).toContain("ECharts");
  });

  it("has a ragAssistant prompt", () => {
    expect(typeof PROMPTS.ragAssistant).toBe("string");
    expect(PROMPTS.ragAssistant.length).toBeGreaterThan(10);
  });

  it("has a commitMessage prompt", () => {
    expect(typeof PROMPTS.commitMessage).toBe("string");
    expect(PROMPTS.commitMessage.toLowerCase()).toContain("commit");
  });

  it("has a summarize prompt", () => {
    expect(typeof PROMPTS.summarize).toBe("string");
    expect(PROMPTS.summarize.toLowerCase()).toContain("summar");
  });

  it("ghostwriter does not instruct to add code fences", () => {
    // It explicitly says NOT to add code fences around the response
    expect(PROMPTS.ghostwriter).toContain("without surrounding code fences");
  });

  it("autocomplete asks for max 10 words", () => {
    expect(PROMPTS.autocomplete).toContain("10 words");
  });
});
