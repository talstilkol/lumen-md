/**
 * SearchReplace — unit tests for the match-finding and replace logic.
 */
import { describe, it, expect } from "vitest";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatches(
  content: string,
  query: string,
  isRegex: boolean,
  caseSensitive: boolean,
): { start: number; end: number }[] {
  if (!query) return [];
  try {
    const flags = caseSensitive ? "g" : "gi";
    const re = isRegex ? new RegExp(query, flags) : new RegExp(escapeRegex(query), flags);
    const results: { start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      results.push({ start: m.index, end: m.index + m[0].length });
      if (results.length > 5000) break;
    }
    return results;
  } catch {
    return [];
  }
}

function replaceOne(
  content: string,
  matches: { start: number; end: number }[],
  currentIndex: number,
  replacement: string,
): string {
  if (matches.length === 0 || !matches[currentIndex]) return content;
  const m = matches[currentIndex];
  return content.slice(0, m.start) + replacement + content.slice(m.end);
}

function replaceAll(
  content: string,
  matches: { start: number; end: number }[],
  replacement: string,
): string {
  if (matches.length === 0) return content;
  let result = content;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    result = result.slice(0, m.start) + replacement + result.slice(m.end);
  }
  return result;
}

describe("findMatches", () => {
  it("finds literal matches", () => {
    const m = findMatches("hello world hello", "hello", false, false);
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual({ start: 0, end: 5 });
    expect(m[1]).toEqual({ start: 12, end: 17 });
  });

  it("case-insensitive by default", () => {
    const m = findMatches("Hello HELLO hello", "hello", false, false);
    expect(m).toHaveLength(3);
  });

  it("case-sensitive when enabled", () => {
    const m = findMatches("Hello HELLO hello", "hello", false, true);
    expect(m).toHaveLength(1);
    expect(m[0]).toEqual({ start: 12, end: 17 });
  });

  it("handles regex mode", () => {
    const m = findMatches("foo123bar456baz", "\\d+", true, false);
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual({ start: 3, end: 6 });
    expect(m[1]).toEqual({ start: 9, end: 12 });
  });

  it("returns empty for empty query", () => {
    expect(findMatches("hello", "", false, false)).toEqual([]);
  });

  it("returns empty for invalid regex", () => {
    expect(findMatches("hello", "[invalid", true, false)).toEqual([]);
  });

  it("escapes special characters in literal mode", () => {
    const m = findMatches("a.b.c", ".", false, false);
    expect(m).toHaveLength(2); // literal dots at index 1 and 3
    expect(m[0]).toEqual({ start: 1, end: 2 });
    expect(m[1]).toEqual({ start: 3, end: 4 });
  });

  it("caps at 5001 results (break after push)", () => {
    const content = "a".repeat(10000);
    const m = findMatches(content, "a", false, false);
    expect(m.length).toBeLessThanOrEqual(5001);
  });
});

describe("replaceOne", () => {
  it("replaces the match at currentIndex", () => {
    const content = "aaa bbb aaa";
    const matches = findMatches(content, "aaa", false, false);
    expect(replaceOne(content, matches, 0, "xxx")).toBe("xxx bbb aaa");
    expect(replaceOne(content, matches, 1, "xxx")).toBe("aaa bbb xxx");
  });

  it("returns unchanged content for empty matches", () => {
    expect(replaceOne("hello", [], 0, "xxx")).toBe("hello");
  });
});

describe("replaceAll", () => {
  it("replaces all matches", () => {
    const content = "foo bar foo baz foo";
    const matches = findMatches(content, "foo", false, false);
    expect(replaceAll(content, matches, "qux")).toBe("qux bar qux baz qux");
  });

  it("handles replacement with different length", () => {
    const content = "aa bb aa";
    const matches = findMatches(content, "aa", false, false);
    expect(replaceAll(content, matches, "longer")).toBe("longer bb longer");
  });

  it("handles empty replacement", () => {
    const content = "foo bar foo";
    const matches = findMatches(content, "foo", false, false);
    expect(replaceAll(content, matches, "")).toBe(" bar ");
  });

  it("returns unchanged for no matches", () => {
    expect(replaceAll("hello", [], "x")).toBe("hello");
  });
});

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    expect(escapeRegex("a.b")).toBe("a\\.b");
    expect(escapeRegex("a*b+c?")).toBe("a\\*b\\+c\\?");
    expect(escapeRegex("(foo)")).toBe("\\(foo\\)");
    expect(escapeRegex("[bar]")).toBe("\\[bar\\]");
    expect(escapeRegex("a{1}")).toBe("a\\{1\\}");
    expect(escapeRegex("$100")).toBe("\\$100");
    expect(escapeRegex("^start")).toBe("\\^start");
    expect(escapeRegex("a|b")).toBe("a\\|b");
    expect(escapeRegex("path\\to")).toBe("path\\\\to");
  });
});
