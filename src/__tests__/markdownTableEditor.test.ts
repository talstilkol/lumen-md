/**
 * MarkdownTableEditor — tests for table parse + serialize logic.
 */
import { describe, it, expect } from "vitest";

type Alignment = "left" | "center" | "right";

interface ParsedTable {
  headers: string[];
  rows: string[][];
  alignments: Alignment[];
}

function parseTable(md: string): ParsedTable {
  const lines = md.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return { headers: ["Column 1"], rows: [[""]], alignments: ["left"] };

  const parseRow = (line: string) =>
    line.split("|").map((c) => c.trim()).filter(Boolean);

  const headers = parseRow(lines[0]);

  const separators = parseRow(lines[1]);
  const alignments: Alignment[] = separators.map((s) => {
    if (s.startsWith(":") && s.endsWith(":")) return "center";
    if (s.endsWith(":")) return "right";
    return "left";
  });

  const rows = lines.slice(2).map(parseRow);
  const cols = headers.length;
  const normalized = rows.map((r) => {
    while (r.length < cols) r.push("");
    return r.slice(0, cols);
  });

  return { headers, rows: normalized.length ? normalized : [[...Array(cols)].map(() => "")], alignments };
}

function toMarkdown(headers: string[], rows: string[][], alignments: Alignment[]): string {
  const pad = (s: string, len: number) => s.padEnd(len);
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length), 3),
  );

  const headerLine = "| " + headers.map((h, i) => pad(h, colWidths[i])).join(" | ") + " |";
  const sepLine =
    "| " +
    alignments
      .map((a, i) => {
        const w = colWidths[i];
        if (a === "center") return ":" + "-".repeat(w - 2) + ":";
        if (a === "right") return "-".repeat(w - 1) + ":";
        return ":" + "-".repeat(w - 1);
      })
      .join(" | ") +
    " |";
  const dataLines = rows.map(
    (row) => "| " + row.map((c, i) => pad(c, colWidths[i])).join(" | ") + " |",
  );

  return [headerLine, sepLine, ...dataLines].join("\n");
}

describe("parseTable", () => {
  it("parses a basic markdown table", () => {
    const md = `| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |`;
    const result = parseTable(md);
    expect(result.headers).toEqual(["Name", "Age"]);
    expect(result.rows).toEqual([["Alice", "30"], ["Bob", "25"]]);
    expect(result.alignments).toEqual(["left", "left"]);
  });

  it("parses alignment indicators", () => {
    const md = `| Left | Center | Right |
| :--- | :---: | ---: |
| a | b | c |`;
    const result = parseTable(md);
    expect(result.alignments).toEqual(["left", "center", "right"]);
  });

  it("handles missing cells by padding", () => {
    const md = `| A | B | C |
| --- | --- | --- |
| only one |`;
    const result = parseTable(md);
    expect(result.rows[0]).toHaveLength(3);
    expect(result.rows[0][0]).toBe("only one");
    expect(result.rows[0][1]).toBe("");
  });

  it("returns default for invalid input", () => {
    const result = parseTable("not a table");
    expect(result.headers).toEqual(["Column 1"]);
    expect(result.rows).toEqual([[""]]); 
  });

  it("handles empty string", () => {
    const result = parseTable("");
    expect(result.headers).toEqual(["Column 1"]);
  });
});

describe("toMarkdown", () => {
  it("round-trips a simple table", () => {
    const headers = ["Name", "Score"];
    const rows = [["Alice", "100"], ["Bob", "95"]];
    const alignments: Alignment[] = ["left", "right"];
    
    const md = toMarkdown(headers, rows, alignments);
    const parsed = parseTable(md);
    
    expect(parsed.headers).toEqual(headers);
    expect(parsed.rows).toEqual(rows);
    expect(parsed.alignments).toEqual(alignments);
  });

  it("generates properly padded output", () => {
    const md = toMarkdown(["X"], [["Hello"]], ["left"]);
    expect(md).toContain("| Hello |");
  });

  it("handles center alignment in separator", () => {
    const md = toMarkdown(["Col"], [["val"]], ["center"]);
    expect(md).toMatch(/:\-+:/);
  });

  it("handles right alignment in separator", () => {
    const md = toMarkdown(["Col"], [["val"]], ["right"]);
    expect(md).toMatch(/\-+:/);
  });
});
