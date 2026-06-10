import { describe, it, expect } from "vitest";
import { splitFrontmatter } from "../editor/WysiwygEditor";

describe("splitFrontmatter (WYSIWYG frontmatter preservation)", () => {
  it("splits a leading YAML block verbatim and the body re-concatenates exactly", () => {
    const md = "---\ntitle: Hi\ntags: [a, b]\n---\n\n# Heading\n\nbody";
    const { fm, body } = splitFrontmatter(md);
    expect(fm).toBe("---\ntitle: Hi\ntags: [a, b]\n---\n");
    expect(body).toBe("\n# Heading\n\nbody");
    expect(fm + body).toBe(md); // lossless round-trip
  });

  it("returns the whole doc as body when there is no frontmatter", () => {
    const md = "# Just a doc\n\n---\n\nwith a thematic break";
    const { fm, body } = splitFrontmatter(md);
    expect(fm).toBe("");
    expect(body).toBe(md);
  });

  it("does not treat a mid-document --- pair as frontmatter", () => {
    const md = "intro text\n---\nkey: value\n---\n";
    expect(splitFrontmatter(md).fm).toBe("");
  });

  it("handles CRLF line endings", () => {
    const md = "---\r\ntitle: X\r\n---\r\nbody";
    const { fm, body } = splitFrontmatter(md);
    expect(fm).toBe("---\r\ntitle: X\r\n---\r\n");
    expect(body).toBe("body");
  });

  it("handles a frontmatter-only document", () => {
    const md = "---\ntitle: X\n---";
    const { fm, body } = splitFrontmatter(md);
    expect(fm).toBe("---\ntitle: X\n---");
    expect(body).toBe("");
  });
});
