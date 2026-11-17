/**
 * Two-page book spreads for notes and EPUB chapters (plan W13.R6), as
 * Apple Books and Kindle lay them out.
 *
 * The text flows through CSS columns, one column per page, in a viewport
 * exactly two pages wide; turning the page moves the flow by a spread. In
 * a right-to-left text the columns run right to left, so page 1 is on the
 * right and ← is "next", as in the PDF reader's spreads (W12.R2, whose
 * modes and keys this reuses: one page, two pages, two pages with the
 * first alone as a cover).
 *
 * The reading place is a block (the first paragraph, heading or item on
 * the page) — not a page number, which changes with the window — so it
 * survives a resize and a switch between the spread and the scrolling
 * view.
 */
import { pagingDelta, type BookDir, type SpreadMode } from "../pdf/spread";

export { pagingDelta };
export type { BookDir, SpreadMode };

/** Pages per spread: one in "none", two otherwise. */
export const pagesPerSpread = (mode: SpreadMode) => (mode === "none" ? 1 : 2);

/**
 * The spread that shows `page` (0-based): in "even" a blank page comes
 * before page 0, so page 0 is alone on its spread and pages 1–2, 3–4 pair.
 */
export function spreadOfPage(page: number, mode: SpreadMode): number {
  if (mode === "none") return page;
  return Math.floor((page + (mode === "even" ? 1 : 0)) / 2);
}

/** How many spreads `pages` pages make. */
export function spreadCount(pages: number, mode: SpreadMode): number {
  if (pages <= 0) return 1;
  return spreadOfPage(pages - 1, mode) + 1;
}

/** The pages (0-based) a spread shows, in reading order; a blank (the cover's facing page, the last odd page) is left out. */
export function pagesOfSpread(spread: number, pages: number, mode: SpreadMode): number[] {
  if (mode === "none") return spread < pages ? [spread] : [];
  const first = spread * 2 - (mode === "even" ? 1 : 0);
  return [first, first + 1].filter((p) => p >= 0 && p < pages);
}

/**
 * Pages of a column flow: its scroll width over one page plus the gap
 * between columns. Rounded so a sub-pixel remainder is no extra page.
 */
export function pageCount(scrollWidth: number, pageWidth: number, gap: number): number {
  if (!(pageWidth > 0)) return 1;
  return Math.max(1, Math.round((scrollWidth + gap) / (pageWidth + gap)));
}

/** The page (0-based) an element starts on, from its distance to the flow's start edge (left in LTR, right in RTL). */
export function pageOfOffset(offset: number, pageWidth: number, gap: number): number {
  if (!(pageWidth > 0)) return 0;
  return Math.max(0, Math.floor((offset + gap / 2) / (pageWidth + gap)));
}

/** The flow's shift for a spread, in px along the reading direction (negated for RTL by the caller's transform). */
export function shiftOf(spread: number, mode: SpreadMode, pageWidth: number, gap: number): number {
  const per = pagesPerSpread(mode);
  return spread * per * (pageWidth + gap);
}

/** Next spread for a key: the book's direction decides which arrow is "next"; Space, PageDown go on; Home, End jump. */
export function spreadForKey(key: string, shift: boolean, dir: BookDir, current: number, count: number): number | null {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const d = key === " " ? (shift ? -1 : 1) : pagingDelta(key, dir);
  if (!d) return null;
  return Math.min(count - 1, Math.max(0, current + d));
}

/** Per-note (or per-book) spread settings and the reading place, kept per device. */
export interface SpreadPlace {
  /** Paged (true) or scrolling. */
  on: boolean;
  mode: SpreadMode;
  dir?: BookDir;
  /** Index of the first block on the page, among the flow's blocks. */
  block?: number;
  /** EPUB: the chapter that block is in. */
  chapter?: number;
  /** Where the scrolling view was left when the spread closed: unmoved since, the spread reopens on `block`. */
  scrollTop?: number;
}

const KEY = "lumen.spread:";

export function loadPlace(id: string): SpreadPlace {
  try {
    const v = JSON.parse(localStorage.getItem(KEY + id) ?? "null") as Partial<SpreadPlace> | null;
    const mode = v?.mode === "odd" || v?.mode === "even" || v?.mode === "none" ? v.mode : "odd";
    return { on: v?.on === true, mode, dir: v?.dir === "rtl" || v?.dir === "ltr" ? v.dir : undefined, block: typeof v?.block === "number" ? v.block : undefined, chapter: typeof v?.chapter === "number" ? v.chapter : undefined, scrollTop: typeof v?.scrollTop === "number" ? v.scrollTop : undefined };
  } catch {
    return { on: false, mode: "odd" };
  }
}

export function savePlace(id: string, place: SpreadPlace): void {
  try {
    localStorage.setItem(KEY + id, JSON.stringify(place));
  } catch {
    /* why: blocked storage — the place holds for this session only */
  }
}
