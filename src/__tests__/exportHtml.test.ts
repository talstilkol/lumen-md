/**
 * exportHtml — tests for the escapeHtml function.
 */
import { describe, it, expect } from "vitest";

/** Extracted from src/storage/exportHtml.ts */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

describe("escapeHtml", () => {
  it("escapes ampersand", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;",
    );
  });

  it("escapes quotes", () => {
    expect(escapeHtml('He said "hello"')).toBe("He said &quot;hello&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("handles safe text unchanged", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });

  it("handles multiple escapes in one string", () => {
    expect(escapeHtml('<a href="test">&</a>')).toBe(
      '&lt;a href=&quot;test&quot;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe("export filename sanitization", () => {
  function sanitizeFilename(filename: string): string {
    return (filename.replace(/\.(md|markdown)$/i, "") || "document") + ".html";
  }

  it("converts .md to .html", () => {
    expect(sanitizeFilename("notes.md")).toBe("notes.html");
  });

  it("converts .markdown to .html", () => {
    expect(sanitizeFilename("notes.markdown")).toBe("notes.html");
  });

  it("preserves name without extension", () => {
    expect(sanitizeFilename("report")).toBe("report.html");
  });

  it("handles empty string", () => {
    expect(sanitizeFilename("")).toBe("document.html");
  });

  it("case insensitive extension", () => {
    expect(sanitizeFilename("notes.MD")).toBe("notes.html");
  });
});
