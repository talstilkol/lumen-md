/**
 * fs — tests for the convertImported file-to-markdown transformation logic.
 *
 * Imports the REAL convertImported from src/storage/fs.ts rather than a
 * local re-implementation, so any regression to the production code
 * fails this suite. The previous version forked the implementation,
 * which is theatre — could pass while production was broken.
 */
import { describe, it, expect } from "vitest";
import { convertImported, importFile } from "../storage/fs";

// jsdom's File doesn't implement .text()/.arrayBuffer(), so provide a minimal
// stand-in exposing the members fileToMarkdown actually uses.
function makeFile(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    text: async () => text,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as File;
}

describe("convertImported", () => {
  it("wraps CSV in a csv fence", () => {
    const result = convertImported("data.csv", "a,b\n1,2\n3,4");
    expect(result).toContain("```csv");
    expect(result).toContain('title="data.csv"');
    expect(result).toContain("a,b\n1,2\n3,4");
  });

  it("wraps TSV in a tsv fence", () => {
    const result = convertImported("data.tsv", "a\tb\n1\t2");
    expect(result).toContain("```tsv");
    expect(result).toContain('title="data.tsv"');
  });

  it("wraps JSON array in json-table fence", () => {
    const json = JSON.stringify([{ name: "Alice" }, { name: "Bob" }]);
    const result = convertImported("users.json", json);
    expect(result).toContain("```json-table");
  });

  it("wraps JSON object in json fence", () => {
    const json = JSON.stringify({ name: "Alice" });
    const result = convertImported("config.json", json);
    expect(result).toContain("```json");
    expect(result).not.toContain("json-table");
  });

  it("handles malformed JSON gracefully", () => {
    const result = convertImported("bad.json", "{ not json }}}");
    expect(result).toContain("```json");
    expect(result).not.toContain("json-table");
  });

  it("passes through .md as raw", () => {
    const md = "# Hello\n\nWorld";
    expect(convertImported("readme.md", md)).toBe(md);
  });

  it("passes through .txt as raw", () => {
    const txt = "Plain text";
    expect(convertImported("notes.txt", txt)).toBe(txt);
  });

  it("trims whitespace from CSV content", () => {
    const result = convertImported("data.csv", "\n  a,b\n1,2  \n");
    expect(result).toContain("a,b\n1,2");
  });

  it("is case-insensitive on extensions", () => {
    const result = convertImported("DATA.CSV", "a,b");
    expect(result).toContain("```csv");
  });

  it("creates a heading from filename", () => {
    const result = convertImported("my-data.csv", "a,b");
    expect(result).toContain("# my-data.csv");
  });
});

describe("importFile — routes through the real converter library", () => {
  it("converts LaTeX sections to markdown headings (not raw passthrough)", async () => {
    const tex =
      "\\begin{document}\n\\section{Intro}\n\\textbf{bold} text\n\\end{document}";
    const { content } = await importFile(makeFile("paper.tex", tex));
    expect(content).toContain("## Intro");
    expect(content).toContain("**bold**");
    expect(content).not.toContain("\\section");
  });

  it("converts Org-mode headings and code fences", async () => {
    const org = "* Title\n#+BEGIN_SRC js\nconsole.log(1)\n#+END_SRC";
    const { content } = await importFile(makeFile("notes.org", org));
    expect(content).toContain("# Title");
    expect(content).toContain("```");
    expect(content).not.toContain("#+BEGIN_SRC");
  });

  it("converts OPML outlines into a nested markdown list", async () => {
    const opml =
      '<?xml version="1.0"?><opml><head><title>Map</title></head>' +
      '<body><outline text="A"><outline text="A1"/></outline></body></opml>';
    const { content } = await importFile(makeFile("map.opml", opml));
    expect(content).toContain("# Map");
    expect(content).toContain("- A");
    expect(content).toContain("  - A1");
  });

  it("still routes csv through the interactive Lumen block", async () => {
    const { content } = await importFile(makeFile("d.csv", "a,b\n1,2"));
    expect(content).toContain("```csv");
  });
});
