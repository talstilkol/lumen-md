/**
 * welcome.ts — pin the section numbering against source order.
 *
 * The Outline panel reads top-level H2 headings in document order, so if
 * `## 12. Foo` physically precedes `## 11. Bar` in welcome.ts, the
 * outline displays "12" above "11" — which is exactly what happened in
 * round-11's M6 screenshot capture (visible bug). This test scans the
 * exported WELCOME_DOC and asserts that the numeric prefix of each H2
 * matches its physical order.
 */
import { describe, it, expect } from "vitest";
import { WELCOME_DOC } from "../welcome";

describe("WELCOME_DOC heading ordering", () => {
  it("H2 numeric prefixes are in ascending physical order", () => {
    const numbers: number[] = [];
    for (const line of WELCOME_DOC.split("\n")) {
      const match = /^##\s+(\d+)\.\s+/.exec(line);
      if (match) numbers.push(Number(match[1]));
    }
    expect(numbers.length).toBeGreaterThan(0);
    for (let i = 1; i < numbers.length; i += 1) {
      expect(
        numbers[i],
        `Heading #${numbers[i]} appears after #${numbers[i - 1]} — out of order`,
      ).toBeGreaterThan(numbers[i - 1]);
    }
  });

  it("H2 numbers are contiguous (no gaps)", () => {
    const numbers: number[] = [];
    for (const line of WELCOME_DOC.split("\n")) {
      const match = /^##\s+(\d+)\.\s+/.exec(line);
      if (match) numbers.push(Number(match[1]));
    }
    expect(numbers[0]).toBe(1);
    for (let i = 1; i < numbers.length; i += 1) {
      expect(
        numbers[i],
        `Gap detected: ${numbers[i - 1]} → ${numbers[i]}`,
      ).toBe(numbers[i - 1] + 1);
    }
  });
});
