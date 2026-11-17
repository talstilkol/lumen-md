/**
 * W13.R10: the page view's geometry and page furniture. The page count
 * itself is the browser's print fragmentation, checked against printed
 * PDFs in e2e/paged-preview.spec.ts (10 notes); here the parts that are
 * arithmetic and DOM: margins, columns as pages, which column a box is in
 * (LTR and RTL), the sheets, the header (not on page 1) and the footer's
 * decimal or Hebrew numbers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MM, PAGE_AREA_MM, pageArea, printCss, printFrontmatter } from "../print/printLayout";
import { columnOf, countPages, fitScale, layoutPages, pageAtScroll, pagedCss, pagedGeometry, readPagedPrefs, savePagedPrefs, sheetOffsetPx } from "../print/pagedPreview";

const realRects = { bcr: Element.prototype.getBoundingClientRect, gcr: Element.prototype.getClientRects };
afterEach(() => {
  localStorage.clear();
  Element.prototype.getBoundingClientRect = realRects.bcr;
  Element.prototype.getClientRects = realRects.gcr;
});

describe("page margins (W13.R10)", () => {
  it("normal margins keep the export's printable area", () => {
    expect(pageArea("A4", "normal")).toEqual(PAGE_AREA_MM.A4);
    expect(pageArea("Letter", "normal")).toEqual({ width: +PAGE_AREA_MM.Letter.width.toFixed(2), height: +PAGE_AREA_MM.Letter.height.toFixed(2) });
  });
  it("narrow and wide change the area and the @page margin", () => {
    expect(pageArea("A4", "narrow")).toEqual({ width: 184.6, height: 269 });
    expect(pageArea("A4", "wide")).toEqual({ width: 159.2, height: 246.2 });
    expect(printCss({ title: "x", dir: "rtl", margins: "wide" })).toContain("margin: 25.4mm 25.4mm 25.4mm 25.4mm;");
    expect(printCss({ title: "x", dir: "rtl" })).toContain("margin: 22mm 18mm 20mm 18mm;");
    // The footnote pages are as tall as the area of the chosen margins.
    expect(printCss({ title: "x", dir: "ltr", margins: "narrow" })).toContain(`height: ${(269 - 3 + 1).toFixed(1)}mm`);
  });
  it("frontmatter `margins:` is read; an unknown value is ignored", () => {
    expect(printFrontmatter({ margins: "narrow" }).margins).toBe("narrow");
    expect(printFrontmatter({ "page-margins": "wide" }).margins).toBe("wide");
    expect(printFrontmatter({ margins: "huge" }).margins).toBeUndefined();
  });
});

describe("columns are pages", () => {
  const g = pagedGeometry("A4", "normal");
  it("a column is the printable area; the gap is both side margins and the space between sheets", () => {
    expect(g.area).toEqual({ width: 174, height: 255 });
    expect(g.columnGap).toBe(2 * 18 + 8);
    expect(g.pitch).toBe(174 + 44);
    const css = pagedCss(g);
    expect(css).toContain("column-width: 174mm");
    expect(css).toContain("block-size: 255mm");
    expect(css).toContain("column-fill: auto");
    expect(css).toMatch(/\.print-page, \.paged-flow \.page-break, \.paged-flow \.print-toc \{ break-after: column; \}/);
    // Printing the frame prints the export: the sheets and margin boxes are screen-only.
    expect(css).toMatch(/@media print \{ \.paged-sheet, \.paged-mbox \{ display: none; \} \}/);
  });
  it("which column a box is in: rightwards in LTR, leftwards in RTL", () => {
    const pitch = g.pitch * MM;
    expect(columnOf({ left: 100, right: 700 }, 100, pitch, "ltr")).toBe(0);
    expect(columnOf({ left: 100 + 2 * pitch, right: 0 }, 100, pitch, "ltr")).toBe(2);
    expect(columnOf({ left: 0, right: 1000 - 3 * pitch }, 1000, pitch, "rtl")).toBe(3);
    expect(columnOf({ left: 0, right: 1001 }, 1000, pitch, "rtl")).toBe(0);
  });
  it("sheet offsets and the page at a scroll position (either sign: RTL scrolls negative)", () => {
    const one = (g.paper.width + g.sheetGap) * MM;
    expect(sheetOffsetPx(1, g)).toBe(0);
    expect(sheetOffsetPx(3, g)).toBeCloseTo(2 * one);
    expect(pageAtScroll(2 * one + 5, g, 10)).toBe(3);
    expect(pageAtScroll(-2 * one, g, 10)).toBe(3);
    expect(pageAtScroll(99 * one, g, 4)).toBe(4);
  });
  it("fit: one or two sheets fit the viewport; never enlarged", () => {
    const s1 = fitScale({ width: 2000, height: 600 }, g, 1);
    expect(s1).toBeCloseTo(600 / (297 * MM + 32));
    const s2 = fitScale({ width: 900, height: 2000 }, g, 2);
    expect(s2).toBeCloseTo(900 / ((2 * 210 + 8) * MM + 32));
    expect(fitScale({ width: 5000, height: 5000 }, g)).toBe(1);
  });
});

/** A print document as hydratePrintDocument writes it, with boxes placed in `cols` columns. */
function fakeDoc(cols: number[], dir: "rtl" | "ltr"): Document {
  const doc = document.implementation.createHTMLDocument("p");
  doc.documentElement.dir = dir;
  const content = doc.createElement("div");
  content.id = "lumen-print-content";
  for (const c of cols) {
    const p = doc.createElement("p");
    p.textContent = `col ${c}`;
    p.dataset.col = String(c);
    content.appendChild(p);
  }
  doc.body.appendChild(content);
  const pitch = pagedGeometry().pitch * MM;
  const W = 657;
  // Layout stand-in: the flow at x 0..W (LTR) or 10000-W..10000 (RTL); each <p> in its column.
  const proto = Element.prototype;
  const flowRect = () => (dir === "rtl" ? { left: 10000 - W, right: 10000, top: 0, bottom: 963, width: W, height: 963 } : { left: 0, right: W, top: 0, bottom: 963, width: W, height: 963 });
  (proto as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("paged-flow") ? flowRect() : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  };
  (proto as unknown as { getClientRects: () => unknown }).getClientRects = function (this: HTMLElement) {
    const c = Number(this.dataset.col ?? 0);
    const left = dir === "rtl" ? 10000 - W - c * pitch : c * pitch;
    return [{ left, right: left + W, top: 0, bottom: 20, width: W, height: 20 }];
  };
  return doc;
}

describe("layoutPages: sheets, header and footer", () => {
  for (const dir of ["ltr", "rtl"] as const) {
    it(`${dir}: as many sheets as the last block's column + 1; no header on page 1`, () => {
      const doc = fakeDoc([0, 0, 1, 1, 3], dir);
      const n = layoutPages(doc, { pageSize: "A4", margins: "normal", numbering: "decimal", header: "My note", footer: "", dir });
      expect(n).toBe(4);
      expect(doc.querySelectorAll(".paged-sheet")).toHaveLength(4);
      const heads = Array.from(doc.querySelectorAll<HTMLElement>(".paged-head"));
      expect(heads).toHaveLength(3);
      expect(heads.every((h) => h.textContent === "My note")).toBe(true);
      const feet = Array.from(doc.querySelectorAll<HTMLElement>(".paged-foot"));
      expect(feet.map((f) => f.style.counterReset)).toEqual(["pg 1 pgs 4", "pg 2 pgs 4", "pg 3 pgs 4", "pg 4 pgs 4"]);
      expect(feet[0].className).toContain("num-decimal");
      // Sheets start at the strip's inline start: right in RTL, left in LTR.
      expect(doc.querySelector<HTMLElement>(".paged-sheet[data-page='2']")!.style.insetInlineStart).toBe("218mm");
      // The content moved into the flow, not copied.
      expect(doc.querySelectorAll("#lumen-print-content")).toHaveLength(1);
      expect(doc.querySelector(".paged-flow > #lumen-print-content")).not.toBeNull();
      expect(doc.documentElement.classList.contains("lumen-paged")).toBe(true);
    });
  }
  it("Hebrew numerals, a footer text, no numbers", () => {
    const doc = fakeDoc([0, 1], "rtl");
    layoutPages(doc, { pageSize: "A4", margins: "wide", numbering: "hebrew", header: "", footer: "סודי", dir: "rtl" });
    const feet = doc.querySelectorAll<HTMLElement>(".paged-foot");
    expect(feet[1].className).toContain("num-hebrew");
    expect(feet[1].textContent).toContain("סודי");
    expect(doc.querySelectorAll(".paged-head")).toHaveLength(0);
    expect(doc.getElementById("lumen-paged-css")!.textContent).toContain("counter(pg, hebrew)");
    const again = fakeDoc([0, 1], "ltr");
    layoutPages(again, { pageSize: "Letter", margins: "normal", numbering: "none", header: "", footer: "", dir: "ltr" });
    expect(again.querySelectorAll(".paged-foot")).toHaveLength(0);
  });
  it("laying out again (a new size) replaces the sheets, keeps one flow", () => {
    const doc = fakeDoc([0, 2], "ltr");
    layoutPages(doc, { pageSize: "A4", margins: "normal", numbering: "decimal", header: "", footer: "", dir: "ltr" });
    layoutPages(doc, { pageSize: "A4", margins: "normal", numbering: "decimal", header: "", footer: "", dir: "ltr" });
    expect(doc.querySelectorAll(".paged-flow")).toHaveLength(1);
    expect(doc.querySelectorAll(".paged-sheet")).toHaveLength(3);
  });
  it("an empty flow is one page", () => {
    const doc = fakeDoc([], "ltr");
    expect(countPages(doc.querySelector<HTMLElement>("#lumen-print-content")!, 800, "ltr")).toBe(1);
  });
});

describe("the preview's remembered zoom", () => {
  it("only valid values come back", () => {
    savePagedPrefs({ zoom: "two" });
    expect(readPagedPrefs()).toEqual({ zoom: "two" });
    localStorage.setItem("lumen-paged", JSON.stringify({ zoom: "9", pageSize: "B5" }));
    expect(readPagedPrefs()).toEqual({});
    localStorage.setItem("lumen-paged", "{bad");
    expect(readPagedPrefs()).toEqual({});
  });
});

describe("preparePrint, as the page view calls it", () => {
  it("the preview's choices override the frontmatter; \\newpage and a TOC no longer break the React unmount", async () => {
    const { preparePrint } = await import("../ui/PrintExport");
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => errors.push(e.error ?? e.message);
    window.addEventListener("error", onErr);
    try {
      const md = "---\ntoc: true\npage-size: A4\nmargins: wide\n---\n\n# One\n\ntext\n\n\\newpage\n\n## Two\n\nmore\n\n## Three\n\nend\n";
      const p = await preparePrint(md, "n", { appStyles: false, overrides: { pageSize: "Letter", margins: undefined } });
      expect(p.styles).toContain("size: Letter;");
      // An undefined override leaves the frontmatter's value.
      expect(p.styles).toContain("margin: 25.4mm 25.4mm 25.4mm 25.4mm;");
      expect(p.html).toContain('class="page-break"');
      expect(p.html).toContain('class="print-toc"');
    } finally {
      window.removeEventListener("error", onErr);
    }
    expect(errors).toEqual([]);
  });
});
