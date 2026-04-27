/**
 * Tests for the recent-searches store. localStorage is provided by jsdom.
 * Each test starts with a clean slate so order doesn't matter.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  rememberSearch,
  getSearchHistory,
  forgetSearch,
  clearSearchHistory,
} from "../storage/searchHistory";

beforeEach(() => {
  clearSearchHistory();
});

describe("searchHistory", () => {
  it("starts empty", () => {
    expect(getSearchHistory()).toEqual([]);
  });

  it("stores a query and reports it", () => {
    rememberSearch("deep learning");
    expect(getSearchHistory()).toEqual(["deep learning"]);
  });

  it("ignores empty / single-char inputs", () => {
    rememberSearch("");
    rememberSearch("a");
    rememberSearch("  ");
    expect(getSearchHistory()).toEqual([]);
  });

  it("most-recent-first ordering", () => {
    rememberSearch("aa");
    rememberSearch("bb");
    rememberSearch("cc");
    expect(getSearchHistory()).toEqual(["cc", "bb", "aa"]);
  });

  it("dedupes — same query bumps to top, no duplicates", () => {
    rememberSearch("alpha");
    rememberSearch("beta");
    rememberSearch("alpha");
    expect(getSearchHistory()).toEqual(["alpha", "beta"]);
  });

  it("dedupe is case-insensitive", () => {
    rememberSearch("Alpha");
    rememberSearch("ALPHA");
    expect(getSearchHistory()).toEqual(["ALPHA"]);
  });

  it("caps at 8 entries — oldest drops", () => {
    for (let i = 0; i < 12; i++) rememberSearch(`q${i}`);
    const list = getSearchHistory();
    expect(list).toHaveLength(8);
    // Newest first → q11 down to q4. q0..q3 fell off.
    expect(list[0]).toBe("q11");
    expect(list[7]).toBe("q4");
  });

  it("forgetSearch removes a single entry", () => {
    rememberSearch("aa");
    rememberSearch("bb");
    rememberSearch("cc");
    forgetSearch("bb");
    expect(getSearchHistory()).toEqual(["cc", "aa"]);
  });

  it("clearSearchHistory empties the list", () => {
    rememberSearch("aa");
    rememberSearch("bb");
    clearSearchHistory();
    expect(getSearchHistory()).toEqual([]);
  });
});
