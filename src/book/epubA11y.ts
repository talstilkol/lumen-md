/**
 * EPUB Accessibility 1.1 for Lumen's EPUB exports (plan W13.F4).
 *
 * The European Accessibility Act applies to e-books since June 2025: a
 * reader (and a library's catalogue) must be able to tell, before opening
 * the book, how it can be read. That is the package's discovery metadata
 * (schema.org, in the OPF):
 *
 *  - `schema:accessMode`: textual, plus visual when there are images;
 *  - `schema:accessModeSufficient`: textual when every image has a text
 *    alternative (else textual,visual);
 *  - `schema:accessibilityFeature`: structuralNavigation, tableOfContents,
 *    readingOrder, displayTransformability, alternativeText (when every
 *    image is described), pageNavigation + pageBreakMarkers (the page list),
 *    and describedMath / MathML when there is math;
 *  - `schema:accessibilityHazard`: none (no flashing, motion or sound: the
 *    exporter drops video, audio and scripts);
 *  - `schema:accessibilitySummary`: a sentence in the book's language.
 *
 * And a page list: Lumen writes no print edition, so the book paginates
 * itself — a page break at the start of every chapter and then every ~300
 * words, at a block boundary, each one labelled — so a class can say "page
 * 12" and every reader lands on the same place.
 *
 * Nothing here claims conformance (`dcterms:conformsTo`): that is for an
 * evaluation (Ace by DAISY on the Mac, plan W13.F4) to settle.
 */

export interface A11yFacts {
  lang: string;
  images: number;
  /** Images without a text alternative (alt="" or none). */
  imagesWithoutAlt: number;
  pages: number;
  hasMath?: boolean;
}

const SUMMARY: Record<string, (f: A11yFacts) => string> = {
  he: (f) =>
    `ספר עם מבנה של כותרות ותוכן עניינים, בסדר קריאה מימין לשמאל, עם רשימת עמודים (${f.pages}) שנקבעה בייצוא. ` +
    (f.images ? (f.imagesWithoutAlt ? `ל-${f.imagesWithoutAlt} מתוך ${f.images} תמונות אין תיאור טקסט. ` : "לכל התמונות יש תיאור טקסט. ") : "") +
    "אין בו תוכן מהבהב, תנועה או קול.",
  en: (f) =>
    `A book with headings and a table of contents in reading order, with a page list (${f.pages} pages) set at export. ` +
    (f.images ? (f.imagesWithoutAlt ? `${f.imagesWithoutAlt} of ${f.images} images have no text alternative. ` : "Every image has a text alternative. ") : "") +
    "It has no flashing content, motion or sound.",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The OPF `<meta>` lines of the discovery metadata. */
export function a11yMetadata(f: A11yFacts): string {
  const modes = f.images ? ["textual", "visual"] : ["textual"];
  const sufficient = f.images && f.imagesWithoutAlt ? ["textual,visual"] : ["textual"];
  const features = ["structuralNavigation", "tableOfContents", "readingOrder", "displayTransformability"];
  if (f.images && !f.imagesWithoutAlt) features.push("alternativeText");
  if (f.pages) features.push("pageNavigation", "pageBreakMarkers");
  if (f.hasMath) features.push("MathML");
  const summary = (SUMMARY[f.lang.split("-")[0]] ?? SUMMARY.en)(f);
  return [
    ...modes.map((m) => `<meta property="schema:accessMode">${m}</meta>`),
    ...sufficient.map((m) => `<meta property="schema:accessModeSufficient">${m}</meta>`),
    ...features.map((x) => `<meta property="schema:accessibilityFeature">${x}</meta>`),
    `<meta property="schema:accessibilityHazard">none</meta>`,
    `<meta property="schema:accessibilitySummary">${esc(summary)}</meta>`,
  ].join("\n");
}

/** Images in XHTML, and those without a text alternative. */
export function countImages(xhtml: string): { images: number; withoutAlt: number } {
  const imgs = xhtml.match(/<img\b[^>]*>/g) ?? [];
  return { images: imgs.length, withoutAlt: imgs.filter((i) => !/\balt="[^"]*\S[^"]*"/.test(i)).length };
}

const WORDS_PER_PAGE = 300;

/**
 * Page-break markers in a chapter's XHTML body: one at the start (the page the
 * chapter opens on), then one before the block where ~300 words have gone by.
 * Returns the body and the pages it holds (number and id).
 */
export function paginate(body: string, firstPage: number, idPrefix = "page"): { body: string; pages: { n: number; id: string }[] } {
  const pages: { n: number; id: string }[] = [];
  const marker = (n: number) => {
    const id = `${idPrefix}-${n}`;
    pages.push({ n, id });
    // `epub:type="pagebreak"` with its number as the title: Ace's pagebreak-label rule reads the title, and
    // axe 4.10 rejects aria-label here (it maps the deprecated doc-pagebreak role to none).
    return `<span epub:type="pagebreak" id="${id}" title="${n}"></span>`;
  };
  let n = firstPage;
  let words = 0;
  // Split before each top-level block element; a break goes only between blocks.
  const parts = body.split(/(?=<(?:p|h[1-6]|ul|ol|blockquote|pre|table|figure|div|section|hr)\b)/);
  const out: string[] = [marker(n)];
  for (const part of parts) {
    if (words >= WORDS_PER_PAGE && /^<(p|h[1-6]|ul|ol|blockquote|pre|table|figure|div|hr)\b/.test(part)) {
      n++;
      words = 0;
      out.push(marker(n));
    }
    out.push(part);
    words += part.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  }
  return { body: out.join(""), pages };
}

/** The page-list navigation (hidden, as readers show it in their own UI). */
export function pageListNav(entries: { href: string; n: number; id: string }[], label: string): string {
  return `<nav epub:type="page-list" id="page-list" aria-label="${esc(label)}" hidden="hidden"><ol>${entries.map((e) => `<li><a href="${e.href}#${e.id}">${e.n}</a></li>`).join("")}</ol></nav>`;
}
