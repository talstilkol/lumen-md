/**
 * The page preview (W13.R10): the note as the PDF export will print it,
 * page by page, before it is printed — Word's print layout for Markdown.
 *
 * It does not imitate the print engine; it uses it. The preview is the
 * export's own document (PrintExport.preparePrint: the same HTML, the same
 * `printCss`, the same footnote pages) in a frame, and the frame's content
 * flows through a multi-column box whose columns are exactly the printable
 * area of a page. Chromium fragments columns with the same engine (LayoutNG
 * block fragmentation) that fragments printed pages: the same line breaks,
 * orphans and widows, `break-inside: avoid` for tables and code, repeated
 * table headers, forced breaks. So each column is a page, and the number of
 * columns is the number of pages of the PDF (e2e/paged-preview.spec.ts
 * prints ten notes and compares).
 *
 * paged.js (MIT) does this by cutting the DOM into page boxes. It is not a
 * dependency here: the registry is out of reach offline, and the browser's
 * own fragmentation gives the PDF's exact count without cutting anything.
 * What paged.js adds — the page-margin boxes — is drawn here: the header
 * (none on the first page, as `@page :first`), the footer with "page /
 * pages" in decimal or Hebrew numerals (the CSS `hebrew` counter style, as
 * the PDF uses), on sheets of A4 or Letter with normal, narrow or wide
 * margins.
 *
 * Everything here is `@media screen`: printing the frame prints the export.
 */
import { MARGINS_MM, MM, PAPER_MM, pageArea, type PageMargins, type PageNumbering } from "./printLayout";

export interface PagedOptions {
  pageSize: "A4" | "Letter";
  margins: PageMargins;
  numbering: PageNumbering;
  /** Header text ("" for none). */
  header: string;
  /** Footer text before the page number ("" for none). */
  footer: string;
  dir: "rtl" | "ltr";
}

export interface PagedGeometry {
  paper: { width: number; height: number };
  margin: { top: number; side: number; bottom: number };
  area: { width: number; height: number };
  /** Space between two sheets, in mm. */
  sheetGap: number;
  /** From one column to the next: the area's width plus the column gap, in mm. */
  pitch: number;
  /** The column gap: the two side margins and the space between the sheets, in mm. */
  columnGap: number;
}

export const SHEET_GAP_MM = 8;

export function pagedGeometry(size: "A4" | "Letter" = "A4", margins: PageMargins = "normal", sheetGap = SHEET_GAP_MM): PagedGeometry {
  const paper = PAPER_MM[size] ?? PAPER_MM.A4;
  const margin = MARGINS_MM[margins] ?? MARGINS_MM.normal;
  const area = pageArea(size, margins);
  const columnGap = 2 * margin.side + sheetGap;
  return { paper: { ...paper }, margin: { ...margin }, area, sheetGap, columnGap, pitch: area.width + columnGap };
}

const mm = (n: number) => `${+n.toFixed(3)}mm`;

/** The screen-only styles that turn the print document into pages. */
export function pagedCss(g: PagedGeometry): string {
  return `
@media screen {
  html.lumen-paged { background: #d9dce1; }
  html.lumen-paged body { max-width: none; margin: 0; padding: 16px; box-sizing: content-box; width: max-content; }
  .paged-strip { position: relative; box-sizing: border-box; height: ${mm(g.paper.height)}; padding-block-start: ${mm(g.margin.top)}; padding-inline-start: ${mm(g.margin.side)}; }
  .paged-sheet { position: absolute; top: 0; width: ${mm(g.paper.width)}; height: ${mm(g.paper.height)}; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(0 0 0 / 0.06); }
  .paged-flow { position: relative; z-index: 1; inline-size: ${mm(g.area.width)}; block-size: ${mm(g.area.height)}; column-width: ${mm(g.area.width)}; column-gap: ${mm(g.columnGap)}; column-fill: auto; color: #111; }
  .paged-flow .print-page, .paged-flow .page-break, .paged-flow .print-toc { break-after: column; }
  .paged-flow .print-page:last-child { break-after: auto; }
  .paged-mbox { position: absolute; z-index: 2; display: flex; align-items: center; justify-content: center; width: ${mm(g.paper.width)}; font: 9pt Heebo, Inter, sans-serif; color: #666; pointer-events: none; }
  .paged-head { top: 0; height: ${mm(g.margin.top)}; }
  .paged-foot { top: ${mm(g.paper.height - g.margin.bottom)}; height: ${mm(g.margin.bottom)}; }
  .paged-foot.num-decimal .paged-num::after { content: counter(pg, decimal) " / " counter(pgs, decimal); }
  .paged-foot.num-hebrew .paged-num::after { content: counter(pg, hebrew) " / " counter(pgs, hebrew); }
  .paged-sheet.paged-current { box-shadow: 0 0 0 2px #2563eb, 0 1px 3px rgb(0 0 0 / 0.25); }
}
@media print { .paged-sheet, .paged-mbox { display: none; } }
`;
}

/**
 * Which column (page) a box at `rect` sits in: the columns run from
 * `origin` (the flow's inline start) every `pitch` px, to the right in LTR
 * and to the left in RTL.
 */
export function columnOf(rect: { left: number; right: number }, origin: number, pitch: number, dir: "rtl" | "ltr"): number {
  const offset = dir === "rtl" ? origin - rect.right : rect.left - origin;
  return Math.max(0, Math.round(offset / pitch));
}

/** The number of pages a laid-out flow fills: the column of the last fragment of any of its blocks, plus one. */
export function countPages(flow: HTMLElement, pitchPx: number, dir: "rtl" | "ltr"): number {
  const box = flow.getBoundingClientRect();
  const origin = dir === "rtl" ? box.right : box.left;
  let last = 0;
  const content = flow.firstElementChild ?? flow;
  const blocks = content.children.length ? Array.from(content.children) : [content];
  for (const el of blocks) {
    const rects = el.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r.width && !r.height) continue;
      last = Math.max(last, columnOf(r, origin, pitchPx, dir));
    }
  }
  return last + 1;
}

/** Turn a hydrated print document (PrintExport.hydratePrintDocument) into pages. Returns their number. */
export function layoutPages(doc: Document, o: PagedOptions): number {
  const g = pagedGeometry(o.pageSize, o.margins);
  const content = doc.getElementById("lumen-print-content");
  if (!content) return 0;
  doc.documentElement.classList.add("lumen-paged");
  let style = doc.getElementById("lumen-paged-css") as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = "lumen-paged-css";
    doc.head.appendChild(style);
  }
  style.textContent = pagedCss(g);

  let strip = doc.querySelector<HTMLElement>(".paged-strip");
  let flow = doc.querySelector<HTMLElement>(".paged-flow");
  if (!strip || !flow) {
    strip = doc.createElement("div");
    strip.className = "paged-strip";
    flow = doc.createElement("div");
    flow.className = "paged-flow";
    content.replaceWith(strip);
    flow.appendChild(content);
    strip.appendChild(flow);
  }
  strip.querySelectorAll(".paged-sheet, .paged-mbox").forEach((n) => n.remove());

  const pages = countPages(flow, g.pitch * MM, o.dir);
  const sheetPitch = g.paper.width + g.sheetGap;
  strip.style.inlineSize = mm(pages * g.paper.width + (pages - 1) * g.sheetGap);
  const frag = doc.createDocumentFragment();
  for (let i = 0; i < pages; i++) {
    const start = mm(i * sheetPitch);
    const sheet = doc.createElement("div");
    sheet.className = "paged-sheet";
    sheet.dataset.page = String(i + 1);
    sheet.style.insetInlineStart = start;
    frag.appendChild(sheet);
    if (i > 0 && o.header) {
      const head = doc.createElement("div");
      head.className = "paged-mbox paged-head";
      head.style.insetInlineStart = start;
      head.textContent = o.header;
      head.setAttribute("aria-hidden", "true");
      frag.appendChild(head);
    }
    if (o.numbering !== "none" || o.footer) {
      const foot = doc.createElement("div");
      foot.className = `paged-mbox paged-foot num-${o.numbering}`;
      foot.style.insetInlineStart = start;
      foot.style.direction = o.dir;
      foot.style.counterReset = `pg ${i + 1} pgs ${pages}`;
      foot.setAttribute("aria-hidden", "true");
      if (o.footer) foot.append(doc.createTextNode(`${o.footer}  ·  `));
      const num = doc.createElement("span");
      num.className = "paged-num";
      foot.appendChild(num);
      frag.appendChild(foot);
    }
  }
  strip.prepend(frag);
  return pages;
}

/** The sheet's offset from the strip's inline start, in CSS px: where to scroll for page `n` (1-based). */
export function sheetOffsetPx(n: number, g: PagedGeometry): number {
  return (n - 1) * (g.paper.width + g.sheetGap) * MM;
}

/** The page whose sheet is nearest to an inline scroll offset (absolute value, px). */
export function pageAtScroll(scroll: number, g: PagedGeometry, pages: number): number {
  const n = Math.round(Math.abs(scroll) / ((g.paper.width + g.sheetGap) * MM)) + 1;
  return Math.min(Math.max(1, n), Math.max(1, pages));
}

/** The scale at which `count` sheets side by side fit a viewport of w × h px (never above 1). */
export function fitScale(viewport: { width: number; height: number }, g: PagedGeometry, count = 1, padding = 32): number {
  const w = (count * g.paper.width + (count - 1) * g.sheetGap) * MM + padding;
  const h = g.paper.height * MM + padding;
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(1, viewport.width / w, viewport.height / h);
}

export interface PagedPrefs {
  pageSize?: "A4" | "Letter";
  margins?: PageMargins;
  numbering?: PageNumbering;
  zoom?: PagedZoom;
}

export type PagedZoom = "fit" | "two" | "0.5" | "0.75" | "1";
export const ZOOMS: readonly PagedZoom[] = ["fit", "two", "0.5", "0.75", "1"];

const KEY = "lumen-paged";

/** The preview's last choices (this device only: the note is never rewritten for them). */
export function readPagedPrefs(): PagedPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    const out: PagedPrefs = {};
    if (v.pageSize === "A4" || v.pageSize === "Letter") out.pageSize = v.pageSize;
    if (v.margins === "normal" || v.margins === "narrow" || v.margins === "wide") out.margins = v.margins;
    if (v.numbering === "decimal" || v.numbering === "hebrew" || v.numbering === "none") out.numbering = v.numbering;
    if (typeof v.zoom === "string" && (ZOOMS as readonly string[]).includes(v.zoom)) out.zoom = v.zoom as PagedZoom;
    return out;
  } catch {
    // why: storage blocked (private mode) or a bad value: the defaults
    return {};
  }
}

export function savePagedPrefs(p: PagedPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // why: storage blocked or full: the choice holds while the preview is open
  }
}
