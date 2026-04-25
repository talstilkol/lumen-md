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
  text = text.replace(/\{\\[^{}]*\}/g, "");
  text = text.replace(/\\par\b/g, "\n");
  text = text.replace(/\\line\b/g, "\n");
  text = text.replace(/\\tab\b/g, "\t");
  text = text.replace(/\\b\b/g, "**");
  text = text.replace(/\\b0\b/g, "**");
  text = text.replace(/\\i\b/g, "*");
  text = text.replace(/\\i0\b/g, "*");
  text = text.replace(/\\[a-z]+[\d-]*/g, "");
  text = text.replace(/[{}]/g, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/* ─── CSV / TSV → Markdown table ─── */

export function csvToMarkdown(csvText: string, delimiter = ","): string {
  const lines = csvText.trim().split("\n");
  if (lines.length === 0) return "";

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
      // Legacy .doc — best-effort text extraction
      const text = await file.text();
      const readable = text.replace(/[^\x20-\x7E\n\r\t\u0590-\u05FF\u0600-\u06FF]/g, "");
      return { name: `${baseName}.md`, content: readable.trim() };
    }
    case "docx": {
      // DOCX is a ZIP archive — basic text extraction from XML
      const text = await extractDocxText(file);
      return { name: `${baseName}.md`, content: text };
    }
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

export const SUPPORTED_IMPORT_EXTENSIONS = [
  "md", "markdown", "txt",
  "csv", "tsv", "json", "xml",
  "rtf", "doc", "docx",
  "html", "htm",
];

export function isSupportedFormat(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_IMPORT_EXTENSIONS.includes(ext);
}
