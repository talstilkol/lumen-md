/**
 * W12.R2 — two-page spreads: rows for odd/even, the book's direction (page
 * 1 of a Hebrew spread on the right), arrow keys that page in that
 * direction, and the reading position of a spread (its first page).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { bookDirOf, pagingDelta, rowOfPage, spreadRows } from "../pdf/spread";
import { SpreadRows, useSpread } from "../pdf/PdfSpread";
import { positionAt, scrollTopFor } from "../pdf/readingPosition";
import type { PdfDocument } from "../pdf/pdfjs";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe("rows", () => {
  it("none, odd (1–2, 3–4) and even (1, 2–3, 4–5), as pdf.js's spreadMode", () => {
    expect(spreadRows(3, "none")).toEqual([[1], [2], [3]]);
    expect(spreadRows(5, "odd")).toEqual([[1, 2], [3, 4], [5]]);
    expect(spreadRows(5, "even")).toEqual([[1], [2, 3], [4, 5]]);
    expect(spreadRows(0, "odd")).toEqual([]);
    expect(rowOfPage(spreadRows(5, "even"), 3)).toBe(1);
  });

  it("the book's direction from its letters", () => {
    expect(bookDirOf("בראשית ברא אלוהים את השמיים and a little English")).toBe("rtl");
    expect(bookDirOf("In the beginning, שלום")).toBe("ltr");
    expect(bookDirOf("1234")).toBe("ltr");
  });

  it("ArrowLeft is next in a right-to-left book, ArrowRight in a left-to-right one", () => {
    expect([pagingDelta("ArrowLeft", "rtl"), pagingDelta("ArrowRight", "rtl")]).toEqual([1, -1]);
    expect([pagingDelta("ArrowLeft", "ltr"), pagingDelta("ArrowRight", "ltr")]).toEqual([-1, 1]);
    expect([pagingDelta("PageDown", "rtl"), pagingDelta("PageUp", "ltr"), pagingDelta("a", "rtl")]).toEqual([1, -1, 0]);
  });
});

describe("reading position in a spread", () => {
  it("is the spread's first page, not the second (they share a top)", () => {
    const boxes = [
      { top: 0, height: 100 },
      { top: 0, height: 100 },
      { top: 110, height: 100 },
      { top: 110, height: 100 },
    ];
    expect(positionAt(boxes, 120)).toEqual({ page: 3, offset: 0.1 });
    expect(positionAt(boxes, 0)).toEqual({ page: 1, offset: 0 });
    expect(scrollTopFor(boxes, { page: 3, offset: 0.1 })).toBe(120);
  });
});

const Page = ({ n }: { n: number }) => <div data-page={n} style={{ width: 100, height: 140 }} />;

describe("<SpreadRows> (real layout in the browser runner)", () => {
  it("in a right-to-left book page 1 is on the right of page 2; in a left-to-right book on the left", async () => {
    const { rerender } = render(
      <SpreadRows spread={{ mode: "odd", dir: "rtl" }}>{[1, 2, 3].map((n) => <Page key={n} n={n} />)}</SpreadRows>,
    );
    const at = (n: number) => document.querySelector(`[data-page="${n}"]`)!.getBoundingClientRect();
    expect(screen.getAllByTestId("pdf-spread-row")).toHaveLength(2);
    await waitFor(() => expect(at(1).width).toBeGreaterThan(0));
    expect(at(1).left).toBeGreaterThan(at(2).left);
    expect(at(1).top).toBe(at(2).top);
    expect(at(3).top).toBeGreaterThan(at(1).top);
    rerender(<SpreadRows spread={{ mode: "odd", dir: "ltr" }}>{[1, 2, 3].map((n) => <Page key={n} n={n} />)}</SpreadRows>);
    expect(at(1).left).toBeLessThan(at(2).left);
  });

  it("mode none leaves the pages as they were, one per row", () => {
    render(<SpreadRows spread={{ mode: "none", dir: "rtl" }}>{[1, 2].map((n) => <Page key={n} n={n} />)}</SpreadRows>);
    expect(screen.queryAllByTestId("pdf-spread-row")).toHaveLength(0);
    expect(document.querySelectorAll("[data-page]")).toHaveLength(2);
  });
});

/** An in-memory document: just the text the reader samples (not a mock of our code). */
const docOf = (texts: string[]): PdfDocument =>
  ({ numPages: texts.length, getPage: async (n: number) => ({ getTextContent: async () => ({ items: [{ str: texts[n - 1] }] }) }) }) as unknown as PdfDocument;

describe("useSpread", () => {
  it("defaults the direction from a Hebrew book's text, keeps the reader's choice per PDF", async () => {
    const he = renderHook(() => useSpread(docOf(["פרק ראשון", "המשך הסיפור"]), "books/he.pdf", { current: null }, { current: new Map() }));
    await waitFor(() => expect(he.result.current.dir).toBe("rtl"));
    expect(he.result.current.auto).toBe(true);
    act(() => he.result.current.setMode("even"));
    act(() => he.result.current.setDir("ltr"));
    expect(he.result.current).toMatchObject({ mode: "even", dir: "ltr", auto: false });
    const again = renderHook(() => useSpread(docOf(["פרק"]), "books/he.pdf", { current: null }, { current: new Map() }));
    expect(again.result.current).toMatchObject({ mode: "even", dir: "ltr" });
    const en = renderHook(() => useSpread(docOf(["Chapter one", "The story goes on"]), "books/en.pdf", { current: null }, { current: new Map() }));
    await waitFor(() => expect(en.result.current.dir).toBe("ltr"));
    expect(en.result.current.mode).toBe("none");
  });

  it("ArrowLeft scrolls a Hebrew book to the next spread", async () => {
    function Reader() {
      const scrollRef = useRef<HTMLDivElement>(null);
      const pageEls = useRef(new Map<number, HTMLDivElement>());
      const spread = useSpread(docOf(["עברית", "עברית", "עברית", "עברית"]), "x.pdf", scrollRef, pageEls);
      return (
        <div tabIndex={-1} data-testid="root">
          <button type="button" onClick={() => spread.setMode("odd")}>two</button>
          <div>
            <div ref={scrollRef} data-testid="scroll" style={{ height: 150, overflow: "auto", position: "relative" }}>
              <SpreadRows spread={spread}>
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} ref={(el) => void (el ? pageEls.current.set(n, el) : pageEls.current.delete(n))} style={{ width: 80, height: 140 }} />
                ))}
              </SpreadRows>
            </div>
          </div>
        </div>
      );
    }
    render(<Reader />);
    const btn = screen.getByRole("button", { name: "two" });
    fireEvent.click(btn);
    btn.focus();
    const scroll = screen.getByTestId("scroll");
    await waitFor(() => expect(screen.getAllByTestId("pdf-spread-row")).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.keyDown(btn, { key: "ArrowLeft" });
    await waitFor(() => expect(scroll.scrollTop).toBeGreaterThan(0));
  });
});
