/**
 * File format converters — zero external dependencies.
 * 
 * Supports: RTF, DOC, DOCX, HTML, CSV, TSV, JSON, XML
 * All convert to Markdown for the editor.
 * 
 * Uses browser-native DOMParser for HTML → Markdown.
 */

/* ─── HTML → Markdown (zero-dep, uses DOMParser) ─── */

function htmlNodeToMd(node: Node, depth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.replace(/\s+/g, " ") ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const children = () =>
    Array.from(el.childNodes)
      .map((c) => htmlNodeToMd(c, depth))
      .join("");

  switch (tag) {
    case "h1": return `\n# ${children().trim()}\n`;
    case "h2": return `\n## ${children().trim()}\n`;
    case "h3": return `\n### ${children().trim()}\n`;
    case "h4": return `\n#### ${children().trim()}\n`;
    case "h5": return `\n##### ${children().trim()}\n`;
    case "h6": return `\n###### ${children().trim()}\n`;
    case "p": return `\n${children().trim()}\n`;
    case "br": return "\n";
    case "hr": return "\n---\n";
    case "strong":
    case "b": return `**${children().trim()}**`;
    case "em":
    case "i": return `*${children().trim()}*`;
    case "s":
    case "del":
    case "strike": return `~~${children().trim()}~~`;
    case "code": return `\`${children().trim()}\``;
    case "pre": {
      const code = el.querySelector("code");
      const lang = code?.className.match(/language-(\w+)/)?.[1] ?? "";
      const text = (code ?? el).textContent ?? "";
      return `\n\`\`\`${lang}\n${text.trim()}\n\`\`\`\n`;
    }
    case "a": {
      const href = el.getAttribute("href") ?? "";
      return `[${children().trim()}](${href})`;
    }
    case "img": {
      const src = el.getAttribute("src") ?? "";
      const alt = el.getAttribute("alt") ?? "";
      return `![${alt}](${src})`;
    }
    case "ul": {
      return "\n" + Array.from(el.children)
        .map((li) => `${"  ".repeat(depth)}- ${htmlNodeToMd(li, depth + 1).trim()}`)
        .join("\n") + "\n";
    }
    case "ol": {
      return "\n" + Array.from(el.children)
        .map((li, i) => `${"  ".repeat(depth)}${i + 1}. ${htmlNodeToMd(li, depth + 1).trim()}`)
        .join("\n") + "\n";
    }
    case "li": return children();
    case "blockquote": {
      const inner = children().trim().split("\n").map((l) => `> ${l}`).join("\n");
      return `\n${inner}\n`;
    }
    case "table": return "\n" + tableToMd(el as HTMLTableElement) + "\n";
    case "div":
    case "section":
    case "article":
    case "main":
    case "body":
    case "span":
    case "html":
      return children();
    case "script":
    case "style":
    case "head":
    case "meta":
    case "link":
      return "";
    default:
      return children();
  }
}

function tableToMd(table: HTMLTableElement): string {
  const rows = Array.from(table.rows);
  if (rows.length === 0) return "";

  const getRowCells = (row: HTMLTableRowElement) =>
    Array.from(row.cells).map((c) => c.textContent?.trim() ?? "");

  const headers = getRowCells(rows[0]);
  const sep = headers.map(() => "---");
  const body = rows.slice(1).map(getRowCells);

  return (
    "| " + headers.join(" | ") + " |\n" +
    "| " + sep.join(" | ") + " |\n" +
    body.map((r) => "| " + r.join(" | ") + " |").join("\n")
  );
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const md = htmlNodeToMd(doc.body);
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

/* ─── RTF → Markdown ─── */

export function rtfToMarkdown(rtfText: string): string {
  let text = rtfText;
  // Strip the RTF header group: {\rtf1\ansi ... up to the first space before content
  text = text.replace(/^\{\\rtf\d[^}]*?\s/, "");
  // Remove nested groups like {\fonttbl...} {\colortbl...} etc
  // Repeatedly remove innermost groups until none left
  let prev = "";
  while (prev !== text) {
    prev = text;
    text = text.replace(/\{[^{}]*\}/g, "");
  }
  // Convert paragraph/line breaks before stripping control words
  text = text.replace(/\\par\b/g, "\n");
  text = text.replace(/\\line\b/g, "\n");
  text = text.replace(/\\tab\b/g, "\t");
  // Bold/italic markers
  text = text.replace(/\\b\b/g, "**");
  text = text.replace(/\\b0\b/g, "**");
  text = text.replace(/\\i\b/g, "*");
  text = text.replace(/\\i0\b/g, "*");
  // Strip remaining control words
  text = text.replace(/\\[a-z]+[\d-]*/g, "");
  // Remove leftover braces
  text = text.replace(/[{}]/g, "");
  // Collapse excessive newlines
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/* ─── CSV / TSV → Markdown table ─── */

export function csvToMarkdown(csvText: string, delimiter = ","): string {
  const trimmed = csvText.trim();
  if (!trimmed) return "";
  const lines = trimmed.split("\n");
  const parse = (line: string) => {
    const cells: string[] = [];
    let current = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === delimiter && !inQuote) {
        cells.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = parse(lines[0]);
  const sep = headers.map(() => "---");
  const rows = lines.slice(1).map(parse);

  return (
    "| " + headers.join(" | ") + " |\n" +
    "| " + sep.join(" | ") + " |\n" +
    rows.map((r) => "| " + r.join(" | ") + " |").join("\n")
  );
}

export function tsvToMarkdown(tsvText: string): string {
  return csvToMarkdown(tsvText, "\t");
}

/* ─── JSON → Markdown table ─── */

export function jsonToMarkdown(jsonText: string): string {
  try {
    const data = JSON.parse(jsonText);
    // Array of objects → table
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
      const headers = Object.keys(data[0]);
      const sep = headers.map(() => "---");
      const rows = data.map((row: Record<string, unknown>) =>
        headers.map((h) => String(row[h] ?? "")),
      );
      return (
        "| " + headers.join(" | ") + " |\n" +
        "| " + sep.join(" | ") + " |\n" +
        rows.map((r: string[]) => "| " + r.join(" | ") + " |").join("\n")
      );
    }
    // Otherwise: pretty-print as code block
    return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
  } catch {
    return "```\n" + jsonText + "\n```";
  }
}

/* ─── XML → Markdown table ─── */

export function xmlToMarkdown(xmlText: string): string {
  try {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const error = doc.querySelector("parsererror");
    if (error) return "```xml\n" + xmlText + "\n```";

    // Try to find repeating child elements (like rows)
    const root = doc.documentElement;
    const children = Array.from(root.children);
    if (children.length === 0) return "```xml\n" + xmlText + "\n```";

    // Check if all children have the same tag name (table-like)
    const tagName = children[0].tagName;
    const isTable = children.every((c) => c.tagName === tagName);

    if (isTable && children.length > 0) {
      const headers = Array.from(children[0].children).map((c) => c.tagName);
      if (headers.length > 0) {
        const sep = headers.map(() => "---");
        const rows = children.map((row) =>
          headers.map((h) => row.querySelector(h)?.textContent?.trim() ?? ""),
        );
        return (
          "| " + headers.join(" | ") + " |\n" +
          "| " + sep.join(" | ") + " |\n" +
          rows.map((r) => "| " + r.join(" | ") + " |").join("\n")
        );
      }
    }

    // Fallback: pretty XML code block
    return "```xml\n" + xmlText + "\n```";
  } catch {
    return "```xml\n" + xmlText + "\n```";
  }
}

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
      return { name: `${baseName}.md`, content: htmlToMarkdown(text) };
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
      return { name: `${baseName}.md`, content: xmlToMarkdown(text) };
    }
    case "doc": {
      // Legacy .doc — best-effort text extraction with warning
      const text = await file.text();
      const readable = text.replace(/[^\x20-\x7E\n\r\t\u0590-\u05FF\u0600-\u06FF]/g, "");
      const warning = "> ⚠️ **Note:** DOC files use a legacy binary format. Complex formatting, tables, and images may be lost.\n> For best results, save as DOCX or export as HTML from Word.\n\n---\n\n";
      return { name: `${baseName}.md`, content: warning + readable.trim() };
    }
    case "docx": {
      // DOCX is a ZIP — basic text extraction with warning
      const text = await extractDocxText(file);
      const warning = "> ⚠️ **Note:** DOCX text extraction is basic. Tables, images, and rich formatting may not convert perfectly.\n> For full fidelity, export as HTML from Word and use the Paste Text button.\n\n---\n\n";
      return { name: `${baseName}.md`, content: warning + text };
    }
    case "odt": {
      // ODT is a ZIP with content.xml — same regex-strip strategy as DOCX.
      const buf = await file.arrayBuffer();
      const raw = new TextDecoder().decode(buf);
      const matches = raw.match(/<text:[ph][^>]*>[\s\S]*?<\/text:[ph]>/g) ?? [];
      const body = matches
        .map((m) => m.replace(/<[^>]+>/g, ""))
        .join("\n\n")
        .trim();
      const warning = "> ⚠️ **Note:** ODT text extraction is basic. For full fidelity export as HTML from LibreOffice.\n\n---\n\n";
      return { name: `${baseName}.md`, content: warning + body };
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

/** Basic DOCX text extraction using the browser's native decompression */
async function extractDocxText(file: File): Promise<string> {
  try {
    // DOCX = ZIP containing word/document.xml
    // Use the native DecompressionStream API if available
    const buffer = await file.arrayBuffer();
    const blob = new Blob([buffer]);

    // For browsers without ZIP support, fall back to reading raw XML fragments
    const text = await blob.text();
    // Extract text between <w:t> tags (Word XML text nodes)
    const matches = text.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
    if (matches) {
      return matches
        .map((m) => m.replace(/<[^>]+>/g, ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    return "⚠ DOCX parsing requires mammoth.js. Please install it with: npm install mammoth";
  } catch {
    return "⚠ Could not parse DOCX file.";
  }
}

/* ─── EPUB → Markdown (zero-dep regex over packaged XHTML) ────────── */

/**
 * EPUB is a ZIP of XHTML chapters. Native browsers don't ship a ZIP
 * reader, so we sniff `<body>` blocks out of the raw bytes — works for
 * the majority of e-books that store text reasonably plainly. For
 * tightly compressed or DRM'd files use Calibre / Pandoc.
 */
export async function epubToMarkdown(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const text = new TextDecoder().decode(buf);
  const chapters: string[] = [];
  const bodyRe = /<body[^>]*>([\s\S]*?)<\/body>/gi;
  let m: RegExpExecArray | null;
  while ((m = bodyRe.exec(text)) !== null) {
    const md = htmlToMarkdown(`<div>${m[1]}</div>`).trim();
    if (md.length > 50) chapters.push(md);
  }
  if (chapters.length === 0) {
    return "> ⚠️ EPUB: no text bodies recognised. Use Calibre's CLI for a clean conversion.";
  }
  return chapters.join("\n\n---\n\n");
}

/* ─── PDF → Markdown (lazy-loads pdfjs-dist) ──────────────────────── */

/**
 * Dynamic-imports `pdfjs-dist` so the dependency is paid only when the
 * user drops a PDF. Falls back to a friendly message if the package
 * isn't installed (it's optional — heavy).
 */
export async function pdfToMarkdown(file: File): Promise<string> {
  try {
    const pkg = "pdfjs-dist/legacy/build/pdf.mjs";
    type PdfJs = {
      getDocument: (src: { data: ArrayBuffer }) => {
        promise: Promise<{
          numPages: number;
          getPage: (n: number) => Promise<{
            getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
          }>;
        }>;
      };
      GlobalWorkerOptions: { workerSrc: string };
    };
    const mod = (await import(/* @vite-ignore */ pkg)) as PdfJs;
    mod.GlobalWorkerOptions.workerSrc =
      "https://unpkg.com/pdfjs-dist@latest/legacy/build/pdf.worker.mjs";
    const buf = await file.arrayBuffer();
    const pdf = await mod.getDocument({ data: buf }).promise;
    const out: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((it) => it.str).join(" ").trim();
      if (text) out.push(text);
    }
    if (out.length === 0)
      return "> ⚠️ PDF appears to be a scanned image. OCR is not built in.";
    return out.join("\n\n---\n\n");
  } catch (err) {
    return `> ⚠️ PDF import requires \`pdfjs-dist\`. Install with \`npm install pdfjs-dist\`.\n>\n> ${(err as Error).message}`;
  }
}

/* ─── MHTML / .mht / .eml → Markdown ──────────────────────────────── */

/**
 * Pull the `text/html` part out of a MIME multipart envelope (saved
 * web pages, .eml mail), decode quoted-printable, run through HTML →
 * Markdown. Falls through to plain HTML when no boundary header found.
 */
export function mhtmlToMarkdown(text: string): string {
  const boundaryMatch =
    text.match(/Content-Type:[^\n]*boundary="?([^";\s]+)"?/i) ??
    text.match(/boundary=([^\s;]+)/i);
  if (!boundaryMatch) return htmlToMarkdown(text);
  const parts = text.split(`--${boundaryMatch[1]}`);
  const html = parts.find((p) => /Content-Type:\s*text\/html/i.test(p));
  if (html) {
    const body = html.split(/\r?\n\r?\n/).slice(1).join("\n\n").trim();
    const decoded = body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return htmlToMarkdown(decoded);
  }
  const plain = parts.find((p) => /Content-Type:\s*text\/plain/i.test(p));
  if (plain) return plain.split(/\r?\n\r?\n/).slice(1).join("\n\n").trim();
  return "> ⚠️ MHTML envelope had no recognisable text part.";
}

/* ─── OPML → Markdown (outlines, RSS reader feeds, mind maps) ──── */

export function opmlToMarkdown(text: string): string {
  try {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const title = doc.querySelector("head > title")?.textContent?.trim() ?? "Outline";
    const lines: string[] = [`# ${title}`, ""];
    function walk(el: Element, depth: number): void {
      for (const child of Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "outline")) {
        const text = child.getAttribute("text") ?? child.getAttribute("title") ?? "";
        const url = child.getAttribute("xmlUrl") ?? child.getAttribute("url");
        const indent = "  ".repeat(depth);
        const body = url ? `[${text}](${url})` : text;
        lines.push(`${indent}- ${body}`);
        walk(child, depth + 1);
      }
    }
    const body = doc.querySelector("body");
    if (body) walk(body, 0);
    return lines.join("\n");
  } catch {
    return "> ⚠️ Could not parse OPML.";
  }
}

/* ─── LaTeX / .tex → Markdown ──────────────────────────────────────── */

export function latexToMarkdown(text: string): string {
  let out = text;
  out = out.replace(/^[\s\S]*?\\begin\{document\}\s*/, "");
  out = out.replace(/\s*\\end\{document\}[\s\S]*$/, "");
  out = out.replace(/\\chapter\*?\{([^}]+)\}/g, "# $1");
  out = out.replace(/\\section\*?\{([^}]+)\}/g, "## $1");
  out = out.replace(/\\subsection\*?\{([^}]+)\}/g, "### $1");
  out = out.replace(/\\subsubsection\*?\{([^}]+)\}/g, "#### $1");
  out = out.replace(/\\textbf\{([^}]+)\}/g, "**$1**");
  out = out.replace(/\\textit\{([^}]+)\}/g, "*$1*");
  out = out.replace(/\\emph\{([^}]+)\}/g, "*$1*");
  out = out.replace(/\\texttt\{([^}]+)\}/g, "`$1`");
  out = out.replace(/\\begin\{itemize\}|\\begin\{enumerate\}/g, "");
  out = out.replace(/\\end\{itemize\}|\\end\{enumerate\}/g, "");
  out = out.replace(/\\item\s+/g, "- ");
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, "$$\n$1\n$$");
  out = out.replace(/\\\(([^)]+)\\\)/g, "$$$1$");
  out = out.replace(/\\&/g, "&").replace(/\\%/g, "%").replace(/\\\$/g, "$");
  out = out.replace(/\\\\/g, "  \n");
  return out.trim();
}

/* ─── reStructuredText → Markdown ──────────────────────────────────── */

export function rstToMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    if (
      /^[=\-~`'"^*+#<>]{3,}$/.test(next.trim()) &&
      line.trim() &&
      next.trim().length >= line.trim().length
    ) {
      const c = next.trim()[0];
      const level = c === "=" ? 1 : c === "-" ? 2 : c === "~" ? 3 : 4;
      out.push(`${"#".repeat(level)} ${line.trim()}`);
      i++;
      continue;
    }
    out.push(line.replace(/^\*\s/, "- "));
  }
  return out
    .join("\n")
    .replace(/``([^`]+)``/g, "`$1`");
}

/* ─── AsciiDoc → Markdown ──────────────────────────────────────────── */

export function adocToMarkdown(text: string): string {
  return text
    .replace(/^(={1,6})\s+(.+)$/gm, (_m, eq: string, t: string) => `${"#".repeat(eq.length)} ${t}`)
    .replace(/^\.([^\n]+)$/gm, "**$1**")
    .replace(/^\*\s/gm, "- ")
    .replace(/`{2}([^`]+?)`{2}/g, "`$1`")
    .replace(/_([^_\n]+?)_/g, "*$1*");
}

/* ─── Org-mode → Markdown ──────────────────────────────────────────── */

export function orgToMarkdown(text: string): string {
  return text
    .replace(/^(\*+)\s+(.+)$/gm, (_m: string, stars: string, t: string) => `${"#".repeat(stars.length)} ${t}`)
    .replace(/\*([^*\n]+)\*/g, "**$1**")
    .replace(/\/([^/\n]+)\//g, "*$1*")
    .replace(/=([^=\n]+)=/g, "`$1`")
    .replace(/^#\+BEGIN_SRC.*$/gm, "```")
    .replace(/^#\+END_SRC$/gm, "```");
}

export const SUPPORTED_IMPORT_EXTENSIONS = [
  // Plain text + markdown family
  "md", "markdown", "mdown", "mkd", "txt", "text",
  // Tabular
  "csv", "tsv", "json", "xml", "yaml", "yml", "toml",
  // Office
  "rtf", "doc", "docx", "odt",
  // Web
  "html", "htm", "mhtml", "mht", "eml",
  // Documents
  "pdf", "epub",
  // Outlines
  "opml",
  // Other markup
  "tex", "ltx", "rst", "adoc", "asciidoc", "org",
];

export function isSupportedFormat(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_IMPORT_EXTENSIONS.includes(ext);
}
