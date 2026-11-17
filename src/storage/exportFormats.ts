/**
 * Markdown → other formats. Each function returns the converted string;
 * the caller is responsible for triggering the download.
 *
 * The conversions are intentionally simple — they cover the same subset
 * the import side recognises (`fileFormats.ts`). Round-tripping a doc
 * through Markdown → X → Markdown should preserve headings, emphasis,
 * lists, links, and code; complex layout is on its own.
 *
 * For full-fidelity pipelines (e.g. journal-grade LaTeX, fully-styled
 * RTF), pipe through Pandoc. We document that in `docs/`.
 */

import { zip } from "./zip";
import { pageFileSlug } from "../lib/slug";
import { firstRtlLanguage, firstStrongDirection, hasRtl, markdownBaseDirection } from "../lib/textDirection";
import { createFenceTracker } from "./fenceTracker";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export { createFenceTracker } from "./fenceTracker";
export { markdownToAdoc, markdownToOpml, markdownToOrg } from "./exportOutline";

/**
 * Markdown → RTF. Uses the minimal RTF 1.5 dialect that every RTF
 * reader on macOS / Windows / Pages handles. Headings become
 * \pard\fs36\b, bold becomes \b…\b0, etc.
 */
export function markdownToRtf(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  out.push(
    "{\\rtf1\\ansi\\deff0",
    "{\\fonttbl{\\f0 Helvetica;}{\\f1 Courier New;}}",
    "{\\colortbl;\\red0\\green0\\blue0;\\red120\\green80\\blue255;}",
    "\\fs24",
  );
  const fenceAt = createFenceTracker();
  for (const line of lines) {
    const { fence, inCode } = fenceAt(line);
    if (fence) {
      out.push(inCode ? "\\pard\\f1\\fs20" : "\\pard\\f0\\fs24");
      continue;
    }
    if (inCode) {
      out.push(escapeRtf(line) + "\\par");
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      const size = 36 - (h[1].length - 1) * 4;
      out.push(`\\pard\\fs${size}\\b ${escapeRtf(h[2])}\\b0\\fs24\\par`);
      continue;
    }
    if (/^[-*+]\s/.test(line)) {
      const t = line.replace(/^[-*+]\s+/, "");
      out.push(`\\pard\\bullet  ${escapeRtfInline(t)}\\par`);
      continue;
    }
    if (!line.trim()) {
      out.push("\\par");
      continue;
    }
    out.push(escapeRtfInline(line) + "\\par");
  }
  out.push("}");
  return out.join("\n");
}

/**
 * Inline Markdown → another format, code spans first: a `*` inside one
 * (`*.host.example`) is not emphasis and must not pair with a `*` after
 * the span (the LaTeX, EPUB and RTF writers all turned it into italics).
 * `rest` converts the text around the spans; `code` renders each span.
 */
function codeSpansFirst(s: string, rest: (t: string) => string, code: (c: string) => string): string {
  const spans: string[] = [];
  const out = rest(s.replace(/`([^`]+)`/g, (_m, c: string) => `\u0001${spans.push(c) - 1}\u0001`));
  return out.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => code(spans[Number(i)]));
}

function escapeRtf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/[{}]/g, "\\$&");
}
function escapeRtfInline(s: string): string {
  return codeSpansFirst(
    escapeRtf(s),
    (t) => t.replace(/\*\*([^*]+)\*\*/g, "\\b $1\\b0").replace(/\*([^*]+)\*/g, "\\i $1\\i0").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)"),
    (c) => `{\\f1 ${c}}`,
  );
}

/**
 * Markdown → LaTeX (article class). Heads → sections, lists →
 * itemize/enumerate, code fences → verbatim, $$…$$ → unwrapped display
 * math.
 */
export function markdownToLatex(md: string): string {
  const lines = md.split(/\r?\n/);
  // Hebrew (or Arabic) anywhere → XeLaTeX + polyglossia, the only engine
  // that typesets RTL properly; the main language follows the document's
  // base direction and every paragraph in the other direction is wrapped
  // in that language's environment (T44).
  const rtl = hasRtl(md);
  const base = markdownBaseDirection(md);
  // The first RTL passage decides, not the first strong character (an
  // English-first document with Arabic later is Arabic).
  const rtlLang = firstRtlLanguage(md) === "ar" ? "arabic" : "hebrew";
  const out: string[] = rtl
    ? [
        "% Compile with xelatex (Hebrew/Arabic need fontspec + polyglossia).",
        "\\documentclass{article}",
        "\\usepackage{fontspec}",
        "\\usepackage{polyglossia}",
        base === "rtl" ? `\\setmainlanguage{${rtlLang}}` : "\\setmainlanguage{english}",
        base === "rtl" ? "\\setotherlanguage{english}" : `\\setotherlanguage{${rtlLang}}`,
        "\\setmainfont{Noto Serif}",
        rtlLang === "hebrew" ? "\\newfontfamily\\hebrewfont[Script=Hebrew]{Noto Serif Hebrew}" : "\\newfontfamily\\arabicfont[Script=Arabic]{Noto Naskh Arabic}",
        "\\usepackage{hyperref}",
        "\\usepackage{listings}",
        "\\usepackage{amsmath}",
        "\\begin{document}",
      ]
    : [
        "\\documentclass{article}",
        "\\usepackage[utf8]{inputenc}",
        "\\usepackage{hyperref}",
        "\\usepackage{listings}",
        "\\usepackage{amsmath}",
        "\\begin{document}",
      ];
  const otherLang = base === "rtl" ? "english" : rtlLang;
  /** Wrap a paragraph whose direction differs from the document's. */
  const inLang = (tex: string, source: string): string => {
    if (!rtl) return tex;
    const d = firstStrongDirection(source);
    return d && d !== base ? `\\begin{${otherLang}}${tex}\\end{${otherLang}}` : tex;
  };
  /** Same, inline (headings, list items): \\textenglish{…} / \\texthebrew{…}. */
  const inLangInline = (tex: string, source: string): string => {
    if (!rtl) return tex;
    const d = firstStrongDirection(source);
    return d && d !== base ? `\\text${otherLang}{${tex}}` : tex;
  };
  const fenceAt = createFenceTracker();
  // Open lists, innermost last: kind, bullet character, the column an item
  // must reach to nest inside the list's current item, and the enclosing
  // item's content column (an item left of it leaves the list).
  const lists: Array<{ kind: "itemize" | "enumerate"; mark: string; outer: number; content: number }> = [];
  /** Close the lists an item at `indent` is outside of (all of them for -1). */
  const closeLists = (indent: number): void => {
    while (lists.length > 0 && (indent < 0 || indent < lists[lists.length - 1].outer)) out.push(`\\end{${lists.pop()!.kind}}`);
  };
  let prevBlank = false;
  for (const line of lines) {
    const { fence, inCode } = fenceAt(line);
    if (fence) {
      prevBlank = false;
      if (!inCode) {
        out.push("\\end{verbatim}");
        continue;
      }
      // A fence inside a list item keeps its indent; its info string goes in
      // a comment line (an unknown lstlisting language would not compile).
      const fm = /^( *)(?:`{3,}|~{3,})\s*(\S*)/.exec(line)!;
      while (lists.length > 0 && fm[1].length < lists[lists.length - 1].content) out.push(`\\end{${lists.pop()!.kind}}`);
      if (fm[2]) out.push(`% code: ${fm[2]}`);
      out.push(`${fm[1]}\\begin{verbatim}`);
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      closeLists(-1);
      // article class: # is \section (pandoc's mapping); 4–6 go to the
      // run-in \paragraph / \subparagraph levels instead of collapsing.
      const cmd = LATEX_HEADINGS[Math.min(h[1].length, LATEX_HEADINGS.length) - 1];
      out.push(`\\${cmd}{${inLangInline(escapeLatexInline(h[2]), h[2])}}`);
      continue;
    }
    const li = /^( *)([-*+]|\d{1,9}[.)])(?:( +)(\S.*))?$/.exec(line);
    if (li && (li[4] !== undefined || lists.length > 0) && (lists.length > 0 || li[1].length < 4)) {
      li[3] ??= " ";
      li[4] ??= "";
      const indent = li[1].length;
      const kind = /\d/.test(li[2]) ? "enumerate" : "itemize";
      const mark = li[2].replace(/\d+/, "");
      closeLists(indent);
      let top = lists[lists.length - 1];
      if (top && indent < top.content && top.mark !== mark) {
        // Another bullet character (or ./)) starts a new list in CommonMark.
        out.push(`\\end{${lists.pop()!.kind}}`);
        top = lists[lists.length - 1];
      }
      const gapLen = li[3].length > 4 ? 1 : li[3].length;
      const content = indent + li[2].length + gapLen;
      const begin = (): void => {
        out.push(`\\begin{${kind}}`);
        // A list that does not start at 1 keeps its number (\setcounter is
        // the LaTeX idiom; enumi…enumiv by depth).
        const start = kind === "enumerate" ? parseInt(li[2], 10) : 1;
        if (start !== 1) out.push(`\\setcounter{enum${"i".repeat(Math.min(lists.length, 4))}}{${start - 1}}`);
      };
      if (!top || indent >= top.content) {
        lists.push({ kind, mark, outer: top ? top.content : 0, content });
        begin();
      } else if (top.kind !== kind) {
        out.push(`\\end{${top.kind}}`);
        top.kind = kind;
        top.mark = mark;
        begin();
      }
      lists[lists.length - 1].content = content;
      // The spaces after the marker set the item's content column in
      // Markdown; LaTeX ignores them, and the importer reads them back.
      const gap = li[3].length > 4 ? " " : li[3];
      out.push(`\\item${gap}${inLangInline(escapeLatexInline(li[4]), li[4])}`);
      prevBlank = false;
      continue;
    }
    if (!line.trim()) {
      prevBlank = true;
      out.push("");
      continue;
    }
    // After a blank line, a line left of the item's content leaves the list
    // (a line right after an item, with no blank, is a lazy continuation).
    const lead = /^ */.exec(line)![0].length;
    if (prevBlank) while (lists.length > 0 && lead < lists[lists.length - 1].content) out.push(`\\end{${lists.pop()!.kind}}`);
    prevBlank = false;
    out.push(inLang(escapeLatexInline(line), line));
  }
  closeLists(-1);
  out.push("\\end{document}");
  return out.join("\n");
}

/** The visible text of rendered HTML: no tags, no entity names (`&amp;` is not Latin text). */
function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/gi, " ");
}

/** lang for a rendered page body: he / ar by script, else en. */
function pageLang(html: string): string {
  const text = visibleText(html);
  return firstStrongDirection(text) === "rtl" ? firstRtlLanguage(text) ?? "en" : "en";
}

const LATEX_HEADINGS = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"] as const;

function escapeLatex(s: string): string {
  // A lone backslash is \textbackslash{}: "\\" would be a LaTeX line break.
  return s.replace(/[\\&%$#_{}~^]/g, (c) => (c === "\\" ? "\\textbackslash{}" : "\\" + c));
}
function escapeLatexInline(s: string): string {
  return codeSpansFirst(
    escapeLatex(s),
    (t) => t.replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}").replace(/\*([^*]+)\*/g, "\\textit{$1}").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "\\href{$2}{$1}"),
    (c) => `\\texttt{${c}}`,
  );
}

/**
 * Markdown → reStructuredText. Headings get an underline of `=` / `-` / `~`
 * matching the heading text length. Inline code and emphasis convert.
 */
export function markdownToRst(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A fenced block is a `code-block` directive with its body indented (it was copied as text, and came back as inline code).
    const fence = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)/.exec(line);
    // A backtick fence's info string has no backtick (```foo`` is a code span).
    if (fence && !(fence[2][0] === "`" && line.slice(fence[0].length).includes("`"))) {
      const [, indent, marks, lang] = fence;
      const close = new RegExp(`^\\s*${marks[0] === "`" ? "`" : "~"}{${marks.length},}\\s*$`);
      if (!indent && out.length && out[out.length - 1].trim()) out.push(""); // a directive starts a block of its own
      out.push(`${indent}.. code-block::${lang ? ` ${lang}` : ""}`, "");
      for (i++; i < lines.length && !close.test(lines[i]); i++) out.push(lines[i].trim() ? `${indent}   ${lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i].trimStart()}` : "");
      out.push("");
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      const c = h[1].length === 1 ? "=" : h[1].length === 2 ? "-" : "~";
      out.push(h[2]);
      out.push(c.repeat(h[2].length));
      out.push("");
      continue;
    }
    out.push(
      line
        .replace(/`([^`]+)`/g, "``$1``")
        .replace(/\*\*([^*]+)\*\*/g, "**$1**")
        .replace(/\*([^*]+)\*/g, "*$1*"),
    );
  }
  return out.join("\n");
}

/* ─── Markdown → Reveal.js slide deck ──────────────────────────────── */

/**
 * Build a self-contained Reveal.js presentation. Slides are split on `---`
 * thematic breaks (the standard Reveal markdown convention); each becomes a
 * `<section data-markdown>` rendered by Reveal's markdown plugin. Reveal's
 * runtime + theme load from a CDN, so the file is portable but online.
 */
/**
 * Shared slide splitter (Reveal + PPTX exports). When the deck uses `---`
 * thematic breaks, those are the slide boundaries (the Reveal convention).
 * Otherwise every H1/H2 heading starts a new slide. Fence-aware: `---` or
 * `#` lines inside ``` code blocks never split. Empty chunks are dropped.
 */
export function splitSlides(md: string): string[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let hasRule = false;
  {
    const fenceAt = createFenceTracker();
    for (const l of lines) {
      const { fence, inCode } = fenceAt(l);
      if (!fence && !inCode && /^\s*---\s*$/.test(l)) hasRule = true;
    }
  }
  const chunks: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    const s = cur.join("\n").trim();
    if (s) chunks.push(s);
    cur = [];
  };
  const fenceAt = createFenceTracker();
  for (const l of lines) {
    const { fence, inCode } = fenceAt(l);
    if (fence) {
      cur.push(l);
      continue;
    }
    if (!inCode) {
      if (hasRule && /^\s*---\s*$/.test(l)) {
        flush();
        continue;
      }
      if (!hasRule && /^#{1,2}\s/.test(l)) flush();
    }
    cur.push(l);
  }
  flush();
  return chunks;
}

export function markdownToRevealHtml(md: string, title = "Slides"): string {
  const slides = splitSlides(md);
  const sections = (slides.length ? slides : [md])
    .map(
      (s) =>
        `<section data-markdown><textarea data-template>\n${s}\n</textarea></section>`,
    )
    .join("\n");
  const cdn = "https://cdn.jsdelivr.net/npm/reveal.js@5";
  return [
    `<!doctype html>`,
    `<html><head><meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${escapeHtml(title)}</title>`,
    `<link rel="stylesheet" href="${cdn}/dist/reveal.css">`,
    `<link rel="stylesheet" href="${cdn}/dist/theme/black.css">`,
    `</head><body><div class="reveal"><div class="slides">`,
    sections,
    `</div></div>`,
    `<script src="${cdn}/dist/reveal.js"></script>`,
    `<script src="${cdn}/plugin/markdown/markdown.js"></script>`,
    `<script>Reveal.initialize({ hash: true, plugins: [ RevealMarkdown ] });</script>`,
    `</body></html>`,
  ].join("\n");
}

/* ─── Markdown → EPUB 3 (real package, zipped) ─────────────────────── */

function mdInlineToHtml(s: string): string {
  return codeSpansFirst(
    escapeHtml(s),
    (t) => t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>'),
    (c) => `<code>${c}</code>`,
  );
}

const isRtlText = (s: string): boolean => (s.match(/[\u0590-\u08FF]/g)?.length ?? 0) > (s.match(/[A-Za-z]/g)?.length ?? 0);

/** The cells of a pipe-table row (escaped pipes kept). */
function tableCells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FOOTNOTE_DEF = /^\[\^[^\]]+\]:/;
const EPUB_BLOCK = /^\s*(#{1,6}\s|>|```|~~~|\||[-*+]\s|\d{1,9}[.)]\s|\[\^[^\]]+\]:)|^\s{0,3}([-*_])(\s*\2){2,}\s*$/;

/** A paragraph's lines: soft wraps join with a space, a hard break (two spaces or \) is <br/>. */
function xhtmlLines(lines: string[]): string {
  return lines
    .map((l, i) => {
      const last = i === lines.length - 1;
      const hard = !last && (/ {2,}$/.test(l) || /\\$/.test(l));
      const text = mdInlineToHtml(l.replace(/\\$/, "").trim());
      return hard ? `${text}<br/>` : text;
    })
    .join(" ")
    .replace(/<br\/> /g, "<br/>");
}

/**
 * Well-formed XHTML body for an EPUB chapter: headings, paragraphs (soft
 * wraps joined), bullet and numbered lists (nested by indent, with their start
 * number), pipe tables (a mostly-Hebrew table is dir="rtl"), block quotes,
 * rules and fenced code with its language.
 */
function mdToXhtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const lists: Array<{ tag: "ul" | "ol"; indent: number }> = [];
  let item: string[] | null = null; // lines of the open <li>
  const flushItem = (): void => {
    if (item) out.push(`<li>${xhtmlLines(item)}`);
    item = null;
  };
  const closeLists = (indent: number): void => {
    flushItem();
    while (lists.length && lists[lists.length - 1].indent >= indent) {
      out.push(`</li></${lists.pop()!.tag}>`);
    }
  };
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length) out.push(`<p>${xhtmlLines(para)}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      flushPara();
      closeLists(0);
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && !new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[j]); j++) body.push(lines[j]);
      const cls = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      i = j;
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushItem();
      continue;
    }
    const li = LIST_ITEM.exec(line);
    if (li && (lists.length || !para.length || !/^\d/.test(li[2]) || li[2].startsWith("1"))) {
      flushPara();
      const indent = li[1].length;
      const tag = /\d/.test(li[2]) ? "ol" : "ul";
      flushItem();
      while (lists.length && (lists[lists.length - 1].indent > indent || (lists[lists.length - 1].indent === indent && lists[lists.length - 1].tag !== tag))) {
        out.push(`</li></${lists.pop()!.tag}>`);
      }
      const top = lists[lists.length - 1];
      if (!top || indent > top.indent) {
        const start = tag === "ol" ? parseInt(li[2], 10) : 1;
        out.push(start !== 1 ? `<ol start="${start}">` : `<${tag}>`);
        lists.push({ tag, indent });
      } else out.push("</li>");
      item = [li[3]];
      continue;
    }
    // A continuation line of a list item (indented, or a lazy one right after it).
    if (item && !EPUB_BLOCK.test(line)) {
      (item as string[]).push(line);
      continue;
    }
    if (lists.length && !/^\s/.test(line)) closeLists(0);
    const h = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (h) {
      flushPara();
      closeLists(0);
      out.push(`<h${h[1].length}>${mdInlineToHtml(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) && !para.length) {
      closeLists(0);
      out.push("<hr/>");
      continue;
    }
    if (/^\s*\|/.test(line) && lines[i + 1] !== undefined && TABLE_SEP.test(lines[i + 1])) {
      flushPara();
      closeLists(0);
      const head = tableCells(line);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push(tableCells(lines[j]));
      // Direction from the cells' words (link targets and markup are not text).
      const words = [head, ...rows].flat().join(" ").replace(/\]\([^)]*\)|`[^`]*`|<[^>]*>/g, " ");
      const dir = isRtlText(words) ? ' dir="rtl"' : "";
      out.push(
        `<table${dir}><thead><tr>${head.map((c) => `<th>${mdInlineToHtml(c)}</th>`).join("")}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${head.map((_, k) => `<td>${mdInlineToHtml(r[k] ?? "")}</td>`).join("")}</tr>`).join("") +
          "</tbody></table>",
      );
      i = j - 1;
      continue;
    }
    if (FOOTNOTE_DEF.test(line)) {
      // A footnote stays a paragraph of its own: "[^1]: text" (EPUB has no notes here).
      flushPara();
      closeLists(0);
      out.push(`<p>${mdInlineToHtml(line)}</p>`);
      continue;
    }
    const quote = /^ {0,3}>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      closeLists(0);
      const body = [quote[1]];
      while (i + 1 < lines.length && /^ {0,3}>/.test(lines[i + 1])) body.push(lines[++i].replace(/^ {0,3}>\s?/, ""));
      out.push(`<blockquote>${mdToXhtml(body.join("\n"))}</blockquote>`);
      continue;
    }
    para.push(line);
  }
  flushPara();
  closeLists(0);
  return out.join("\n");
}

/** Build a valid EPUB 3 package as raw bytes (chapters split on H1). */
export async function markdownToEpubBytes(md: string, title = "Document"): Promise<Uint8Array> {
  const parts = md
    .split(/^(?=# )/m)
    .map((s) => s.trim())
    .filter(Boolean);
  // Language and reading direction (T44): a Hebrew book opens from the
  // right and reads right-to-left in every reader.
  const bookDir = markdownBaseDirection(md);
  // An RTL book's language is its first RTL passage's: frontmatter keys
  // and code are Latin and would otherwise decide.
  const bookLang = (bookDir === "rtl" ? firstRtlLanguage(md) : null) ?? "en";
  const { a11yMetadata, pageListNav, paginate } = await import("../book/epubA11y");
  // W13.F4: a page list the book sets for itself (a break per chapter, then every ~300 words).
  const pageEntries: { href: string; n: number; id: string }[] = [];
  const chapters = (parts.length ? parts : [md]).map((c, i) => {
    const chTitle = c.match(/^#\s+(.+)$/m)?.[1] ?? `Chapter ${i + 1}`;
    const dir = markdownBaseDirection(c);
    const lang = (dir === "rtl" ? firstRtlLanguage(c) : null) ?? (dir === bookDir ? bookLang : "en");
    const href = `chapter${i + 1}.xhtml`;
    const paged = paginate(mdToXhtml(c), pageEntries.length + 1);
    for (const p of paged.pages) pageEntries.push({ href, ...p });
    const xhtml =
      `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n` +
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}" dir="${dir}"><head><title>${escapeHtml(chTitle)}</title></head>` +
      `<body>\n${paged.body}\n</body></html>`;
    return { id: `ch${i + 1}`, href, title: chTitle, xhtml };
  });

  const uid = "urn:uuid:" + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(16));
  const container =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
    `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const opf =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">` +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:identifier id="bookid">${uid}</dc:identifier>` +
    `<dc:title>${escapeHtml(title)}</dc:title><dc:language>${bookLang}</dc:language>` +
    `<meta property="dcterms:modified">1970-01-01T00:00:00Z</meta>` +
    a11yMetadata({ lang: bookLang, images: 0, imagesWithoutAlt: 0, pages: pageEntries.length }) +
    `</metadata>` +
    `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>` +
    chapters.map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`).join("") +
    `</manifest><spine${bookDir === "rtl" ? ' page-progression-direction="rtl"' : ""}>` +
    chapters.map((c) => `<itemref idref="${c.id}"/>`).join("") +
    `</spine></package>`;
  // The book's own language for its navigation (a screen reader reads it in that voice). The navigation is
  // not in the spine here, so the landmarks name the body only (a link to a non-spine page is an epubcheck error).
  const navTitle = bookLang.startsWith("he") ? "תוכן העניינים" : "Contents";
  const nav =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${bookLang}" lang="${bookLang}" dir="${bookDir}"><head><title>${navTitle}</title></head>` +
    `<body><nav epub:type="toc"><ol>` +
    chapters.map((c) => `<li><a href="${c.href}">${escapeHtml(c.title)}</a></li>`).join("") +
    `</ol></nav>` +
    `<nav epub:type="landmarks" hidden="hidden"><ol>${chapters.length ? `<li><a epub:type="bodymatter" href="${chapters[0].href}">${escapeHtml(chapters[0].title)}</a></li>` : ""}</ol></nav>` +
    pageListNav(pageEntries, bookLang.startsWith("he") ? "עמודים" : "Pages") +
    `</body></html>`;

  return zip([
    // The mimetype entry must come first and be stored (uncompressed).
    { name: "mimetype", data: "application/epub+zip", store: true },
    { name: "META-INF/container.xml", data: container },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    ...chapters.map((c) => ({ name: `OEBPS/${c.href}`, data: c.xhtml })),
  ]);
}

/* ─── Markdown → static site (multi-page HTML + nav + RSS) ─────────── */

const SITE_CSS = [
  ":root{--accent:#7c5cff}",
  "*{box-sizing:border-box}body{margin:0;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#222}",
  ".layout{display:flex;min-height:100vh}",
  "aside{width:240px;background:#f6f6fb;border-inline-end:1px solid #e5e5ef;padding:24px 16px}",
  "aside ul{list-style:none;margin:0;padding:0}aside li{margin:4px 0}",
  "aside a{color:#444;text-decoration:none;display:block;padding:6px 10px;border-radius:6px}",
  "aside a.active,aside a:hover{background:var(--accent);color:#fff}",
  "main{flex:1;padding:40px 56px;max-width:820px}",
  "h1,h2,h3{line-height:1.25}h1{border-bottom:2px solid var(--accent);padding-bottom:8px}",
  "code{background:#f0f0f4;padding:2px 5px;border-radius:4px;font-size:.9em}",
  "pre{background:#1e1e2e;color:#e8e8f0;padding:16px;border-radius:8px;overflow:auto}pre code{background:none}",
  "a{color:var(--accent)}",
].join("\n");

/**
 * Build a self-contained static documentation site as a zip: one HTML page per
 * top-level (H1) section, a shared sidebar nav, a stylesheet, and an RSS feed.
 * Open index.html to browse. Exported as bytes for download.
 */
export async function markdownToStaticSiteBytes(md: string, siteTitle = "Site"): Promise<Uint8Array> {
  const parts = md
    .split(/^(?=# )/m)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const pages = (parts.length ? parts : [md]).map((c, i) => {
    const title = c.match(/^#\s+(.+)$/m)?.[1] ?? `Page ${i + 1}`;
    let slug = pageFileSlug(title, `page-${i + 1}`);
    while (seen.has(slug)) slug = `${slug}-${i}`;
    seen.add(slug);
    return { title, file: `${slug}.html`, body: mdToXhtml(c) };
  });

  const nav = (active: string) =>
    `<nav><ul>` +
    pages
      .map(
        (p) =>
          `<li><a href="${encodeURIComponent(p.file)}"${p.file === active ? ' class="active" aria-current="page"' : ""}>${escapeHtml(p.title)}</a></li>`,
      )
      .join("") +
    `</ul></nav>`;
  const pageHtml = (p: { title: string; file: string; body: string }) =>
    `<!doctype html><html lang="${pageLang(p.body)}" dir="${firstStrongDirection(visibleText(p.body)) ?? "ltr"}"><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<title>${escapeHtml(p.title)} — ${escapeHtml(siteTitle)}</title>` +
    `<link rel="stylesheet" href="style.css" /></head><body>` +
    `<div class="layout"><aside><strong>${escapeHtml(siteTitle)}</strong>${nav(p.file)}</aside>` +
    `<main>${p.body}</main></div></body></html>`;

  const rss =
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>` +
    `<title>${escapeHtml(siteTitle)}</title><description>${escapeHtml(siteTitle)}</description>` +
    pages.map((p) => `<item><title>${escapeHtml(p.title)}</title><link>${encodeURIComponent(p.file)}</link></item>`).join("") +
    `</channel></rss>`;

  return zip([
    { name: "index.html", data: pageHtml(pages[0]) },
    ...pages.map((p) => ({ name: p.file, data: pageHtml(p) })),
    { name: "style.css", data: SITE_CSS },
    { name: "feed.xml", data: rss },
  ]);
}

/* ─── Markdown → Jupyter notebook (.ipynb) ─────────────────────────── */

/**
 * Convert Markdown to a valid Jupyter notebook (nbformat 4.5). A top-level
 * fenced block in the notebook's language becomes a code cell; everything
 * else becomes markdown cells, including a fence in another language (or none)
 * and a fence inside a list item, which a code cell could not hold without
 * losing its language or splitting the list. Round-trips with
 * `ipynbToMarkdown` in ./fileFormats.
 */
export function markdownToIpynb(md: string, lang = "python"): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const toSource = (text: string): string[] => {
    if (text === "") return [];
    const ls = text.split("\n");
    return ls.map((l, idx) => (idx < ls.length - 1 ? l + "\n" : l));
  };
  const cells: Array<Record<string, unknown>> = [];
  let prose: string[] = [];
  const flushProse = () => {
    const text = prose.join("\n").trim();
    if (text) cells.push({ cell_type: "markdown", metadata: {}, source: toSource(text) });
    prose = [];
  };

  let i = 0;
  while (i < lines.length) {
    const fence = lines[i].match(/^(\s*)```([\w+-]+)?/);
    if (fence && (fence[1] !== "" || (fence[2] ?? "").toLowerCase() !== lang.toLowerCase())) {
      // Not a code cell: the fence stays Markdown, whole, with its language.
      prose.push(lines[i++]);
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) prose.push(lines[i++]);
      if (i < lines.length) prose.push(lines[i++]);
    } else if (fence) {
      flushProse();
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      cells.push({
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: toSource(code.join("\n")),
      });
    } else {
      prose.push(lines[i]);
      i++;
    }
  }
  flushProse();

  return JSON.stringify(
    {
      cells,
      metadata: { language_info: { name: lang } },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  );
}

/** Trigger a browser download for arbitrary text content. */
export function downloadText(filename: string, content: string, mime = "text/plain"): void {
  downloadBytes(filename, new TextEncoder().encode(content), `${mime};charset=utf-8`);
}

/** Trigger a browser download for binary content. */
export function downloadBytes(filename: string, bytes: Uint8Array, mime = "application/octet-stream"): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
