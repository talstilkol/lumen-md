/**
 * tagsFromFrontmatter — tests against the REAL src/views/tagsIndex.ts
 * implementation. Earlier this file forked the logic, which is theatre:
 * could pass while the real one regressed.
 */
import { describe, it, expect } from "vitest";
import { tagsFromFrontmatter } from "../views/tagsIndex";

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
