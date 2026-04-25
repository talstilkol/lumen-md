/**
 * Unit tests for core Lumen modules.
 *
 * Run with: npx vitest run
 * Requires: npm install -D vitest jsdom
 */

import { describe, it, expect } from "vitest";
import { csvToMarkdown, tsvToMarkdown, jsonToMarkdown, xmlToMarkdown, htmlToMarkdown, rtfToMarkdown } from "../storage/fileFormats";

describe("csvToMarkdown", () => {
  it("converts simple CSV to markdown table", () => {
    const csv = "Name,Age,City\nAlice,30,NYC\nBob,25,LA";
    const md = csvToMarkdown(csv);
    expect(md).toContain("| Name | Age | City |");
    expect(md).toContain("| --- | --- | --- |");
    expect(md).toContain("| Alice | 30 | NYC |");
    expect(md).toContain("| Bob | 25 | LA |");
  });

  it("handles quoted fields with commas", () => {
    const csv = 'Name,Location\n"Doe, John","New York, NY"';
    const md = csvToMarkdown(csv);
    expect(md).toContain("Doe, John");
    expect(md).toContain("New York, NY");
  });

  it("handles empty CSV", () => {
    expect(csvToMarkdown("")).toBe("");
  });
});

describe("tsvToMarkdown", () => {
  it("converts TSV to markdown table", () => {
    const tsv = "A\tB\n1\t2";
    const md = tsvToMarkdown(tsv);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| 1 | 2 |");
  });
});

describe("jsonToMarkdown", () => {
  it("converts array of objects to table", () => {
    const json = JSON.stringify([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ]);
    const md = jsonToMarkdown(json);
    expect(md).toContain("| name | age |");
    expect(md).toContain("| Alice | 30 |");
  });

  it("renders non-array JSON as code block", () => {
    const json = JSON.stringify({ key: "value" });
    const md = jsonToMarkdown(json);
    expect(md).toContain("```json");
  });

  it("handles invalid JSON gracefully", () => {
    const md = jsonToMarkdown("not json");
    expect(md).toContain("```");
  });
});

describe("xmlToMarkdown", () => {
  it("converts table-like XML to markdown table", () => {
    const xml = "<data><row><name>Alice</name><age>30</age></row><row><name>Bob</name><age>25</age></row></data>";
    const md = xmlToMarkdown(xml);
    expect(md).toContain("| name | age |");
    expect(md).toContain("| Alice | 30 |");
  });

  it("renders non-table XML as code block", () => {
    const xml = "<root><a>1</a><b>2</b></root>";
    const md = xmlToMarkdown(xml);
    // Mixed tag names → code block fallback
    expect(md).toContain("```xml");
  });
});

describe("htmlToMarkdown", () => {
  it("converts headings", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toContain("# Title");
    expect(htmlToMarkdown("<h2>Sub</h2>")).toContain("## Sub");
  });

  it("converts bold and italic", () => {
    expect(htmlToMarkdown("<b>bold</b>")).toContain("**bold**");
    expect(htmlToMarkdown("<em>italic</em>")).toContain("*italic*");
  });

  it("converts links", () => {
    const md = htmlToMarkdown('<a href="https://example.com">Link</a>');
    expect(md).toContain("[Link](https://example.com)");
  });

  it("converts images", () => {
    const md = htmlToMarkdown('<img src="img.png" alt="Photo">');
    expect(md).toContain("![Photo](img.png)");
  });

  it("converts lists", () => {
    const md = htmlToMarkdown("<ul><li>A</li><li>B</li></ul>");
    expect(md).toContain("- A");
    expect(md).toContain("- B");
  });

  it("converts code blocks", () => {
    const md = htmlToMarkdown("<pre><code>const x = 1;</code></pre>");
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });
});

describe("rtfToMarkdown", () => {
  it("strips RTF control words", () => {
    const rtf = "{\\rtf1\\ansi Hello \\par World}";
    const md = rtfToMarkdown(rtf);
    expect(md).toContain("Hello");
    expect(md).toContain("World");
  });
});
