/**
 * tagsFromFrontmatter — tests for the tag parser used by TagsPanel.
 */
import { describe, it, expect } from "vitest";

/** Extracted from src/views/tagsIndex.ts for unit testing. */
function tagsFromFrontmatter(fm: unknown): string[] {
  if (!fm || typeof fm !== "object") return [];
  const tags = (fm as Record<string, unknown>).tags;
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).toLowerCase()).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").toLowerCase())
      .filter(Boolean);
  }
  return [];
}

describe("tagsFromFrontmatter", () => {
  it("parses array of tags", () => {
    const fm = { tags: ["JavaScript", "React", "TypeScript"] };
    expect(tagsFromFrontmatter(fm)).toEqual(["javascript", "react", "typescript"]);
  });

  it("parses comma-separated string", () => {
    const fm = { tags: "JavaScript, React, TypeScript" };
    expect(tagsFromFrontmatter(fm)).toEqual(["javascript", "react", "typescript"]);
  });

  it("strips # prefix", () => {
    const fm = { tags: "#JavaScript, #React" };
    expect(tagsFromFrontmatter(fm)).toEqual(["javascript", "react"]);
  });

  it("returns empty for null frontmatter", () => {
    expect(tagsFromFrontmatter(null)).toEqual([]);
  });

  it("returns empty for missing tags field", () => {
    expect(tagsFromFrontmatter({ title: "Hello" })).toEqual([]);
  });

  it("returns empty for non-object", () => {
    expect(tagsFromFrontmatter("string")).toEqual([]);
    expect(tagsFromFrontmatter(42)).toEqual([]);
  });

  it("filters empty entries", () => {
    expect(tagsFromFrontmatter({ tags: ["", "valid", ""] })).toEqual(["valid"]);
  });

  it("lowercases all tags", () => {
    expect(tagsFromFrontmatter({ tags: ["UPPER", "MiXeD"] })).toEqual(["upper", "mixed"]);
  });

  it("handles mixed separators", () => {
    expect(tagsFromFrontmatter({ tags: "a, b  c,,d" })).toEqual(["a", "b", "c", "d"]);
  });
});

describe("TagBucket sorting", () => {
  it("sorts by count desc then name asc", () => {
    const buckets = [
      { tag: "zebra", count: 1 },
      { tag: "apple", count: 3 },
      { tag: "mango", count: 3 },
      { tag: "banana", count: 2 },
    ];
    const sorted = buckets.sort(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
    );
    expect(sorted.map((b) => b.tag)).toEqual(["apple", "mango", "banana", "zebra"]);
  });
});
