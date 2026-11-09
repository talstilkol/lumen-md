/**
 * File format converters — zero external dependencies.
 *
 * Text/markup: Markdown, HTML, RTF, XML, CSV/TSV/JSON, LaTeX, RST, AsciiDoc,
 * Org, OPML, MHTML/EML. Office/ebook (ZIP-of-XML): DOCX, ODT, EPUB — unzipped
 * via the native DecompressionStream-based reader in ./zip (no JSZip/mammoth).
 * Apple iWork (.pages/.numbers/.key) via ./iwork. Legacy .doc and image-only
 * PDF remain best-effort. All convert to Markdown.
 *
 * Uses browser-native DOMParser for XML/HTML parsing.
 *
 * The converters live in ./formats/ (markup, office, books, text — split in
 * plan 12.1); this module picks one by extension and re-exports them all, so
 * importers keep importing from here.
 */
import { iworkToMarkdown } from "./iwork";
import { rtfToMarkdown, htmlToMarkdown, csvToMarkdown, tsvToMarkdown, jsonToMarkdown, xmlToMarkdown } from "./formats/markup";
import { confluenceToMarkdown, wxrToMarkdown, legacyDocToMarkdown, mhtmlToMarkdown, opmlToMarkdown, latexToMarkdown, rstToMarkdown, adocToMarkdown, orgToMarkdown, ipynbToMarkdown, fountainToMarkdown } from "./formats/text";
import { docxToMarkdown, odtToMarkdown, pptxToMarkdown, xlsxToMarkdown } from "./formats/office";
import { archiveToMarkdown, pdfToMarkdown, epubToMarkdown } from "./formats/books";

export { htmlToMarkdown, rtfToMarkdown, csvToMarkdown, tsvToMarkdown, jsonToMarkdown, xmlToMarkdown } from "./formats/markup";
export { docxToMarkdown, odtToMarkdown, pptxToMarkdown, xlsxToMarkdown } from "./formats/office";
export { archiveToMarkdown, epubToMarkdown, mergePdfPageTexts, pdfToMarkdown } from "./formats/books";
export { mhtmlToMarkdown, opmlToMarkdown, latexToMarkdown, rstToMarkdown, legacyDocToMarkdown, adocToMarkdown, orgToMarkdown, ipynbToMarkdown, wxrToMarkdown, confluenceToMarkdown, fountainToMarkdown } from "./formats/text";

/* ─── Unified file importer ─── */

export async function fileToMarkdown(file: File): Promise<{ name: string; content: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const baseName = file.name.replace(/\.[^.]+$/, "");

  switch (ext) {
    case "rtf": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: rtfToMarkdown(text) };
    }
    case "html":
    case "htm": {
      const text = await file.text();
      // Confluence exports are XHTML wrapped in ac:/ri: macros — detect + route.
      const isConfluence = /xmlns:ac=|<ac:structured-macro|<ac:rich-text-body/i.test(text);
      return {
        name: `${baseName}.md`,
        content: isConfluence ? confluenceToMarkdown(text) : htmlToMarkdown(text),
      };
    }
    case "csv": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: csvToMarkdown(text) };
    }
    case "tsv": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: tsvToMarkdown(text) };
    }
    case "json": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: jsonToMarkdown(text) };
    }
    case "xml": {
      const text = await file.text();
      // WordPress eXtended RSS exports are .xml; route them to the WXR reader.
      const isWxr = /<wp:|xmlns:wp=/i.test(text);
      return {
        name: `${baseName}.md`,
        content: isWxr ? wxrToMarkdown(text) : xmlToMarkdown(text),
      };
    }
    case "doc": {
      return { name: `${baseName}.md`, content: await legacyDocToMarkdown(file) };
    }
    case "docx": {
      return { name: `${baseName}.md`, content: await docxToMarkdown(file) };
    }
    case "odt": {
      return { name: `${baseName}.md`, content: await odtToMarkdown(file) };
    }
    case "pptx": {
      return { name: `${baseName}.md`, content: await pptxToMarkdown(file) };
    }
    case "xlsx": {
      return { name: `${baseName}.md`, content: await xlsxToMarkdown(file) };
    }
    case "zip": {
      // Notion export / Obsidian vault — a zip of Markdown (+ CSV).
      return { name: `${baseName}.md`, content: await archiveToMarkdown(file) };
    }
    case "mhtml":
    case "mht":
    case "eml": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: mhtmlToMarkdown(text) };
    }
    case "pdf": {
      const content = await pdfToMarkdown(file);
      return { name: `${baseName}.md`, content };
    }
    case "epub": {
      const content = await epubToMarkdown(file);
      return { name: `${baseName}.md`, content };
    }
    case "opml": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: opmlToMarkdown(text) };
    }
    case "tex":
    case "ltx": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: latexToMarkdown(text) };
    }
    case "rst": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: rstToMarkdown(text) };
    }
    case "adoc":
    case "asciidoc": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: adocToMarkdown(text) };
    }
    case "org": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: orgToMarkdown(text) };
    }
    case "ipynb": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: ipynbToMarkdown(text) };
    }
    case "pages":
    case "numbers":
    case "key": {
      // Apple iWork — ZIP of XML ('09) or snappy-framed protobuf (IWA, '13+).
      const content = await iworkToMarkdown(await file.arrayBuffer(), ext, {
        pdfFallback: (pdf) =>
          pdfToMarkdown({
            name: "Preview.pdf",
            arrayBuffer: async () => pdf.slice().buffer,
          } as unknown as File),
      });
      return { name: `${baseName}.md`, content };
    }
    case "fountain":
    case "spmd": {
      const text = await file.text();
      return { name: `${baseName}.md`, content: fountainToMarkdown(text) };
    }
    case "yaml":
    case "yml":
    case "toml":
    case "text":
    case "markdown":
    case "mdown":
    case "mkd":
    case "md":
    case "txt":
      return { name: file.name, content: await file.text() };
    default:
      return { name: file.name, content: await file.text() };
  }
}

export const SUPPORTED_IMPORT_EXTENSIONS = [
  // Plain text + markdown family
  "md", "markdown", "mdown", "mkd", "txt", "text",
  // Tabular
  "csv", "tsv", "json", "xml", "yaml", "yml", "toml",
  // Office
  "rtf", "doc", "docx", "odt", "pptx", "xlsx",
  // Apple iWork
  "pages", "numbers", "key",
  // Archives (Notion export / Obsidian vault)
  "zip",
  // Web
  "html", "htm", "mhtml", "mht", "eml",
  // Documents
  "pdf", "epub",
  // Outlines
  "opml",
  // Other markup
  "tex", "ltx", "rst", "adoc", "asciidoc", "org",
  // Notebooks
  "ipynb",
  // Screenwriting
  "fountain", "spmd",
];

export function isSupportedFormat(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_IMPORT_EXTENSIONS.includes(ext);
}
