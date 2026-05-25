/**
 * Outline — tests for the TOC extraction logic used by the Outline panel.
 */
import { describe, it, expect } from "vitest";
import { extractToc } from "../renderer/pipeline";

describe("extractToc", () => {
  it("extracts headings from markdown", () => {
    const md = "# Title\n\n## Section 1\n\n### Sub\n\n## Section 2";
    const toc = extractToc(md);
    expect(toc).toHaveLength(4);
    expect(toc[0].text).toBe("Title");
    expect(toc[0].depth).toBe(1);
    expect(toc[1].text).toBe("Section 1");
    expect(toc[1].depth).toBe(2);
    expect(toc[2].text).toBe("Sub");
    expect(toc[2].depth).toBe(3);
  });

  it("returns empty array for no headings", () => {
    expect(extractToc("Just some text")).toEqual([]);
  });

  it("generates slugified IDs", () => {
    const toc = extractToc("# Hello World\n\n## Test Section");
    expect(toc[0].id).toBe("hello-world");
    expect(toc[1].id).toBe("test-section");
  });

  it("handles code fences correctly (no false headings)", () => {
    const md = "# Real\n\n```\n# Not a heading\n```\n\n## Also Real";
    const toc = extractToc(md);
    const texts = toc.map((h) => h.text);
    expect(texts).toContain("Real");
    expect(texts).toContain("Also Real");
    expect(texts).not.toContain("Not a heading");
  });

  it("handles empty input", () => {
    expect(extractToc("")).toEqual([]);
  });

  it("handles heading with inline formatting", () => {
    const toc = extractToc("# **Bold** and *italic* title");
    expect(toc).toHaveLength(1);
    // Text should be stripped of formatting
    expect(toc[0].text).toContain("Bold");
  });
});
