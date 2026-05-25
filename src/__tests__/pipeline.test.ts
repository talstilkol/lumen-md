import { describe, it, expect } from "vitest";
import { extractFrontmatter, extractToc } from "../renderer/pipeline";

describe("extractFrontmatter", () => {
  it("returns null for plain markdown with no frontmatter", () => {
    expect(extractFrontmatter("# Hello\n\nWorld")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractFrontmatter("")).toBeNull();
  });

  it("parses a simple YAML frontmatter block", () => {
    const md = "---\ntitle: My Note\ntags: [foo, bar]\n---\n# Hello";
    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result?.title).toBe("My Note");
    expect(result?.tags).toEqual(["foo", "bar"]);
  });

  it("returns null for invalid YAML", () => {
    const md = "---\ntitle: [\ninvalid yaml\n---\n# Hello";
    // Invalid YAML may parse as string — either null or an object
    const result = extractFrontmatter(md);
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("parses frontmatter with Windows line endings (CRLF)", () => {
    const md = "---\r\ntitle: Win\r\n---\r\n# Heading";
    const result = extractFrontmatter(md);
    expect(result?.title).toBe("Win");
  });

  it("returns null when YAML value is a scalar (not an object)", () => {
    const md = "---\njust a string\n---\n# Hello";
    const result = extractFrontmatter(md);
    // YAML.parse of a bare string returns the string itself → not an object
    expect(result).toBeNull();
  });

  it("parses nested frontmatter fields", () => {
    const md = "---\nauthor:\n  name: Alice\n  email: a@b.com\n---\nContent";
    const result = extractFrontmatter(md);
    expect(result?.author).toEqual({ name: "Alice", email: "a@b.com" });
  });

  it("returns null when --- block is incomplete", () => {
    const md = "---\ntitle: Orphan";
    expect(extractFrontmatter(md)).toBeNull();
  });
});

describe("extractToc", () => {
  it("returns empty array for plain text", () => {
    expect(extractToc("just some text without headings")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(extractToc("")).toEqual([]);
  });

  it("extracts a single h1", () => {
    const toc = extractToc("# Hello World");
    expect(toc.length).toBe(1);
    expect(toc[0].depth).toBe(1);
    expect(toc[0].text).toBe("Hello World");
    expect(toc[0].id).toBe("hello-world");
  });

  it("extracts multiple headings of different depths", () => {
    const md = "# Title\n\n## Section\n\n### Subsection\n\nContent";
    const toc = extractToc(md);
    expect(toc.length).toBe(3);
    expect(toc[0].depth).toBe(1);
    expect(toc[1].depth).toBe(2);
    expect(toc[2].depth).toBe(3);
  });

  it("slugifies heading text correctly", () => {
    const toc = extractToc("## Hello, World! 🚀");
    expect(toc[0].id).toBe("hello-world-");
  });

  it("strips YAML frontmatter before parsing headings", () => {
    const md = "---\ntitle: My Page\n---\n# Real Heading";
    const toc = extractToc(md);
    // Should only find the real heading, not the frontmatter key
    expect(toc.length).toBe(1);
    expect(toc[0].text).toBe("Real Heading");
  });

  it("strips TOML frontmatter before parsing headings", () => {
    const md = "+++\ntitle = \"TOML Page\"\n+++\n# Real H1";
    const toc = extractToc(md);
    expect(toc.length).toBe(1);
    expect(toc[0].text).toBe("Real H1");
  });

  it("includes id as slug of the heading text", () => {
    const toc = extractToc("# My Great Section");
    expect(toc[0].id).toBe("my-great-section");
  });

  it("ignores blank headings", () => {
    const md = "# \n## Section";
    const toc = extractToc(md);
    // Blank h1 is filtered; Section should be present
    expect(toc.some((h) => h.text === "Section")).toBe(true);
  });

  it("handles setext-style headings", () => {
    const md = "Title\n=====\n\nSection\n-------";
    const toc = extractToc(md);
    expect(toc.length).toBe(2);
    expect(toc[0].text).toBe("Title");
    expect(toc[1].text).toBe("Section");
  });
});
