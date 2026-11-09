/**
 * Archives, ebooks and PDF → Markdown: Notion/Obsidian ZIP exports, EPUB,
 * PDF (text layer, OCR for image-only pages). Split out of ../fileFormats.ts
 * (plan 12.1), which re-exports everything here.
 */
import { unzip } from "../zip";
import { parseInertDocument } from "../../lib/trustedTypes";
import { csvToMarkdown, htmlToMarkdown } from "./markup";
import { els } from "./office";

/* ─── Notion / Obsidian archive → merged Markdown ─────────────────── */

/** Strip Notion's 32-hex-char id suffix and folder path from an entry name. */
function cleanArchiveTitle(name: string): string {
  return (
    name
      .replace(/\.md$/i, "")
      .split("/")
      .pop() ?? name
  )
    .replace(/\s+[0-9a-f]{32}$/i, "")
    .trim();
}

/**
 * Import a Notion export or Obsidian vault (both shipped as a .zip of Markdown
 * files, possibly with CSV databases). Each .md file becomes a section (a
 * leading H1 is added from the cleaned filename if the file lacks one); CSV
 * files render as tables. Obsidian `[[wikilinks]]` pass through unchanged —
 * Lumen renders them natively. Notion's "Title <hash>" names are cleaned up.
 */
export async function archiveToMarkdown(file: File): Promise<string> {
  let files: Map<string, Uint8Array>;
  try {
    files = await unzip(await file.arrayBuffer());
  } catch (err) {
    return `> ⚠️ Could not read archive: ${(err as Error).message}`;
  }
  const dec = new TextDecoder();
  const mdFiles = [...files.keys()].filter((n) => /\.md$/i.test(n) && !n.startsWith("__MACOSX")).sort();
  const csvFiles = [...files.keys()].filter((n) => /\.csv$/i.test(n) && !n.startsWith("__MACOSX")).sort();
  if (!mdFiles.length && !csvFiles.length) {
    return "> ⚠️ Archive contains no Markdown or CSV files.";
  }

  const parts: string[] = [];
  for (const name of mdFiles) {
    const body = dec.decode(files.get(name)!).trim();
    const hasLeadingH1 = /^#\s+/.test(body);
    parts.push(hasLeadingH1 ? body : `# ${cleanArchiveTitle(name)}\n\n${body}`);
  }
  for (const name of csvFiles) {
    parts.push(`## ${cleanArchiveTitle(name)}\n\n${csvToMarkdown(dec.decode(files.get(name)!))}`);
  }
  return parts.join("\n\n---\n\n");
}

/* ─── EPUB → Markdown (zero-dep regex over packaged XHTML) ────────── */

/**
 * Real EPUB import: unzips the archive, reads META-INF/container.xml to find
 * the OPF package, then converts each spine document (in reading order) from
 * XHTML to Markdown. Falls back to converting every (x)html entry if the OPF
 * structure can't be read.
 */
export async function epubToMarkdown(file: File): Promise<string> {
  let files: Map<string, Uint8Array>;
  try {
    files = await unzip(await file.arrayBuffer());
  } catch (err) {
    return `> ⚠️ Could not read EPUB archive: ${(err as Error).message}`;
  }
  const dec = new TextDecoder();
  const textOf = (name: string) => {
    const b = files.get(name);
    return b ? dec.decode(b) : null;
  };
  const htmlToChapter = (html: string) => {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return htmlToMarkdown(`<div>${bodyMatch ? bodyMatch[1] : html}</div>`).trim();
  };

  // Resolve the spine order via container.xml → OPF.
  const container = textOf("META-INF/container.xml");
  const opfPath = container?.match(/full-path="([^"]+)"/i)?.[1];
  const opf = opfPath ? textOf(opfPath) : null;

  const chapters: string[] = [];
  if (opf && opfPath) {
    const opfDir = opfPath.includes("/") ? opfPath.replace(/\/[^/]+$/, "/") : "";
    const doc = parseInertDocument(opf, "application/xml");
    const manifest = new Map<string, string>();
    for (const item of els(doc, "item")) {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      if (id && href) manifest.set(id, href);
    }
    for (const ref of els(doc, "itemref")) {
      const href = manifest.get(ref.getAttribute("idref") ?? "");
      if (!href) continue;
      const html = textOf(decodeURIComponent(opfDir + href));
      if (html) {
        const md = htmlToChapter(html);
        if (md) chapters.push(md);
      }
    }
  }

  // Fallback: every (x)html entry, in archive order.
  if (chapters.length === 0) {
    for (const [name, bytes] of files) {
      if (/\.x?html?$/i.test(name)) {
        const md = htmlToChapter(dec.decode(bytes));
        if (md.length > 30) chapters.push(md);
      }
    }
  }

  return chapters.length
    ? chapters.join("\n\n---\n\n")
    : "> ⚠️ EPUB: no readable chapters found.";
}

/** Most scanned pages one PDF import reads with OCR. */
const PDF_OCR_MAX_PAGES = 30;

/**
 * Join a PDF's per-page text (one entry per page, "" for a page without a
 * text layer). Blank pages are read with `ocrPage` (1-based page number)
 * when given — each blank page, not only when the whole PDF is blank.
 * @internal exported for tests.
 */
export async function mergePdfPageTexts(texts: string[], ocrPage: ((n: number) => Promise<string>) | null): Promise<string> {
  const pages = [...texts];
  let ocred = 0;
  let tried = 0;
  let skipped = 0;
  if (ocrPage) {
    for (let i = 0; i < pages.length; i++) {
      if (pages[i]) continue;
      if (tried >= PDF_OCR_MAX_PAGES) {
        skipped++;
        continue;
      }
      tried++;
      const text = (await ocrPage(i + 1).catch(() => "")).trim();
      if (text) {
        pages[i] = text;
        ocred++;
      }
    }
  }
  const found = pages.filter(Boolean);
  if (!found.length) return "> ⚠️ This PDF has no extractable text (likely a scanned image), and on-device OCR found none either.";
  if (!ocred) return found.join("\n\n---\n\n");
  const head = texts.some(Boolean)
    ? "> ℹ️ Some pages are scanned — their text was recognised on this device (OCR); check it against the original."
    : "> ℹ️ Scanned PDF — text recognised on this device (OCR); check it against the original.";
  const note = skipped ? `\n\n> ℹ️ OCR read the first ${PDF_OCR_MAX_PAGES} of ${tried + skipped} scanned pages.` : "";
  return `${head}\n\n${found.join("\n\n---\n\n")}${note}`;
}

/* ─── PDF → Markdown (lazy-loads pdfjs-dist) ──────────────────────── */

/**
 * Extract a PDF's text into Markdown. Dynamic-imports `pdfjs-dist` (heavy) so
 * the cost is paid only when the user drops a PDF. Uses the locally bundled
 * worker — no CDN — and degrades honestly: scanned/image-only PDFs return a
 * clear "no extractable text" notice instead of silent garbage.
 */
export async function pdfToMarkdown(file: File): Promise<string> {
  type PdfjsModule = {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (src: { data: Uint8Array; isEvalSupported?: boolean }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
        }>;
      }>;
    };
  };
  try {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
    // Bundle the worker locally (no CDN). In the browser Vite emits the asset;
    // under node/vitest there is no Web Worker, so pdf.js falls back to a
    // main-thread "fake worker" and text extraction still works.
    // Worker source — no CDN. In the browser, Vite's `?url` emits the local
    // worker asset. Under node/vitest we hand pdf.js the bare module specifier
    // so it imports the worker via node_modules on the main thread (the `?url`
    // value there is a web path pdf.js can't import).
    const isNode =
      typeof process !== "undefined" && !!(process as { versions?: { node?: string } })?.versions?.node;
    let workerSrc = "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
    if (!isNode) {
      try {
        const url = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
        if (typeof url === "string" && url) workerSrc = url;
      } catch {
        /* why: keep the bare specifier, which Node and the tests resolve */
      }
    }
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    const texts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      texts.push(
        content.items
          .map((it) => it.str ?? "")
          .join(" ")
          .replace(/[ \t]{2,}/g, " ")
          .trim(),
      );
    }
    // Scanned pages (no text layer): render each and read it with on-device
    // OCR (Hebrew + English, T31) — also in a mixed PDF whose cover or page
    // numbers do have text. Browser only — tests have no canvas.
    let ocrPage: ((n: number) => Promise<string>) | null = null;
    if (!isNode && typeof document !== "undefined" && texts.some((t) => !t)) {
      const { ocrImage } = await import("../../ai/ocr");
      ocrPage = async (n) => {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return "";
        await page.render({ canvasContext: ctx, viewport }).promise;
        return (await ocrImage(canvas).catch(() => ({ text: "" }))).text;
      };
    }
    return await mergePdfPageTexts(texts, ocrPage);
  } catch (err) {
    return "> ⚠️ Couldn't read this PDF: " + (err as Error).message;
  }
}
