/**
 * WritingGoalBanner — unit tests for the pure `countWords` logic
 * (extracted via the same algorithm used in the component).
 */
import { describe, it, expect } from "vitest";

/** Replicate the countWords function from WritingGoalBanner.tsx */
function countWords(s: string): number {
  const stripped = s
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "");
  const matches = stripped.match(/[\p{L}\p{N}']+/gu);
  return matches ? matches.length : 0;
}

describe("countWords", () => {
  it("counts English words", () => {
    expect(countWords("Hello world")).toBe(2);
  });

  it("counts Hebrew words", () => {
    expect(countWords("שלום עולם")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("strips code fences", () => {
    const md = "Hello\n\n```js\nconst x = 1;\n```\n\nworld";
    expect(countWords(md)).toBe(2); // Only "Hello" and "world"
  });

  it("strips inline code", () => {
    expect(countWords("Use `npm install` to setup")).toBe(3); // "Use", "to", "setup"
  });

  it("handles mixed content", () => {
    const md = "# Title\n\nSome text with `code` and more.\n\n```\nignored\n```\n\nEnd.";
    expect(countWords(md)).toBe(7); // Title, Some, text, with, and, more, End
  });

  it("counts contractions as single words", () => {
    expect(countWords("don't won't can't")).toBe(3);
  });

  it("handles numbers", () => {
    expect(countWords("There are 42 items")).toBe(4);
  });

  it("handles only whitespace", () => {
    expect(countWords("   \n\n\t  ")).toBe(0);
  });

  it("handles percentage calculation", () => {
    const goal = 500;
    const words = countWords("a ".repeat(250));
    const pct = Math.min(100, Math.round((words / goal) * 100));
    expect(pct).toBe(50);
  });
});
