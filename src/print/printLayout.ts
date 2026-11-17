/**
 * Print and PDF layout at word-processor level, Hebrew first (W2.23).
 *
 * The browser's print engine does the typesetting: Chromium (131+) draws the
 * page-margin boxes of `@page`, so headers, footers and page numbers are
 * plain CSS. Hebrew page numbers (א, ב, ג … יא) use the CSS `hebrew`
 * counter style.
 *
 * - Direction and language come from the note's content, not the app's
 *   interface language: a Hebrew note prints right to left with `lang="he"`
 *   even from the English UI. With the right `lang`, the PDF text layer
 *   copies and searches in logical order.
 * - Header: the note's title (or the `header:` frontmatter), centred.
 *   Footer: the page number, "page / pages", in `decimal` or `hebrew`.
 * - Page breaks never split a table row, an image, a figure, a code block,
 *   a callout or display math; a heading stays with what follows it; table
 *   headers repeat on every page. `\newpage` or `\pagebreak` alone in a
 *   paragraph (Pandoc's spelling) forces a break.
 * - An optional table of contents (`toc: true`), with links that keep
 *   working in the PDF.
 * - Fonts: the app's embedded OFL faces (Heebo, Frank Ruhl Libre, Inter,
 *   Source Serif 4) come first, so the PDF embeds them instead of a system
 *   fallback.
 *
 * - Footnotes at the bottom of the page (the default; `footnotes: end` keeps
 *   them as endnotes). Chromium has no `float: footnote`, so the pages are
 *   laid out here: the note is measured at the page's width, its blocks are
 *   placed on pages, and each footnote goes to the bottom of the page that
 *   holds its first reference (`layoutFootnotePages`). In a note with Hebrew
 *   page numbers the footnotes are numbered in Hebrew numerals too.
 */
import { firstStrongDirection } from "../lib/textDirection";
import { gematria } from "../daily/gematria";

export type PageNumbering = "decimal" | "hebrew" | "none";

export interface PrintOptions {
  title: string;
  /** Header text; the title when unset, nothing when "". */
  header?: string;
  /** Footer text before the page number. */
  footer?: string;
  numbering?: PageNumbering;
  /** Insert a table of contents (h1–h3) after the title. */
  toc?: boolean;
  /** Heading of the table of contents, in the note's language. */
  tocTitle?: string;
  pageSize?: "A4" | "Letter";
  /** Where footnotes print: the bottom of the page (default) or the end of the note. */
  footnotes?: FootnotePlacement;
  /** Page margins (W13.R10): normal (the default), narrow or wide. */
  margins?: PageMargins;
  dir: "rtl" | "ltr";
}

export type PageMargins = "normal" | "narrow" | "wide";

/** The `@page` margins of each preset, in mm (top, inline end, bottom, inline start). */
export const MARGINS_MM: Readonly<Record<PageMargins, { top: number; side: number; bottom: number }>> = {
  normal: { top: 22, side: 18, bottom: 20 },
  narrow: { top: 14, side: 12.7, bottom: 14 },
  wide: { top: 25.4, side: 25.4, bottom: 25.4 },
};

export const PAPER_MM = { A4: { width: 210, height: 297 }, Letter: { width: 215.9, height: 279.4 } } as const;

/** The printable area of a page of this size and margins, in mm. */
export function pageArea(size: "A4" | "Letter" = "A4", margins: PageMargins = "normal"): { width: number; height: number } {
  const p = PAPER_MM[size];
  const m = MARGINS_MM[margins] ?? MARGINS_MM.normal;
  return { width: +(p.width - 2 * m.side).toFixed(2), height: +(p.height - m.top - m.bottom).toFixed(2) };
}

export type FootnotePlacement = "page" | "end";

/** The printable area of a page (the paper less the `@page` margins), in mm. */
export const PAGE_AREA_MM = {
  A4: { width: 210 - 36, height: 297 - 42 },
  Letter: { width: 215.9 - 36, height: 279.4 - 42 },
} as const;

/**
 * How much shorter a laid-out page is than the printable area, in mm: room
 * for rounding between the measurement and the print engine, so a full page
 * never spills a line (or a blank page) onto the next.
 */
export const PAGE_SLACK_MM = 3;
export const MM = 96 / 25.4;

/** A CSS string literal (for `content:`), safe for any title. */
export function cssString(s: string): string {
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\r\n\f]+/g, " ").replace(/[<>]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
}

const HEBREW = /[\u0590-\u05FF]/g;
const ARABIC = /[\u0600-\u06FF]/g;
const LATIN = /[A-Za-z]/g;

/** The note's main language for `lang`, from its letters: he, ar, or the UI language. */
export function contentLang(text: string, fallback: string): string {
  const he = text.match(HEBREW)?.length ?? 0;
  const ar = text.match(ARABIC)?.length ?? 0;
  const la = text.match(LATIN)?.length ?? 0;
  if (he > la && he >= ar) return "he";
  if (ar > la && ar > he) return "ar";
  return fallback === "he" || fallback === "ar" ? "en" : fallback;
}

/** The note's base direction: its first strong letter, outside code and markup. */
export function contentDirection(markdown: string): "rtl" | "ltr" {
  const body = markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\]\([^)]*\)/g, "]");
  return firstStrongDirection(body) ?? "ltr";
}

/** Print settings from the note's frontmatter (`toc`, `page-numbers`, `header`, `footer`, `page-size`). */
export function printFrontmatter(fm: Record<string, unknown> | null | undefined): Partial<PrintOptions> {
  if (!fm) return {};
  const out: Partial<PrintOptions> = {};
  if (fm.toc === true || fm.toc === "true") out.toc = true;
  const pn = String(fm["page-numbers"] ?? fm.pageNumbers ?? "");
  if (pn === "hebrew" || pn === "decimal" || pn === "none") out.numbering = pn;
  if (typeof fm.header === "string") out.header = fm.header;
  if (typeof fm.footer === "string") out.footer = fm.footer;
  const size = String(fm["page-size"] ?? "");
  if (size === "Letter" || size === "letter") out.pageSize = "Letter";
  if (size === "A4" || size === "a4") out.pageSize = "A4";
  const mg = String(fm.margins ?? fm["page-margins"] ?? "");
  if (mg === "normal" || mg === "narrow" || mg === "wide") out.margins = mg;
  const fn = String(fm.footnotes ?? "");
  if (fn === "page" || fn === "bottom") out.footnotes = "page";
  if (fn === "end" || fn === "endnotes") out.footnotes = "end";
  return out;
}

export function printCss(o: PrintOptions): string {
  const header = o.header ?? o.title;
  const numbering = o.numbering ?? "decimal";
  const pageNo =
    numbering === "none"
      ? '""'
      : `counter(page, ${numbering}) " / " counter(pages, ${numbering})`;
  const footer = o.footer ? `${cssString(o.footer)} "  ·  " ` : "";
  const margin = "font: 9pt var(--font-sans, Heebo, Inter, sans-serif); color: #666;";
  const m = MARGINS_MM[o.margins ?? "normal"] ?? MARGINS_MM.normal;
  return `
@page {
  size: ${o.pageSize ?? "A4"};
  margin: ${m.top}mm ${m.side}mm ${m.bottom}mm ${m.side}mm;
  @top-center { content: ${header ? cssString(header) : '""'}; ${margin} }
  @bottom-center { content: ${footer}${pageNo}; ${margin} direction: ${o.dir}; }
}
@page :first { @top-center { content: ""; } }
html { direction: ${o.dir}; }
body {
  margin: 0;
  font-family: Inter, Heebo, "Source Serif 4", "Frank Ruhl Libre", system-ui, sans-serif;
  font-size: 11.5pt;
  line-height: 1.55;
  orphans: 3;
  widows: 3;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
:lang(he), :lang(ar) { font-family: Heebo, "Frank Ruhl Libre", Inter, system-ui, sans-serif; }
h1, h2, h3, h4, h5, h6 { break-after: avoid-page; break-inside: avoid; }
table, figure, img, svg, pre, .code-block, .callout, .admonition, .katex-display, .mermaid-block, .chart-block, blockquote { break-inside: avoid; }
tr, li { break-inside: avoid; }
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
img { max-width: 100%; height: auto; }
.page-break { break-after: page; height: 0; }
a { color: inherit; text-decoration: underline; }
.print-title { font-size: 22pt; margin: 0 0 6mm; }
.print-toc { break-after: page; }
.print-toc ol { list-style: none; padding-inline-start: 0; }
.print-toc ol ol { padding-inline-start: 1.25em; }
.print-toc li { margin: 0.2em 0; }
.print-toc a { text-decoration: none; }
section.footnotes, section[data-footnotes] { break-before: auto; font-size: 9.5pt; border-top: 1px solid #ccc; margin-top: 8mm; }
.print-page { display: flow-root; position: relative; height: ${(pageArea(o.pageSize, o.margins).height - PAGE_SLACK_MM + 1).toFixed(1)}mm; break-after: page; }
.print-page:last-child, .print-page .print-toc { break-after: auto; }
.print-page.print-page-tall { height: auto; }
.page-footnotes { position: absolute; inset-inline: 0; bottom: 0; font-size: 9.5pt; line-height: 1.4; }
.print-page-tall .page-footnotes { position: static; }
.page-footnotes::before { content: ""; display: block; width: 33%; border-top: 1px solid #999; margin-bottom: 1.5mm; }
.page-footnote { margin: 0 0 1mm; }
.page-footnote > p { display: inline; margin: 0; }
.page-footnote .fn-num { text-decoration: none; margin-inline-end: 0.35em; font-weight: 600; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media screen { body { max-width: 190mm; margin: 12mm auto; padding: 0 8mm; } }
`;
}

/** Turn `\newpage` / `\pagebreak` paragraphs into page breaks. */
export function applyPageBreaks(root: ParentNode): number {
  let n = 0;
  root.querySelectorAll("p").forEach((p) => {
    if (/^\s*\\(newpage|pagebreak)\s*$/.test(p.textContent ?? "")) {
      const div = p.ownerDocument.createElement("div");
      div.className = "page-break";
      p.replaceWith(div);
      n++;
    }
  });
  return n;
}

/** A table of contents of the h1–h3 headings that have ids. Null if fewer than two. */
export function buildToc(root: ParentNode, title: string): HTMLElement | null {
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const heads = Array.from(root.querySelectorAll("h1[id], h2[id], h3[id]"));
  if (heads.length < 2) return null;
  const nav = doc.createElement("nav");
  nav.className = "print-toc";
  nav.setAttribute("dir", "auto");
  const h = doc.createElement("h2");
  h.textContent = title;
  nav.appendChild(h);
  const top = doc.createElement("ol");
  nav.appendChild(top);
  const stack: { level: number; list: HTMLElement }[] = [{ level: Number(heads[0].tagName[1]), list: top }];
  for (const el of heads) {
    const level = Number(el.tagName[1]);
    while (stack.length > 1 && level < stack[stack.length - 1].level) stack.pop();
    let cur = stack[stack.length - 1];
    if (level > cur.level) {
      const sub = doc.createElement("ol");
      (cur.list.lastElementChild ?? cur.list).appendChild(sub);
      cur = { level, list: sub };
      stack.push(cur);
    }
    const li = doc.createElement("li");
    const a = doc.createElement("a");
    a.href = `#${el.id}`;
    a.textContent = el.textContent ?? "";
    li.appendChild(a);
    cur.list.appendChild(li);
  }
  return nav;
}

/** A block of the note as the page planner sees it. */
export interface PlanBlock {
  /** Its height in the flow, margins included. */
  height: number;
  /** The footnote ids it references, in order. */
  refs: string[];
  /** A forced page break (`\newpage`) comes right before it. */
  breakBefore?: boolean;
}

export interface PlannedPage {
  /** Indexes into the blocks. */
  blocks: number[];
  /** The footnotes printed at its bottom, in order. */
  notes: string[];
  /** One block taller than a page: the browser splits it, its notes follow it. */
  tall?: boolean;
}

/**
 * Place blocks on pages so that every footnote sits at the bottom of the
 * page that holds its first reference. A block whose notes do not fit
 * moves, with them, to the next page; a note is never on another page than
 * its reference. A block taller than a page gets a page of its own.
 */
export function planFootnotePages(blocks: PlanBlock[], noteHeight: (id: string) => number, pageHeight: number, separator: number): PlannedPage[] {
  const pages: PlannedPage[] = [];
  const placed = new Set<string>();
  let page: PlannedPage = { blocks: [], notes: [] };
  let used = 0;
  let notesHeight = 0;
  const next = () => {
    pages.push(page);
    page = { blocks: [], notes: [] };
    used = 0;
    notesHeight = 0;
  };
  blocks.forEach((b, i) => {
    if (b.breakBefore && page.blocks.length) next();
    const fresh = [...new Set(b.refs)].filter((id) => !placed.has(id));
    const add = fresh.reduce((h, id) => h + noteHeight(id), 0);
    const fits = (sep: number) => used + b.height + notesHeight + add + sep <= pageHeight;
    if (page.blocks.length && !fits(fresh.length && !page.notes.length ? separator : 0)) next();
    const sep = fresh.length && !page.notes.length ? separator : 0;
    if (!page.blocks.length && !fits(sep)) page.tall = true;
    page.blocks.push(i);
    page.notes.push(...fresh);
    fresh.forEach((id) => placed.add(id));
    used += b.height;
    notesHeight += add + sep;
    // A tall block keeps its page to itself.
    if (page.tall) next();
  });
  if (page.blocks.length) pages.push(page);
  return pages;
}

const REF = "a[data-footnote-ref]";
const refTarget = (a: Element) => decodeURIComponent((a.getAttribute("href") ?? "").replace(/^#/, ""));

/** The label of the n-th footnote: 1, 2, 3 … or א׳, ב׳, ג׳ … */
export function footnoteLabel(n: number, numbering: PageNumbering): string {
  return numbering === "hebrew" ? gematria(n) : String(n);
}

/** Top-to-top heights of `els` in the flow (margins included); the last runs to `bottom`. */
function flowHeights(els: Element[], bottom: number): number[] {
  const tops = els.map((e) => e.getBoundingClientRect().top);
  return tops.map((t, i) => (i + 1 < tops.length ? tops[i + 1] : bottom) - t);
}

/**
 * Lay a rendered note out in pages with its footnotes at the bottom of each
 * page (W2.23, step 2). `root` must be laid out at the page's width (the
 * print window or a frame of that width), with `printCss` applied. The
 * footnotes section is removed: no endnotes are left. Returns the number of
 * pages and of footnotes placed; a note without footnotes is left as it is.
 */
export function layoutFootnotePages(root: HTMLElement, o: { pageHeight: number; numbering?: PageNumbering }): { pages: number; notes: number } {
  const doc = root.ownerDocument;
  const section = root.querySelector("section[data-footnotes], section.footnotes");
  if (!section) return { pages: 0, notes: 0 };
  const items = new Map<string, Element>();
  section.querySelectorAll("li[id]").forEach((li) => items.set(li.id, li));
  section.remove();

  // Number the notes in the order of their first reference.
  const order: string[] = [];
  const firstRef = new Map<string, string>();
  root.querySelectorAll(REF).forEach((a) => {
    const id = refTarget(a);
    if (!items.has(id)) return;
    if (!firstRef.has(id)) {
      order.push(id);
      firstRef.set(id, a.id);
    }
    a.textContent = footnoteLabel(order.indexOf(id) + 1, o.numbering ?? "decimal");
  });

  // Each note as it prints: its number (a link back to the reference), then its text.
  const notes = new Map<string, HTMLElement>();
  order.forEach((id, i) => {
    const li = items.get(id)!;
    li.querySelectorAll("[data-footnote-backref]").forEach((n) => n.remove());
    const el = doc.createElement("div");
    el.className = "page-footnote";
    el.id = id;
    // Its own text decides (a Hebrew numeral in front must not turn an English note RTL).
    el.setAttribute("dir", firstStrongDirection(li.textContent ?? "") ?? "auto");
    const num = doc.createElement("a");
    num.className = "fn-num";
    num.href = `#${firstRef.get(id) ?? ""}`;
    num.textContent = footnoteLabel(i + 1, o.numbering ?? "decimal");
    el.append(num, ...Array.from(li.childNodes));
    notes.set(id, el);
  });

  const prevDisplay = root.style.display;
  root.style.display = "flow-root";
  // Forced breaks become page boundaries.
  const breaks = new Set<Element>();
  const blocks = Array.from(root.children).filter((el) => {
    // The table of contents keeps its own page.
    if (el.classList.contains("print-toc") && el.nextElementSibling) breaks.add(el.nextElementSibling);
    if (el.classList.contains("page-break")) {
      if (el.nextElementSibling) breaks.add(el.nextElementSibling);
      el.remove();
      return false;
    }
    return true;
  });
  const heights = flowHeights(blocks, root.getBoundingClientRect().bottom);

  // The notes, measured in a footnote area of the same width.
  const probe = doc.createElement("div");
  probe.className = "page-footnotes";
  probe.style.position = "static";
  root.appendChild(probe);
  const separator = probe.getBoundingClientRect().height;
  const noteEls = order.map((id) => notes.get(id)!);
  probe.append(...noteEls);
  const noteHeights = new Map(order.map((id, i) => [id, flowHeights(noteEls, probe.getBoundingClientRect().bottom)[i]]));
  probe.remove();
  root.style.display = prevDisplay;

  const plan = planFootnotePages(
    blocks.map((el, i) => ({
      height: heights[i],
      refs: Array.from(el.matches(REF) ? [el] : el.querySelectorAll(REF)).map(refTarget).filter((id) => notes.has(id)),
      breakBefore: breaks.has(el),
    })),
    (id) => noteHeights.get(id) ?? 0,
    o.pageHeight,
    separator,
  );

  const pages = plan.map((p) => {
    const page = doc.createElement("div");
    page.className = p.tall ? "print-page print-page-tall" : "print-page";
    page.append(...p.blocks.map((i) => blocks[i]));
    if (p.notes.length) {
      const area = doc.createElement("div");
      area.className = "page-footnotes";
      area.setAttribute("role", "note");
      area.append(...p.notes.map((id) => notes.get(id)!));
      page.appendChild(area);
    }
    return page;
  });
  root.replaceChildren(...pages);
  return { pages: pages.length, notes: order.length };
}
