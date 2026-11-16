/**
 * W2.23 step 2 — footnotes at the bottom of the page in print and PDF.
 *
 * The planner (pure) decides which blocks and which footnotes go on each
 * page; the layout runs it on a rendered note with the browser's real
 * measurements and rebuilds the note as pages. The layout half needs a DOM
 * with layout (Chromium; in jsdom every box is 0 high, so it is skipped
 * there and runs in e2e/print-golden.spec.ts on the real print path).
 */
import { describe, expect, it } from "vitest";
import { MM, PAGE_AREA_MM, footnoteLabel, layoutFootnotePages, planFootnotePages, printCss, printFrontmatter, type PlanBlock } from "../print/printLayout";

const notes = (h: Record<string, number>) => (id: string) => h[id] ?? 0;

describe("planFootnotePages", () => {
  it("puts each note on the page of its reference", () => {
    const blocks: PlanBlock[] = [
      { height: 40, refs: ["a"] },
      { height: 40, refs: [] },
      { height: 40, refs: ["b"] },
    ];
    expect(planFootnotePages(blocks, notes({ a: 10, b: 10 }), 100, 5)).toEqual([
      { blocks: [0, 1], notes: ["a"] },
      { blocks: [2], notes: ["b"] },
    ]);
  });

  it("edge 1: a reference that fits but whose note does not moves, with its note, to the next page", () => {
    // 60 + 30 = 90 fits a 100 page; with its 25-high note (and 5 of rule) it does not.
    const blocks: PlanBlock[] = [{ height: 60, refs: [] }, { height: 30, refs: ["n"] }];
    const pages = planFootnotePages(blocks, notes({ n: 25 }), 100, 5);
    expect(pages).toEqual([{ blocks: [0], notes: [] }, { blocks: [1], notes: ["n"] }]);
  });

  it("edge 2: a note referenced twice prints once, at its first reference; two notes share one page", () => {
    const blocks: PlanBlock[] = [
      { height: 30, refs: ["a", "b", "a"] },
      { height: 80, refs: [] },
      { height: 30, refs: ["a"] },
    ];
    const pages = planFootnotePages(blocks, notes({ a: 10, b: 10 }), 100, 5);
    expect(pages).toEqual([
      { blocks: [0], notes: ["a", "b"] },
      { blocks: [1], notes: [] },
      { blocks: [2], notes: [] },
    ]);
    expect(pages.flatMap((p) => p.notes)).toEqual(["a", "b"]);
  });

  it("edge 3: a block taller than a page gets a page of its own, its note after it", () => {
    const blocks: PlanBlock[] = [{ height: 20, refs: [] }, { height: 250, refs: ["t"] }, { height: 20, refs: [] }];
    expect(planFootnotePages(blocks, notes({ t: 10 }), 100, 5)).toEqual([
      { blocks: [0], notes: [] },
      { blocks: [1], notes: ["t"], tall: true },
      { blocks: [2], notes: [] },
    ]);
  });

  it("a forced page break starts a new page", () => {
    const blocks: PlanBlock[] = [{ height: 10, refs: [] }, { height: 10, refs: [], breakBefore: true }];
    expect(planFootnotePages(blocks, notes({}), 100, 5).map((p) => p.blocks)).toEqual([[0], [1]]);
  });
});

describe("footnote settings and numbers", () => {
  it("reads footnotes: page | end from the frontmatter", () => {
    expect(printFrontmatter({ footnotes: "end" })).toEqual({ footnotes: "end" });
    expect(printFrontmatter({ footnotes: "endnotes" })).toEqual({ footnotes: "end" });
    expect(printFrontmatter({ footnotes: "page" })).toEqual({ footnotes: "page" });
    expect(printFrontmatter({ footnotes: "nowhere" })).toEqual({});
  });

  it("numbers in Hebrew numerals when the pages are", () => {
    expect([1, 2, 10, 15].map((n) => footnoteLabel(n, "hebrew"))).toEqual(["א׳", "ב׳", "י׳", "ט״ו"]);
    expect(footnoteLabel(3, "decimal")).toBe("3");
  });

  it("the page box is shorter than the printable area, and its footnotes sit at its bottom", () => {
    const css = printCss({ title: "t", dir: "rtl" });
    expect(css).toMatch(/\.print-page \{[^}]*height: 253\.0mm;[^}]*break-after: page;/);
    expect(css).toMatch(/\.page-footnotes \{ position: absolute; inset-inline: 0; bottom: 0;/);
  });
});

// GFM's footnote markup, as the preview pipeline renders it.
const ref = (n: string, k = 1) =>
  `<sup><a href="#user-content-fn-${n}" id="user-content-fnref-${n}${k > 1 ? `-${k}` : ""}" data-footnote-ref="" aria-describedby="footnote-label">${n}</a></sup>`;
const section = (items: Record<string, string>) =>
  `<section data-footnotes="" class="footnotes"><h2 class="sr-only" id="footnote-label">Footnotes</h2><ol>${Object.entries(items)
    .map(([n, text]) => `<li id="user-content-fn-${n}"><p>${text} <a href="#user-content-fnref-${n}" data-footnote-backref="" class="data-footnote-backref">↩</a></p></li>`)
    .join("")}</ol></section>`;
const para = (text: string) => `<p>${text} ${"זהו טקסט לדוגמה בעברית שנועד למלא את העמוד. ".repeat(6)}</p>`;

function laidOut(html: string): HTMLElement {
  const style = document.createElement("style");
  style.textContent = printCss({ title: "t", dir: "rtl" });
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.className = "prose-lumen";
  root.setAttribute("dir", "rtl");
  root.style.width = `${PAGE_AREA_MM.A4.width}mm`;
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const hasLayout = (() => {
  if (typeof document === "undefined") return false;
  const p = document.createElement("p");
  p.textContent = "x";
  document.body.appendChild(p);
  const h = p.getBoundingClientRect().height;
  p.remove();
  return h > 0;
})();

// skip-reason: page layout needs a real layout engine (sizes of laid-out boxes); jsdom and happy-dom report zero | task: W2.23 | until: 2027-05-16
describe.skipIf(!hasLayout)("layoutFootnotePages (real layout)", () => {
  it("leaves no endnotes: every note is at the bottom of the page of its first reference", () => {
    const pageHeight = 120 * MM; // short pages, so a few paragraphs fill several
    const root = laidOut(
      [para(`טענה ראשונה${ref("1")}`), para("פסקה"), para(`טענה שנייה${ref("2")}`), para("פסקה"), para(`שוב${ref("1", 2)}`), para(`English${ref("3")}`)].join("") +
        section({ 1: "מקור ראשון, עמוד 12.", 2: "מקור שני.", 3: "Third source." }),
    );
    const out = layoutFootnotePages(root, { pageHeight, numbering: "hebrew" });
    expect(out.notes).toBe(3);
    expect(out.pages).toBeGreaterThan(1);
    expect(root.querySelector("section[data-footnotes], section.footnotes")).toBe(null);
    expect(root.querySelectorAll("[data-footnote-backref]").length).toBe(0);
    for (const n of ["1", "2", "3"]) {
      const note = root.querySelector(`#user-content-fn-${n}`)!;
      const first = root.querySelector(`#user-content-fnref-${n}`)!;
      expect(note.closest(".print-page")).toBe(first.closest(".print-page"));
      expect(note.parentElement!.classList.contains("page-footnotes")).toBe(true);
    }
    // The second reference to note 1 is on a later page, which does not repeat it.
    expect(root.querySelector("#user-content-fnref-1-2")!.closest(".print-page")!.querySelector("#user-content-fn-1")).toBe(null);
    // Hebrew numerals, in the order of first reference, in the text and at the foot.
    expect(Array.from(root.querySelectorAll("a[data-footnote-ref]")).map((a) => a.textContent)).toEqual(["א׳", "ב׳", "א׳", "ג׳"]);
    expect(Array.from(root.querySelectorAll(".page-footnote .fn-num")).map((a) => a.textContent)).toEqual(["א׳", "ב׳", "ג׳"]);
    expect(root.querySelector<HTMLAnchorElement>("#user-content-fn-2 .fn-num")!.getAttribute("href")).toBe("#user-content-fnref-2");
    // Right to left: each note reads in its own direction, the rule starts on the right.
    expect(getComputedStyle(root.querySelector("#user-content-fn-1")!).direction).toBe("rtl");
    expect(getComputedStyle(root.querySelector("#user-content-fn-3")!).direction).toBe("ltr");
    // Each page's content fits its box: the notes do not overlap the text above them.
    for (const page of Array.from(root.querySelectorAll<HTMLElement>(".print-page:not(.print-page-tall)"))) {
      const area = page.querySelector(".page-footnotes");
      if (!area) continue;
      const blocks = Array.from(page.children).filter((c) => c !== area);
      const textBottom = Math.max(...blocks.map((b) => b.getBoundingClientRect().bottom));
      expect(textBottom).toBeLessThanOrEqual(area.getBoundingClientRect().top + 1);
    }
    root.remove();
  });

  it("a note without footnotes is left as it is", () => {
    const root = laidOut(para("בלי הערות"));
    const before = root.innerHTML;
    expect(layoutFootnotePages(root, { pageHeight: 500 })).toEqual({ pages: 0, notes: 0 });
    expect(root.innerHTML).toBe(before);
    root.remove();
  });
});
