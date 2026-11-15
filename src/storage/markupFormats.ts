/**
 * Text and markup formats → Markdown (split out of fileFormats.ts, plan W4.11):
 * HTML, RTF, CSV/TSV, JSON, XML, MHTML/EML, OPML, LaTeX, RST, AsciiDoc, Org,
 * Jupyter notebooks, WordPress WXR and Confluence. Zero external dependencies;
 * fileFormats.ts re-exports every one of them, so importers are unchanged.
 */
import { parseInertDocument } from "../lib/trustedTypes";

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
    case "b": return emphasis("**", children());
    case "em":
    case "i": return emphasis("*", children());
    case "s":
    case "del":
    case "strike": return emphasis("~~", children());
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
      const start = parseInt(el.getAttribute("start") ?? "1", 10) || 1;
      return "\n" + Array.from(el.children)
        .map((li, i) => `${"  ".repeat(depth)}${start + i}. ${htmlNodeToMd(li, depth + 1).trim()}`)
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

  // A cell keeps its inline Markdown (bold, links, code); a | in it is escaped.
  const getRowCells = (row: HTMLTableRowElement) =>
    Array.from(row.cells).map((c) => htmlNodeToMd(c).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|"));

  const headers = getRowCells(rows[0]);
  const sep = headers.map(() => "---");
  const body = rows.slice(1).map(getRowCells);

  return (
    "| " + headers.join(" | ") + " |\n" +
    "| " + sep.join(" | ") + " |\n" +
    body.map((r) => "| " + r.join(" | ") + " |").join("\n")
  );
}

/**
 * Emphasis around the text, the spaces at its edges left outside: `<b>bold </b>and`
 * is `**bold** and`, never `**bold**and` (W6.38, Evernote notes).
 */
function emphasis(mark: string, inner: string): string {
  const core = inner.trim();
  if (!core) return inner;
  return `${/^\s*/.exec(inner)![0]}${mark}${core}${mark}${/\s*$/.exec(inner)![0]}`;
}

export function htmlToMarkdown(html: string): string {
  const doc = parseInertDocument(html, "text/html");
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
    const doc = parseInertDocument(xmlText, "text/xml");
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

/**
 * OPML → Markdown. An outline with `_heading` (written by markdownToOpml) or
 * with a `_note` (pandoc, OmniOutliner, Fargo) is a heading: `_heading` gives
 * its level, otherwise its depth among heading outlines does; its `_note` is
 * the section's Markdown. An outline with only a `_note` is body text. Every
 * other outline is a bullet, nested under the nearest heading.
 */
export function opmlToMarkdown(text: string): string {
  try {
    const doc = parseInertDocument(text, "application/xml");
    const title = doc.querySelector("head > title")?.textContent?.trim() ?? "Outline";
    const blocks: string[] = [`# ${title}`];
    let list: string[] = [];
    const flush = (): void => {
      if (list.length) blocks.push(list.join("\n"));
      list = [];
    };
    const outlines = (el: Element): Element[] => Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "outline");
    function walk(el: Element, depth: number, headingLevel: number): void {
      for (const child of outlines(el)) {
        const text = child.getAttribute("text") ?? child.getAttribute("title") ?? "";
        const note = child.getAttribute("_note");
        const level = Number(child.getAttribute("_heading"));
        if (level >= 1 || (note !== null && text)) {
          flush();
          const lv = level >= 1 ? Math.min(6, level) : Math.min(6, headingLevel + 1);
          blocks.push(`${"#".repeat(lv)} ${text}`.trimEnd());
          if (note?.trim()) blocks.push(note);
          walk(child, 0, lv);
          continue;
        }
        if (note !== null) {
          flush();
          if (note.trim()) blocks.push(note);
          walk(child, depth, headingLevel);
          continue;
        }
        const url = child.getAttribute("xmlUrl") ?? child.getAttribute("url");
        list.push(`${"  ".repeat(depth)}- ${url ? `[${text}](${url})` : text}`);
        walk(child, depth + 1, headingLevel);
      }
    }
    const body = doc.querySelector("body");
    if (body) walk(body, 0, 0);
    flush();
    return blocks.join("\n\n");
  } catch {
    return "> ⚠️ Could not parse OPML.";
  }
}

/* ─── LaTeX / .tex → Markdown ──────────────────────────────────────── */

/** The `{…}` argument that starts at `open` (balanced braces, `\{` skipped); [inner, index after `}`]. */
function latexGroup(s: string, open: number): [string, number] | null {
  if (s[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return [s.slice(open + 1, i), i + 1];
  }
  return null;
}

/** Replace `\cmd{arg}` (and `\cmd*{arg}`) everywhere, with nested braces in the argument. */
function latexCommand(s: string, cmd: string, fn: (arg: string) => string): string {
  const re = new RegExp(`\\\\${cmd}\\*?(?=\\{)`, "g");
  let out = "";
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const g = latexGroup(s, m.index + m[0].length);
    if (!g) continue;
    out += s.slice(last, m.index) + fn(g[0]);
    last = g[1];
    re.lastIndex = g[1];
  }
  return out + s.slice(last);
}

const LATEX_ESCAPES: Record<string, string> = { "#": "#", $: "$", "%": "%", "&": "&", _: "_", "{": "{", "}": "}", "~": "~", "^": "^" };

/** Inline LaTeX → Markdown: emphasis, code, links, language wrappers, escapes. */
function latexInline(s: string): string {
  let out = s.replace(/\\textbackslash\{\}/g, "\u0000");
  // Polyglossia wrappers that the exporter (and LaTeX authors) put around a
  // passage in the other language carry no Markdown meaning.
  out = latexCommand(out, "text(?:english|hebrew|arabic)", (a) => a);
  out = latexCommand(out, "texttt", (a) => "`" + a + "`");
  out = latexCommand(out, "textbf", (a) => `**${a}**`);
  out = latexCommand(out, "(?:textit|emph)", (a) => `*${a}*`);
  out = out.replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, "[$2]($1)");
  out = out.replace(/\\url\{([^}]*)\}/g, "<$1>");
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, "$$\n$1\n$$");
  out = out.replace(/\\\(([^)]+)\\\)/g, "$$$1$");
  out = out.replace(/\\\\(?=\s*$)/gm, "  ");
  return out.replace(/\\([#$%&_{}~^])/g, (_m, c: string) => LATEX_ESCAPES[c]).replace(/\u0000/g, "\\");
}

/**
 * LaTeX → Markdown. Heading levels follow the document's class the way pandoc
 * reads them: in an article (no `\chapter`) `\section` is `#`; when the file
 * has chapters, `\chapter` is `#` and `\section` is `##`. `\paragraph` and
 * `\subparagraph` are the levels below `\subsubsection`.
 */
export function latexToMarkdown(text: string): string {
  let body = text.replace(/\r\n?/g, "\n");
  body = body.replace(/^[\s\S]*?\\begin\{document\}[ \t]*\n?/, "");
  body = body.replace(/\s*\\end\{document\}[\s\S]*$/, "");
  const shift = /\\chapter\*?\{/.test(body) ? 1 : 0;
  const levels: Array<[string, number]> = [
    ["chapter", 0],
    ["section", 1],
    ["subsection", 2],
    ["subsubsection", 3],
    ["paragraph", 4],
    ["subparagraph", 5],
  ];
  const out: string[] = [];
  // Open lists: kind, next number, and the Markdown column of the current item's content.
  const lists: Array<{ kind: "ul" | "ol"; next: number; content: number; alt: boolean }> = [];
  let verbatim: string | null = null; // the open code block's indent
  let lang = "";
  // The kind and depth of the list that just ended, so a list right after it
  // gets the other bullet (two adjacent Markdown lists would merge).
  let ended: { kind: "ul" | "ol"; depth: number; alt: boolean } | null = null;
  for (const line of body.split("\n")) {
    if (verbatim !== null) {
      if (/^\s*\\end\{(?:verbatim|lstlisting)\}\s*$/.test(line)) {
        out.push(verbatim + "```");
        verbatim = null;
      } else out.push(line);
      continue;
    }
    const code = /^(\s*)\\begin\{(?:verbatim|lstlisting)\}(?:\[(?:[^\]]*language=([\w+#-]+))?[^\]]*\])?\s*$/.exec(line);
    if (code) {
      verbatim = code[1];
      out.push(verbatim + "```" + (lang || code[2] || ""));
      lang = "";
      continue;
    }
    const codeLang = /^\s*% code: (\S+)\s*$/.exec(line);
    if (codeLang) {
      lang = codeLang[1];
      continue;
    }
    if (/^\s*%/.test(line)) continue; // a comment line
    const env = /^\s*\\(begin|end)\{(itemize|enumerate|english|hebrew|arabic)\}\s*$/.exec(line);
    if (env) {
      if (env[2] === "itemize" || env[2] === "enumerate") {
        const outer = lists[lists.length - 1];
        const kind = env[2] === "itemize" ? "ul" : "ol";
        if (env[1] === "begin") {
          const alt = !!ended && ended.kind === kind && ended.depth === lists.length && !ended.alt;
          lists.push({ kind, next: 1, content: outer ? outer.content : 0, alt });
        } else {
          const done = lists.pop();
          ended = done ? { kind: done.kind, depth: lists.length, alt: done.alt } : null;
        }
      }
      continue;
    }
    if (line.trim() && !/^\s*\\setcounter\{/.test(line)) ended = null;
    const h = /^\s*\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?=\{)/.exec(line);
    const g = h ? latexGroup(line, h[0].length) : null;
    if (h && g) {
      const level = Math.min(6, Math.max(1, levels.find(([c]) => c === h[1])![1] + shift));
      out.push(`${"#".repeat(level)} ${latexInline(g[0]).trim()}`);
      continue;
    }
    const counter = /^\s*\\setcounter\{enum(i{1,4})\}\{(-?\d+)\}\s*$/.exec(line);
    if (counter && lists.length > 0) {
      lists[lists.length - 1].next = parseInt(counter[2], 10) + 1;
      continue;
    }
    const item = /^\s*\\item(?:\[[^\]]*\])?( *)(.*)$/.exec(line);
    if (item && lists.length > 0) {
      const list = lists[lists.length - 1];
      const outer = lists[lists.length - 2];
      const indent = outer ? outer.content : 0;
      const marker = list.kind === "ol" ? `${list.next++}${list.alt ? ")" : "."}` : list.alt ? "*" : "-";
      const gap = item[1].length >= 1 && item[1].length <= 4 ? item[1] : " ";
      list.content = indent + marker.length + gap.length;
      out.push(`${" ".repeat(indent)}${marker}${gap}${latexInline(item[2])}`);
      continue;
    }
    const wrapped = /^(\s*)\\begin\{(english|hebrew|arabic)\}([\s\S]*)\\end\{\2\}$/.exec(line);
    out.push(latexInline(wrapped ? wrapped[1] + wrapped[3] : line));
  }
  if (verbatim) out.push("```");
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ─── reStructuredText → Markdown ──────────────────────────────────── */

export function rstToMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  const code: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    // `.. code-block:: lang` (or `.. code::`, `.. sourcecode::`): its indented body is a fenced block, kept verbatim.
    const dir = /^(\s*)\.\.\s+(?:code-block|code|sourcecode)::\s*(\S*)\s*$/.exec(line);
    if (dir) {
      const [, indent, lang] = dir;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const inner = /^\s*/.exec(lines[j] ?? "")![0].length;
      if (j < lines.length && inner > indent.length) {
        for (; j < lines.length; j++) {
          if (!lines[j].trim()) {
            const k = lines.slice(j).findIndex((l) => l.trim());
            if (k < 0 || /^\s*/.exec(lines[j + k])![0].length < inner) break;
            body.push("");
          } else if (/^\s*/.exec(lines[j])![0].length < inner) break;
          else body.push(lines[j].slice(inner));
        }
        while (j < lines.length && !lines[j].trim() && lines[j + 1] !== undefined && !lines[j + 1].trim()) j++;
        const ticks = "`".repeat(Math.max(3, ...body.map((b) => (/^`+/.exec(b.trim())?.[0].length ?? 0) + 1)));
        code.push([`${indent}${ticks}${lang}`, ...body.map((b) => (b ? indent + b : "")), `${indent}${ticks}`].join("\n"));
        out.push(`\u0005${code.length - 1}\u0005`);
        i = lines[j] !== undefined && !lines[j].trim() ? j : j - 1;
        continue;
      }
    }
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
    .replace(/``([^`]+)``/g, "`$1`")
    .replace(/\u0005(\d+)\u0005/g, (_m, k: string) => code[Number(k)]);
}

/* ─── AsciiDoc → Markdown ──────────────────────────────────────────── */

/** Inline AsciiDoc → Markdown: ``code``, unconstrained **x** / __x__, then constrained *x* / _x_ between non-word characters. */
function adocInlineToMd(line: string): string {
  const kept: string[] = [];
  const keep = (s: string): string => `\u0002${kept.push(s) - 1}\u0002`;
  const W = "\\p{L}\\p{N}";
  return line
    .replace(/`\+(.+?)\+`|``(.+?)``/g, (m, lit: string | undefined, uc: string | undefined, at: number, all: string) => {
      const c = lit ?? uc ?? "";
      // Other backticks on the line need a longer fence than theirs.
      const rest = all.slice(0, at) + all.slice(at + m.length);
      const beside = Math.max(0, ...Array.from(rest.matchAll(/`+/g), (r) => r[0].length));
      const run = Math.max(beside, ...Array.from(c.matchAll(/`+/g), (r) => r[0].length)) + 1;
      const f = "`".repeat(run);
      const pad = run > 1 || /^`|`$/.test(c) || (/^ [\s\S]* $/.test(c) && c.trim() !== "");
      return keep(pad ? `${f} ${c} ${f}` : `${f}${c}${f}`);
    })
    .replace(/\]\([^)\s]*(?:\s+"[^"]*")?\)|<[a-z][\w+.-]*:[^\s<>]*>/gi, (m) => keep(m))
    .replace(/(?<!\\)\*\*(?=\S)(.*?\S)\*\*/g, "\u0003$1\u0003")
    .replace(/(?<!\\)__(?=\S)(.*?\S)__/g, "\u0004$1\u0004")
    .replace(new RegExp(`(?<![${W}\\\\*])\\*(?=[^\\s*])(.*?[^\\s\\\\])??\\*(?![${W}*])`, "gu"), (m) => `\u0003${m.slice(1, -1)}\u0003`)
    .replace(new RegExp(`(?<![${W}\\\\_])_(?=[^\\s_])(.*?[^\\s\\\\])??_(?![${W}_])`, "gu"), (m) => `\u0004${m.slice(1, -1)}\u0004`)
    .replace(/\u0003/g, "**")
    .replace(/\u0004/g, "*")
    .replace(/\u0002(\d+)\u0002/g, (_m, i: string) => kept[Number(i)]);
}

/**
 * AsciiDoc → Markdown. `=` headings, `*` bullets, constrained and
 * unconstrained bold and italic, ``code``; fenced (```) and ---- blocks are
 * copied untouched. A backslash before * or _ stays, as the Markdown escape.
 */
export function adocToMarkdown(text: string): string {
  let fence: string | null = null;
  const lines = text.split("\n");
  return lines
    .map((line, i) => {
      if (fence === null && /^'{3,}\s*$/.test(line)) return "***"; // AsciiDoc's thematic break
      const f = /^ {0,3}(`{3,}|~{3,}|-{4,})/.exec(line);
      // ---- opens a listing block only as a block of its own that closes later
      // (right under text it is a Markdown setext underline).
      const dashes = f !== null && f[1][0] === "-";
      if (fence === null && dashes && ((i > 0 && lines[i - 1].trim() !== "") || !lines.slice(i + 1).some((l) => l.trim() === f[1]))) return line;
      if (fence !== null) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) {
          const close = fence;
          fence = null;
          return close[0] === "-" ? "```" : line;
        }
        return line;
      }
      if (f && (f[1][0] !== "-" || line.trim() === f[1])) {
        fence = f[1];
        return f[1][0] === "-" ? "```" : line;
      }
      const h = /^(={1,6})\s+(.+)$/.exec(line);
      if (h) return `${"#".repeat(h[1].length)} ${adocInlineToMd(h[2])}`;
      const title = /^\.([^\s.][^\n]*)$/.exec(line);
      if (title) return `**${title[1]}**`;
      const li = /^\*(\s+)(.*)$/.exec(line);
      if (li && !/^\*(?:[ \t]*\*){2,}[ \t]*$/.test(line)) return `-${li[1]}${adocInlineToMd(li[2])}`;
      return adocInlineToMd(line);
    })
    .join("\n");
}

/* ─── Org-mode → Markdown ──────────────────────────────────────────── */

/** Inline Org → Markdown; =code= (and link destinations) are parked first so their content stays as written. */
function orgInlineToMd(line: string): string {
  const kept: string[] = [];
  const keep = (s: string): string => `\u0002${kept.push(s) - 1}\u0002`;
  const tick = (c: string): string => {
    const run = Math.max(0, ...Array.from(c.matchAll(/`+/g), (m) => m[0].length)) + 1;
    const fence = "`".repeat(run);
    const pad = run > 1 || /^`|`$/.test(c) || (/^ [\s\S]* $/.test(c) && c.trim() !== "");
    return pad ? `${fence} ${c} ${fence}` : `${fence}${c}${fence}`;
  };
  // Org's emphasis rules (org-emphasis-regexp-components): a marker opens
  // after a line start, a space or one of -('"{ and closes before a line end,
  // a space or one of -.,:!?;'")}[\ ; the text inside starts and ends with a
  // non-space. Anything else is a literal character.
  // A zero-width space beside a marker (written where the text runs on) is
  // part of the markup and is dropped.
  const PRE = `(?:(?<=^|[\\s\\-('"{*/\u0002])|\u200B)`;
  const POST = `(?:\u200B|(?=$|[\\s\\-.,:!?;'")}\\[\\\\*/\u0002]))`;
  const emph = (m: string): RegExp => new RegExp(`${PRE}\\${m}([^\\s\\${m}](?:[^\\n]*?[^\\s\\${m}])??)\\${m}${POST}`, "g");
  // =code= may keep spaces at its ends (a CommonMark code span can have them).
  const code = new RegExp(`${PRE}(?:=([^=\\n]+)=|~([^~\\n]+)~)${POST}`, "g");
  return line
    .replace(code, (_m, v: string | undefined, c: string | undefined) => keep(tick(v ?? c ?? "")))
    .replace(/\]\([^)\s]*(?:\s+"[^"]*")?\)|<[a-z][\w+.-]*:[^\s<>]*>/gi, (m) => keep(m))
    .replace(emph("*"), "**$1**")
    .replace(emph("/"), "*$1*")
    .replace(/\\ast\{\}/g, "\\*")
    .replace(/\\slash\{\}/g, "/")
    .replace(/\u0002(\d+)\u0002/g, (_m, i: string) => kept[Number(i)]);
}

export function orgToMarkdown(text: string): string {
  let inSrc = false;
  let fence = "```";
  const lines = text.split("\n");
  return lines
    .map((line, i) => {
      const begin = /^\s*#\+BEGIN_SRC\b[ \t]*(.*?)\s*$/i.exec(line);
      if (!inSrc && begin) {
        inSrc = true;
        // A block whose text or info string has a ``` line needs a ~~~ fence.
        const rest = lines.slice(i + 1);
        const end = rest.findIndex((l) => /^\s*#\+END_SRC\s*$/i.test(l));
        const body = end < 0 ? rest : rest.slice(0, end);
        fence = begin[1].includes("`") || body.some((l) => /^\s{0,3}`{3,}/.test(l)) ? "~~~~" : "```";
        return fence + begin[1];
      }
      if (inSrc) {
        if (/^\s*#\+END_SRC\s*$/i.test(line)) {
          inSrc = false;
          return fence;
        }
        return line;
      }
      // Org's rule, after a blank line; right after text it stays as written (a setext underline).
      if (/^\s*-{5,}\s*$/.test(line) && (i === 0 || !lines[i - 1].trim())) return "***";
      const h = /^(\*+)[ \t]+(.+)$/.exec(line); // a space or tab (not U+00A0)
      if (h) return `${"#".repeat(h[1].length)} ${orgInlineToMd(h[2])}`;
      return orgInlineToMd(line);
    })
    .join("\n");
}

/* ─── Jupyter notebook (.ipynb) → Markdown ─────────────────────────── */

interface IpynbCell {
  cell_type?: string;
  source?: string | string[];
  outputs?: Array<{
    output_type?: string;
    text?: string | string[];
    data?: Record<string, string | string[]>;
    traceback?: string[];
  }>;
}

/**
 * Convert a Jupyter notebook to Markdown: markdown/raw cells pass through, code
 * cells become fenced blocks in the notebook's language, and code outputs
 * (stream text, text/plain results, ANSI-stripped error tracebacks) follow as
 * plain fenced blocks.
 */
export function ipynbToMarkdown(jsonText: string): string {
  let nb: { cells?: IpynbCell[]; metadata?: unknown };
  try {
    nb = JSON.parse(jsonText) as { cells?: IpynbCell[]; metadata?: unknown };
  } catch {
    return "> ⚠️ Invalid .ipynb file (not valid JSON).";
  }
  const cells = Array.isArray(nb.cells) ? nb.cells : [];
  const meta = (nb.metadata ?? {}) as {
    language_info?: { name?: string };
    kernelspec?: { language?: string };
  };
  const lang = meta.language_info?.name || meta.kernelspec?.language || "python";
  const join = (s: unknown): string =>
    Array.isArray(s) ? s.join("") : typeof s === "string" ? s : "";

  const blocks: string[] = [];
  for (const cell of cells) {
    const text = join(cell.source).replace(/\s+$/, "");
    if (cell.cell_type === "markdown" || cell.cell_type === "raw") {
      if (text.trim()) blocks.push(text);
    } else if (cell.cell_type === "code") {
      if (text.trim()) blocks.push("```" + lang + "\n" + text + "\n```");
      const rendered: string[] = [];
      for (const o of cell.outputs ?? []) {
        if (o.output_type === "stream") {
          rendered.push(join(o.text));
        } else if (o.output_type === "execute_result" || o.output_type === "display_data") {
          if (o.data?.["text/plain"]) rendered.push(join(o.data["text/plain"]));
        } else if (o.output_type === "error") {
          rendered.push(join(o.traceback).replace(/\[[0-9;]*m/g, ""));
        }
      }
      const out = rendered.join("\n").replace(/\s+$/, "").trim();
      if (out) blocks.push("```\n" + out + "\n```");
    }
  }
  return blocks.join("\n\n");
}

/* ─── WordPress export (WXR) → Markdown ────────────────────────────── */

/**
 * WordPress eXtended RSS export → Markdown. Each published post/page becomes a
 * section (H1 title + author/date meta + HTML body converted to Markdown).
 * Drafts, trash, attachments and revisions are skipped. Namespaced tags are
 * matched by localName so we don't depend on XML prefix handling.
 */
export function wxrToMarkdown(xml: string): string {
  const doc = parseInertDocument(xml, "text/xml");
  const childText = (item: Element, localName: string): string => {
    for (const child of Array.from(item.children)) {
      if (child.localName === localName) return child.textContent?.trim() ?? "";
    }
    return "";
  };
  const sections: string[] = [];
  for (const item of Array.from(doc.getElementsByTagName("item"))) {
    const postType = childText(item, "post_type");
    if (postType && postType !== "post" && postType !== "page") continue;
    const status = childText(item, "status");
    if (status && status !== "publish") continue;
    const title = childText(item, "title") || "Untitled";
    const author = childText(item, "creator");
    const date = childText(item, "pubDate");
    const html = childText(item, "encoded");
    const body = html ? htmlToMarkdown(html) : "";
    const meta = [author ? "by " + author : "", date].filter(Boolean).join(" · ");
    const parts = ["# " + title];
    if (meta) parts.push("_" + meta + "_");
    if (body) parts.push(body);
    sections.push(parts.join("\n\n"));
  }
  return sections.length
    ? sections.join("\n\n---\n\n")
    : "> ⚠️ No published WordPress posts found in this export.";
}

/* ─── Confluence storage/view XHTML → Markdown ─────────────────────── */

/**
 * Convert Confluence export XHTML to Markdown. Confluence wraps content in
 * `ac:`/`ri:` macro tags; we turn code macros into fenced blocks, unwrap
 * rich-text panels, resolve internal page links to their title, strip the
 * remaining macro tags, then run the standard HTML→Markdown reader.
 */
export function confluenceToMarkdown(xhtml: string): string {
  const html = xhtml
    .replace(
      /<ac:structured-macro[^>]*ac:name="code"[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]>[\s\S]*?<\/ac:structured-macro>/gi,
      (_m, code: string) =>
        `<pre><code>${code.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code></pre>`,
    )
    .replace(/<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/gi, "$1")
    .replace(/<ac:link[^>]*>[\s\S]*?ri:content-title="([^"]*)"[\s\S]*?<\/ac:link>/gi, "$1")
    .replace(/<\/?(?:ac|ri):[^>]*>/gi, "");
  return htmlToMarkdown(html);
}
