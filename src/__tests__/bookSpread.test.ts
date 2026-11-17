/**
 * Plan W13.R6 — two-page spreads for notes and EPUB chapters: the page
 * arithmetic (src/reading/bookSpread.ts). The column layout itself needs
 * real layout: the Chromium harness and e2e/book-spread.spec.ts (owed on
 * the Mac) check page order on screen, keys and the kept place.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { loadPlace, pageCount, pageOfOffset, pagesOfSpread, savePlace, shiftOf, spreadCount, spreadForKey, spreadOfPage } from "../reading/bookSpread";

describe("spreads", () => {
  it("two pages: 1–2, 3–4, 5", () => {
    expect([0, 1, 2].map((s) => pagesOfSpread(s, 5, "odd"))).toEqual([[0, 1], [2, 3], [4]]);
    expect(spreadCount(5, "odd")).toBe(3);
    expect(spreadOfPage(3, "odd")).toBe(1);
  });
  it("cover alone: 1, 2–3, 4–5", () => {
    expect([0, 1, 2].map((s) => pagesOfSpread(s, 5, "even"))).toEqual([[0], [1, 2], [3, 4]]);
    expect(spreadCount(5, "even")).toBe(3);
    expect(spreadOfPage(0, "even")).toBe(0);
    expect(spreadOfPage(1, "even")).toBe(1);
  });
  it("one page: a page per spread", () => {
    expect(spreadCount(3, "none")).toBe(3);
    expect(pagesOfSpread(2, 3, "none")).toEqual([2]);
  });
  it("pages of a column flow, and the page an element starts on", () => {
    // 3 pages of 400 with 40 gaps: 400*3 + 40*2 = 1280.
    expect(pageCount(1280, 400, 40)).toBe(3);
    expect(pageCount(1281.4, 400, 40)).toBe(3);
    expect(pageOfOffset(0, 400, 40)).toBe(0);
    expect(pageOfOffset(450, 400, 40)).toBe(1);
    expect(pageOfOffset(880, 400, 40)).toBe(2);
    expect(shiftOf(1, "odd", 400, 40)).toBe(880);
  });
});

describe("keys follow the book's direction", () => {
  it("Hebrew: ← is next; English: → is next; Space, PageDown, Home, End", () => {
    expect(spreadForKey("ArrowLeft", false, "rtl", 0, 3)).toBe(1);
    expect(spreadForKey("ArrowRight", false, "rtl", 1, 3)).toBe(0);
    expect(spreadForKey("ArrowRight", false, "ltr", 0, 3)).toBe(1);
    expect(spreadForKey(" ", false, "ltr", 0, 3)).toBe(1);
    expect(spreadForKey(" ", true, "ltr", 1, 3)).toBe(0);
    expect(spreadForKey("PageDown", false, "rtl", 0, 3)).toBe(1);
    expect(spreadForKey("End", false, "rtl", 0, 3)).toBe(2);
    expect(spreadForKey("Home", false, "rtl", 2, 3)).toBe(0);
    expect(spreadForKey("ArrowLeft", false, "rtl", 2, 3)).toBe(2); // the last spread stays
    expect(spreadForKey("a", false, "rtl", 0, 3)).toBeNull();
  });
});

describe("the place is kept per note or book", () => {
  beforeEach(() => localStorage.clear());
  it("round trip; nothing saved means scrolling, two pages", () => {
    expect(loadPlace("x.md")).toEqual({ on: false, mode: "odd", dir: undefined, block: undefined, chapter: undefined });
    savePlace("x.md", { on: true, mode: "even", dir: "rtl", block: 12 });
    expect(loadPlace("x.md")).toMatchObject({ on: true, mode: "even", dir: "rtl", block: 12 });
  });
  it("a damaged entry gives the default", () => {
    localStorage.setItem("lumen.spread:y.md", "{");
    expect(loadPlace("y.md").on).toBe(false);
  });
});
