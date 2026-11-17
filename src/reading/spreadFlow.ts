/**
 * The page flow of a two-page spread (plan W13.R6): a viewport that shows
 * one spread, and a flow element inside it laid out in CSS columns, one
 * per page, moved by a transform. Shared by the note view and the EPUB
 * reader. The arithmetic is in ./bookSpread.ts.
 *
 * Geometry: pages of width P, a gap G between them and a margin M on both
 * sides of the viewport, with G > M — so the neighbouring spreads' pages
 * always fall outside the viewport and nothing of them shows in the
 * margins. "Cover alone" puts a blank column before page 1 (CSS
 * `.spread-even::before`), so the flow's columns pair as in "two pages" and
 * only the page numbers shift by one.
 */
import { pageCount, pageOfOffset, pagesPerSpread, spreadCount, spreadOfPage, type BookDir, type SpreadMode } from "./bookSpread";

export interface SpreadFlow {
  /** Lay out again (the viewport or the text changed); keeps the first block on the page. */
  layout(): void;
  goTo(spread: number): void;
  readonly spread: number;
  readonly count: number;
  /** Pages (1-based) on the spread in view. */
  readonly pages: number[];
  readonly pageTotal: number;
  /** Index of the first block on the spread in view. */
  firstBlock(): number;
  /** Bring block `i` into view. */
  reveal(i: number): void;
  setMode(mode: SpreadMode, dir: BookDir): void;
  dispose(): void;
}

const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figure, hr, img, dl";

export function blocksOf(flow: HTMLElement): HTMLElement[] {
  // Outermost blocks only: a list item counts, not the paragraph inside it.
  return Array.from(flow.querySelectorAll<HTMLElement>(BLOCKS)).filter((el) => {
    const up = el.parentElement?.closest(BLOCKS);
    return !up || !flow.contains(up) || el.tagName === "LI";
  });
}

export function createSpreadFlow(
  viewport: HTMLElement,
  flow: HTMLElement,
  init: { mode: SpreadMode; dir: BookDir; gap?: number; margin?: number; onChange?: (f: SpreadFlow) => void },
): SpreadFlow {
  let mode = init.mode;
  let dir = init.dir;
  const gap = init.gap ?? 64;
  const margin = Math.min(init.margin ?? 40, gap - 8);
  /** The columns pair as "two pages" in "cover alone" too (its blank is a real column). */
  const colMode = () => (mode === "even" ? "odd" : mode);
  const blank = () => (mode === "even" ? 1 : 0);
  let spread = 0;
  let count = 1;
  let columns = 1;
  let pageWidth = 0;
  /** Where the flow box sits when not moved, relative to the viewport's start edge. */
  let base = 0;

  /** An element's column, from its distance to the flow's start edge (both move with the transform). */
  const columnOf = (el: Element) => {
    const f = flow.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const d = dir === "rtl" ? f.right - r.right : r.left - f.left;
    return pageOfOffset(d, pageWidth, gap);
  };

  const apply = () => {
    const shift = spread * pagesPerSpread(colMode()) * (pageWidth + gap);
    const x = dir === "rtl" ? base + shift : base - shift;
    flow.style.transform = `translateX(${x}px)`;
    flow.dataset.spread = String(spread);
    const per = pagesPerSpread(colMode());
    const cols = Array.from({ length: per }, (_, k) => spread * per + k).filter((c) => c < columns);
    api.pages.splice(0, api.pages.length, ...cols.map((c) => c + 1 - blank()).filter((p) => p >= 1));
    init.onChange?.(api);
  };

  const api: SpreadFlow = {
    pages: [],
    get spread() {
      return spread;
    },
    get count() {
      return count;
    },
    get pageTotal() {
      return Math.max(1, columns - blank());
    },
    layout() {
      const keep = columns > 1 ? api.firstBlock() : -1;
      const per = pagesPerSpread(colMode());
      const width = viewport.clientWidth;
      pageWidth = Math.max(120, (width - 2 * margin - (per - 1) * gap) / per);
      flow.dir = dir;
      flow.style.boxSizing = "border-box";
      flow.style.columnWidth = `${pageWidth}px`;
      flow.style.columnGap = `${gap}px`;
      flow.style.columnFill = "auto";
      flow.style.height = `${viewport.clientHeight}px`;
      flow.style.width = `${per * pageWidth + (per - 1) * gap}px`;
      flow.style.paddingBlock = "24px 16px";
      flow.classList.toggle("spread-even", mode === "even");
      // Measure the unmoved box: no transition, or the box would be read mid-slide.
      flow.style.transition = "none";
      flow.style.transform = "none";
      // Where the unmoved box sits, so the first page starts `margin` from the viewport's start edge.
      const v = viewport.getBoundingClientRect();
      const f = flow.getBoundingClientRect();
      base = dir === "rtl" ? v.right - margin - f.right : v.left + margin - f.left;
      columns = pageCount(flow.scrollWidth, pageWidth, gap);
      count = spreadCount(columns, colMode());
      spread = Math.min(spread, count - 1);
      if (keep >= 0) api.reveal(keep);
      else apply();
      // Back to sliding once the new place is set (the next frame, so this jump does not slide).
      requestAnimationFrame(() => {
        flow.style.transition = "";
      });
    },
    goTo(s) {
      spread = Math.min(count - 1, Math.max(0, s));
      apply();
    },
    firstBlock() {
      const blocks = blocksOf(flow);
      const first = spread * pagesPerSpread(colMode());
      for (let i = 0; i < blocks.length; i++) {
        // A block that starts before this spread but runs into it counts as on it when nothing starts here first.
        if (columnOf(blocks[i]) >= first) return i;
      }
      return Math.max(0, blocks.length - 1);
    },
    reveal(i) {
      const blocks = blocksOf(flow);
      const el = blocks[Math.min(Math.max(0, i), blocks.length - 1)];
      spread = el ? Math.min(count - 1, spreadOfPage(columnOf(el), colMode())) : 0;
      apply();
    },
    setMode(m, d) {
      const keep = api.firstBlock();
      mode = m;
      dir = d;
      spread = 0;
      columns = 1;
      api.layout();
      api.reveal(keep);
    },
    dispose() {
      for (const p of ["transform", "transition", "columnWidth", "columnGap", "columnFill", "height", "width", "paddingBlock", "boxSizing"] as const) flow.style[p] = "";
      flow.classList.remove("spread-even");
      flow.removeAttribute("dir");
      delete flow.dataset.spread;
    },
  };
  api.layout();
  return api;
}
