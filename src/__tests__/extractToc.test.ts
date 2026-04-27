import { describe, it, expect } from "vitest";
import { extractToc } from "../renderer/pipeline";

describe("extractToc", () => {
  it("returns an entry per heading with depth and slug", () => {
    const md = "# Title\n\n## Section A\n\n### Sub A1\n\n## Section B";
    const toc = extractToc(md);
    expect(toc).toEqual([
      { depth: 1, text: "Title", id: "title" },
      { depth: 2, text: "Section A", id: "section-a" },
      { depth: 3, text: "Sub A1", id: "sub-a1" },
      { depth: 2, text: "Section B", id: "section-b" },
    ]);
  });

  it("skips YAML frontmatter — does not surface 'title:' as a heading", () => {
    const md = `---
title: Welcome
author: Tal
---

# Welcome
`;
    const toc = extractToc(md);
    expect(toc).toHaveLength(1);
    expect(toc[0].text).toBe("Welcome");
  });

  it("skips TOML frontmatter (+++ delimiters)", () => {
    const md = `+++
title = "X"
+++

# Real Heading
`;
    const toc = extractToc(md);
    expect(toc).toEqual([{ depth: 1, text: "Real Heading", id: "real-heading" }]);
  });

  it("returns an empty array for empty markdown", () => {
    expect(extractToc("")).toEqual([]);
    expect(extractToc("\n\n   \n")).toEqual([]);
  });

  it("ignores headings that resolve to whitespace-only text", () => {
    const md = "# \n## Real\n";
    const toc = extractToc(md);
    expect(toc).toEqual([{ depth: 2, text: "Real", id: "real" }]);
  });
});
