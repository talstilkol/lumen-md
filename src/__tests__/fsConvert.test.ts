/**
 * fs — tests for the convertImported file-to-markdown transformation logic.
 *
 * Imports the REAL convertImported from src/storage/fs.ts rather than a
 * local re-implementation, so any regression to the production code
 * fails this suite. The previous version forked the implementation,
 * which is theatre — could pass while production was broken.
 */
import { describe, it, expect } from "vitest";
import { convertImported } from "../storage/fs";

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
