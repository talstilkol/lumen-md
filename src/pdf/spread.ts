/**
 * W12.R2 — two-page spreads in the PDF reader, right to left for a Hebrew
 * book.
 *
 * Modes as pdf.js names them (`spreadMode`): none (one page per row), odd
 * (spreads start with an odd page: 1–2, 3–4, …) and even (page 1 alone,
 * then 2–3, 4–5, …, the usual layout of a printed book with a cover).
 * pdf.js lays a spread out left to right only; here each row takes the
 * book's direction, so in a right-to-left book the first page of a spread
 * is on the right. The direction defaults to the document's dominant
 * script and can be switched.
 *
 * Pure: no DOM. The reader's rows and keys are in ./PdfSpread.tsx.
 */

export type SpreadMode = "none" | "odd" | "even";
export type BookDir = "rtl" | "ltr";

/** The rows of a document of `count` pages: page numbers in reading order. */
export function spreadRows(count: number, mode: SpreadMode): number[][] {
  const rows: number[][] = [];
  if (count <= 0) return rows;
  if (mode === "none") {
    for (let p = 1; p <= count; p++) rows.push([p]);
    return rows;
  }
  let p = 1;
  if (mode === "even") rows.push([p++]);
  while (p <= count) {
    rows.push(p + 1 <= count ? [p, p + 1] : [p]);
    p += 2;
  }
  return rows;
}

/** Which row holds `page`. */
export function rowOfPage(rows: readonly number[][], page: number): number {
  const i = rows.findIndex((r) => r.includes(page));
  return i < 0 ? 0 : i;
}

/**
 * The book's direction from its text: Hebrew and Arabic letters against
 * Latin ones; a tie or no letters is left to right (pdf.js's own order).
 */
export function bookDirOf(text: string): BookDir {
  const rtl = (text.match(/[֐-׿؀-ۿיִ-﷿ﹰ-ﻼ]/g) ?? []).length;
  const ltr = (text.match(/[A-Za-zÀ-ɏ]/g) ?? []).length;
  return rtl > ltr ? "rtl" : "ltr";
}

/**
 * Rows to move for an arrow key: in a right-to-left book the next spread is
 * to the left, so ArrowLeft goes forward; in a left-to-right book ArrowRight
 * does. PageDown/PageUp go forward/back either way. 0: not a paging key.
 */
export function pagingDelta(key: string, dir: BookDir): number {
  if (key === "PageDown") return 1;
  if (key === "PageUp") return -1;
  if (key === "ArrowLeft") return dir === "rtl" ? 1 : -1;
  if (key === "ArrowRight") return dir === "rtl" ? -1 : 1;
  return 0;
}

/** Stored per PDF: the mode and, when the reader chose one, the direction. */
export interface SpreadPrefs {
  mode: SpreadMode;
  dir?: BookDir;
}

export function parsePrefs(raw: string | null): Record<string, SpreadPrefs> {
  try {
    const v = JSON.parse(raw ?? "{}") as Record<string, SpreadPrefs>;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
