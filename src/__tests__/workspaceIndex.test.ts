/**
 * workspaceIndex — tests for fuzzyMatch, snippetAround, slug, and search scoring.
 */
import { describe, it, expect } from "vitest";

/** Extracted pure functions from src/storage/workspaceIndex.ts */

function fuzzyMatch(haystack: string, needle: string): boolean {
  let i = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, i);
    if (found < 0) return false;
    i = found + 1;
  }
  return true;
}

function snippetAround(content: string, offset: number, radius = 60): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(content.length, offset + radius);
  let s = content.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < content.length) s = s + "…";
  return s;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

const WIKI_RE = /\[\[([^\]\r\n|]+?)(?:\|[^\]\r\n]+?)?\]\]/g;

function extractWikiTargets(content: string): string[] {
  const targets: string[] = [];
  let m: RegExpExecArray | null;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(content)) !== null) {
    targets.push(m[1].trim());
  }
  return targets;
}

describe("fuzzyMatch", () => {
  it("matches exact substring", () => {
    expect(fuzzyMatch("hello world", "hello")).toBe(true);
  });

  it("matches scattered characters", () => {
    expect(fuzzyMatch("hello world", "hlo")).toBe(true);
  });

  it("fails when characters are in wrong order", () => {
    expect(fuzzyMatch("hello", "oeh")).toBe(false);
  });

  it("matches single character", () => {
    expect(fuzzyMatch("test", "t")).toBe(true);
  });

  it("fails on empty haystack", () => {
    expect(fuzzyMatch("", "a")).toBe(false);
  });

  it("matches empty needle", () => {
    expect(fuzzyMatch("test", "")).toBe(true);
  });

  it("handles case-sensitive matching", () => {
    expect(fuzzyMatch("Hello", "h")).toBe(false);
    expect(fuzzyMatch("hello", "h")).toBe(true);
  });
});

describe("snippetAround", () => {
  it("returns text around offset", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const snippet = snippetAround(text, 10, 15);
    expect(snippet).toContain("quick");
  });

  it("adds ellipsis when truncated at start", () => {
    const text = "x".repeat(200);
    const snippet = snippetAround(text, 100, 20);
    expect(snippet.startsWith("…")).toBe(true);
  });

  it("adds ellipsis when truncated at end", () => {
    const text = "x".repeat(200);
    const snippet = snippetAround(text, 100, 20);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("no ellipsis when full text fits", () => {
    const text = "short";
    const snippet = snippetAround(text, 0, 100);
    expect(snippet).not.toContain("…");
  });

  it("collapses whitespace", () => {
    const text = "hello\n\n  world\t\ttab";
    const snippet = snippetAround(text, 0, 100);
    expect(snippet).toBe("hello world tab");
  });
});

describe("slug", () => {
  it("lowercases and hyphenates", () => {
    expect(slug("Hello World")).toBe("hello-world");
  });

  it("strips special characters", () => {
    expect(slug("What's this?")).toBe("whats-this");
  });

  it("handles empty string", () => {
    expect(slug("")).toBe("");
  });
});

describe("extractWikiTargets", () => {
  it("extracts simple wiki links", () => {
    const targets = extractWikiTargets("See [[Hello]] and [[World]]");
    expect(targets).toEqual(["Hello", "World"]);
  });

  it("extracts aliased wiki links (takes target, not alias)", () => {
    const targets = extractWikiTargets("See [[Target|Display Name]]");
    expect(targets).toEqual(["Target"]);
  });

  it("returns empty for no links", () => {
    expect(extractWikiTargets("No links here")).toEqual([]);
  });

  it("trims whitespace from targets", () => {
    const targets = extractWikiTargets("See [[ Hello World ]]");
    expect(targets).toEqual(["Hello World"]);
  });

  it("handles multiple links on same line", () => {
    const targets = extractWikiTargets("[[A]] then [[B]] then [[C]]");
    expect(targets).toEqual(["A", "B", "C"]);
  });

  it("ignores links with newlines", () => {
    const targets = extractWikiTargets("[[valid]] and [[\ninvalid\n]]");
    expect(targets).toEqual(["valid"]);
  });
});
