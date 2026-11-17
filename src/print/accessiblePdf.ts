/**
 * The print document made ready for a tagged PDF (plan W13.F3).
 *
 * Chromium writes a tagged PDF from the document's semantics — headings as
 * H1–H6, `<img alt>` as a Figure with /Alt, `<th scope>` as TH with its
 * scope, `lang` as /Lang — so the PDF is only as accessible as the HTML.
 * This pass fixes what PDF/UA-1 (and the Matterhorn Protocol) fail on:
 *
 *  - headings never skip a level (h1 → h3 becomes h1 → h2; the original
 *    level stays as a class, so it looks the same);
 *  - every image has a text alternative: its own alt, else its title or
 *    caption; an image with none is listed (the person can add one) and gets
 *    its file name rather than nothing; an image marked decorative
 *    (`alt=""` written on purpose with `role="presentation"`) stays an
 *    artifact;
 *  - table header cells get `scope` (col in the header row, row in the
 *    first column of the body), and a table without header cells gets its
 *    first row promoted;
 *  - a run in another script than the note (English in a Hebrew note, and
 *    the reverse) gets its own `lang`, so a screen reader switches voice.
 *
 * It returns what it changed and what still needs a person (images without
 * a real description), for the export's preflight.
 */

export interface PdfPreflight {
  /** Headings renumbered so no level is skipped. */
  headingsRenumbered: number;
  /** Images that had no description; they got their file name. */
  imagesWithoutAlt: string[];
  /** Tables that had no header cells; their first row became the header. */
  tablesWithoutHeaders: number;
  /** Runs in another language marked with `lang`. */
  langSpans: number;
}

const HEBREW = /[\u0590-\u05ff]/;
const LATIN = /[A-Za-z]/;

function fileStem(src: string): string {
  const name = decodeURIComponent((src.split(/[?#]/)[0] ?? "").replace(/^.*\//, "")).replace(/\.[a-z0-9]+$/i, "");
  return /^data:/i.test(src) || !name ? "" : name.replace(/[-_]+/g, " ").trim();
}

/** Keep h1 → h3 from skipping: each heading is at most one level below the one before it. */
function renumberHeadings(root: ParentNode, doc: Document): number {
  let changed = 0;
  let last = 0;
  for (const h of Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
    const level = Number(h.tagName[1]);
    const want = Math.min(level, last + 1);
    if (want !== level) {
      const el = doc.createElement(`h${want}`);
      for (const a of Array.from(h.attributes)) el.setAttribute(a.name, a.value);
      el.classList.add(`lumen-print-h${level}`);
      while (h.firstChild) el.appendChild(h.firstChild);
      h.replaceWith(el);
      changed++;
    }
    last = want;
  }
  return changed;
}

function describeImages(root: ParentNode, fallback: string): string[] {
  const missing: string[] = [];
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const decorative = img.getAttribute("role") === "presentation" || img.getAttribute("aria-hidden") === "true";
    if (decorative) {
      img.setAttribute("alt", "");
      continue;
    }
    const alt = (img.getAttribute("alt") ?? "").trim();
    if (alt) continue;
    const caption = img.closest("figure")?.querySelector("figcaption")?.textContent?.trim();
    const title = img.getAttribute("title")?.trim();
    const src = img.getAttribute("src") ?? "";
    const text = title || caption || fileStem(src);
    missing.push(src.startsWith("data:") ? "(embedded image)" : src);
    img.setAttribute("alt", text || fallback);
  }
  return missing;
}

function headTables(root: ParentNode, doc: Document): number {
  let promoted = 0;
  for (const table of Array.from(root.querySelectorAll("table"))) {
    if (!table.querySelector("th")) {
      const first = table.querySelector("tr");
      if (!first) continue;
      for (const td of Array.from(first.children)) {
        if (td.tagName !== "TD") continue;
        const th = doc.createElement("th");
        for (const a of Array.from(td.attributes)) th.setAttribute(a.name, a.value);
        while (td.firstChild) th.appendChild(td.firstChild);
        td.replaceWith(th);
      }
      promoted++;
    }
    for (const th of Array.from(table.querySelectorAll("th"))) {
      if (th.hasAttribute("scope")) continue;
      const inHead = th.closest("thead") !== null || th.parentElement === table.querySelector("tr");
      th.setAttribute("scope", inHead ? "col" : "row");
    }
  }
  return promoted;
}

/** Mark text nodes in the other script with `lang` (Latin runs in a Hebrew note, Hebrew runs in an English one). */
function markLanguages(root: ParentNode, doc: Document, lang: string): number {
  const he = lang.startsWith("he");
  const other = he ? LATIN : HEBREW;
  const run = he ? /[A-Za-z][A-Za-z0-9'’.\-–— ]*[A-Za-z0-9]|[A-Za-z]/g : /[\u0590-\u05ff][\u0590-\u05ff"'׳״\- ]*[\u0590-\u05ff]|[\u0590-\u05ff]/g;
  let count = 0;
  const walker = doc.createTreeWalker(root as Node, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    const value = t.nodeValue ?? "";
    if (!other.test(value)) continue;
    const parent = t.parentElement;
    // Code, math and SVG are left alone, and so is a part that already says its language.
    if (!parent || parent.closest("code, pre, math, .katex, svg, script, style")) continue;
    const declared = parent.closest("[lang]");
    if (declared && (root as Element).contains(declared)) continue;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of value.matchAll(run)) {
      if (m.index! > last) frag.appendChild(doc.createTextNode(value.slice(last, m.index)));
      const span = doc.createElement("span");
      span.setAttribute("lang", he ? "en" : "he");
      span.textContent = m[0];
      frag.appendChild(span);
      last = m.index! + m[0].length;
      count++;
    }
    if (last < value.length) frag.appendChild(doc.createTextNode(value.slice(last)));
    t.replaceWith(frag);
  }
  return count;
}

/** Make the print content ready for a tagged, PDF/UA-1 PDF. `lang` is the note's language (`he`, `en`…). */
export function makePrintAccessible(root: HTMLElement, opts: { lang: string; fallbackAlt?: string }): PdfPreflight {
  const doc = root.ownerDocument;
  return {
    headingsRenumbered: renumberHeadings(root, doc),
    imagesWithoutAlt: describeImages(root, opts.fallbackAlt ?? "Image"),
    tablesWithoutHeaders: headTables(root, doc),
    langSpans: markLanguages(root, doc, opts.lang),
  };
}

/** The PDF's language tag: a bare `he` becomes `he-IL` (what PDF/UA validators and Acrobat expect), others as they are. */
export function pdfLang(lang: string): string {
  const l = lang.trim() || "en";
  if (/^he$/i.test(l)) return "he-IL";
  if (/^ar$/i.test(l)) return "ar";
  return l;
}
