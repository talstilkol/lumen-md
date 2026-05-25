import { describe, it, expect } from "vitest";
import { BLOCK_SNIPPETS } from "../snippets";

describe("BLOCK_SNIPPETS", () => {
  it("exports an object", () => {
    expect(typeof BLOCK_SNIPPETS).toBe("object");
    expect(BLOCK_SNIPPETS).not.toBeNull();
  });

  it("has a chart snippet", () => {
    expect(typeof BLOCK_SNIPPETS.chart).toBe("string");
    expect(BLOCK_SNIPPETS.chart).toContain("```chart");
  });

  it("has a csv snippet", () => {
    expect(typeof BLOCK_SNIPPETS.csv).toBe("string");
    expect(BLOCK_SNIPPETS.csv).toContain("```csv");
  });

  it("has a jsonTable snippet", () => {
    expect(typeof BLOCK_SNIPPETS.jsonTable).toBe("string");
    expect(BLOCK_SNIPPETS.jsonTable).toContain("```json-table");
  });

  it("has a mermaid snippet", () => {
    expect(typeof BLOCK_SNIPPETS.mermaid).toBe("string");
    expect(BLOCK_SNIPPETS.mermaid).toContain("```mermaid");
  });

  it("has a math snippet", () => {
    expect(typeof BLOCK_SNIPPETS.math).toBe("string");
    expect(BLOCK_SNIPPETS.math).toContain("$$");
  });

  it("has a graphviz snippet", () => {
    expect(typeof BLOCK_SNIPPETS.graphviz).toBe("string");
    expect(BLOCK_SNIPPETS.graphviz).toContain("```dot");
  });

  it("has a map snippet", () => {
    expect(typeof BLOCK_SNIPPETS.map).toBe("string");
    expect(BLOCK_SNIPPETS.map.length).toBeGreaterThan(10);
  });

  it("has a note snippet", () => {
    expect(typeof BLOCK_SNIPPETS.note).toBe("string");
    expect(BLOCK_SNIPPETS.note.length).toBeGreaterThan(10);
  });

  it("all snippets are non-empty strings", () => {
    for (const [_key, val] of Object.entries(BLOCK_SNIPPETS)) {
      expect(typeof val).toBe("string");
      expect((val as string).length).toBeGreaterThan(0);
    }
  });
});
