/**
 * utils — tests for debounce, slugify, and cn utility functions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce, slugify } from "../lib/utils";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips special characters", () => {
    expect(slugify("What's this? (test)")).toBe("whats-this-test");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("a  -  b")).toBe("a-b");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("trims whitespace", () => {
    expect(slugify("  hello world  ")).toBe("hello-world");
  });

  it("preserves hyphens in text", () => {
    expect(slugify("well-known")).toBe("well-known");
  });

  it("handles numbers", () => {
    expect(slugify("Chapter 3 Section 1")).toBe("chapter-3-section-1");
  });

  it("handles mixed case and symbols", () => {
    expect(slugify("FAQ: How to Do X?")).toBe("faq-how-to-do-x");
  });
});

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delays execution by specified ms", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple calls", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    debounced();
    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resets timer on each call", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents execution", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it("cancel() is safe to call when no pending timer", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    expect(() => debounced.cancel()).not.toThrow();
  });
});
