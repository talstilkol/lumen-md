/**
 * ScrollProgress — tests for the page estimation logic.
 */
import { describe, it, expect } from "vitest";

/** Pure logic extracted from ScrollProgress.tsx */
function computeProgress(scrollTop: number, scrollHeight: number, clientHeight: number) {
  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= 0) {
    return { progress: 0, totalPages: 1, currentPage: 1 };
  }
  const pct = scrollTop / scrollable;
  const progress = Math.round(pct * 100);
  const pageHeight = 900;
  const totalPages = Math.max(1, Math.ceil(scrollHeight / pageHeight));
  const currentPage = Math.min(totalPages, Math.floor(scrollTop / pageHeight) + 1);
  return { progress, totalPages, currentPage };
}

describe("computeProgress", () => {
  it("returns 0% at the top", () => {
    const r = computeProgress(0, 5000, 800);
    expect(r.progress).toBe(0);
    expect(r.currentPage).toBe(1);
  });

  it("returns 100% at the bottom", () => {
    const scrollHeight = 5000;
    const clientHeight = 800;
    const scrollTop = scrollHeight - clientHeight;
    const r = computeProgress(scrollTop, scrollHeight, clientHeight);
    expect(r.progress).toBe(100);
  });

  it("returns 50% at midpoint", () => {
    const scrollHeight = 5000;
    const clientHeight = 800;
    const scrollTop = (scrollHeight - clientHeight) / 2;
    const r = computeProgress(scrollTop, scrollHeight, clientHeight);
    expect(r.progress).toBe(50);
  });

  it("handles non-scrollable content", () => {
    const r = computeProgress(0, 500, 800);
    expect(r.progress).toBe(0);
    expect(r.totalPages).toBe(1);
    expect(r.currentPage).toBe(1);
  });

  it("calculates pages correctly for long content", () => {
    const r = computeProgress(0, 9000, 800);
    expect(r.totalPages).toBe(10); // 9000/900 = 10
    expect(r.currentPage).toBe(1);
  });

  it("advances current page as user scrolls", () => {
    const r = computeProgress(1800, 9000, 800);
    expect(r.currentPage).toBe(3); // floor(1800/900) + 1 = 3
  });

  it("clamps current page to total pages", () => {
    const scrollHeight = 1800;
    const clientHeight = 800;
    const scrollTop = scrollHeight - clientHeight; // 1000
    const r = computeProgress(scrollTop, scrollHeight, clientHeight);
    expect(r.currentPage).toBeLessThanOrEqual(r.totalPages);
  });
});
