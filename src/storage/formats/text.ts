/**
 * Plain-text and exported formats → Markdown: MHTML/EML, OPML, LaTeX, RST,
 * legacy .doc, AsciiDoc, Org, Jupyter notebooks, WordPress WXR, Confluence,
 * Fountain screenplays. Split out of ../fileFormats.ts (plan 12.1), which
 * re-exports everything here.
 */
import { parseInertDocument } from "../../lib/trustedTypes";
import { htmlToMarkdown, rtfToMarkdown } from "./markup";

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
    const doc = parseInertDocument(text, "application/xml");
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

/* ─── Legacy .doc (binary Word) → Markdown ─────────────────────────── */

const DOC_LETTER = /[A-Za-zÀ-ɏ֐-׿؀-ۿ]/g;

function countLetters(s: string): number {
  return (s.match(DOC_LETTER) || []).length;
}

/** Keep only lines that are mostly letters — rejects interleaved binary noise. */
function filterReadableLines(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").trimEnd())
    .filter((l) => {
      const t = l.trim();
      if (t.length < 4) return false;
      return countLetters(t) / t.length >= 0.5;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Recover single-byte (ANSI/Latin-1) printable runs. */
function recoverAnsiText(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    s +=
      (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d
        ? String.fromCharCode(b)
        : "\n";
  }
  return filterReadableLines(s);
}

/** Recover UTF-16LE printable runs (modern Word stores text as UTF-16). */
function recoverUtf16Text(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const lo = buf[i];
    const hi = buf[i + 1];
    s +=
      hi === 0 &&
      ((lo >= 0x20 && lo <= 0x7e) || lo === 0x09 || lo === 0x0a || lo === 0x0d)
        ? String.fromCharCode(lo)
        : "\n";
  }
  return filterReadableLines(s);
}

/**
 * Convert a legacy binary .doc to Markdown. The old OLE/CFB Word format cannot
 * be parsed losslessly in the browser, so this is deliberately honest rather
 * than fake: it (1) reroutes files that are really RTF/HTML mislabeled as .doc,
 * (2) attempts a conservative dual-encoding text recovery (ANSI + UTF-16LE,
 * keeping whichever yields more letters), and (3) falls back to a clear
 * "couldn't extract" notice instead of dumping binary noise.
 */
export async function legacyDocToMarkdown(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder("latin1").decode(buf.subarray(0, 16));

  // A surprising share of ".doc" files in the wild are really RTF or HTML.
  if (head.startsWith("{\\rtf")) return rtfToMarkdown(new TextDecoder("latin1").decode(buf));
  if (/^\s*<(!doctype|html|\?xml)/i.test(head)) return htmlToMarkdown(new TextDecoder().decode(buf));

  const note =
    "> ⚠️ **Legacy .doc**: the old binary Word format can't be converted losslessly in the browser. " +
    "For full fidelity, open it in Word/LibreOffice and **Save As .docx** (or .rtf), then import that.\n\n---\n\n";

  const ansi = recoverAnsiText(buf);
  const utf16 = recoverUtf16Text(buf);
  const best = countLetters(utf16) > countLetters(ansi) ? utf16 : ansi;

  if (countLetters(best) < 40) {
    return note + "_No readable text could be recovered from this legacy .doc file._";
  }
  return note + best;
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

/**
 * Fountain (screenwriting plain-text, fountain.io) → Markdown.
 *
 * Pragmatic subset of the spec, mapped for readability rather than
 * re-exportable fidelity:
 *   title page key/values → `# Title` + a bold metadata block
 *   scene headings (INT./EXT./EST./I/E or forced `.`) → `## ` headings
 *   sections `#`/`##`/… → headings one level down (the title keeps `#`)
 *   synopses `= …` → italic line · page breaks `===` → `---`
 *   transitions (ALL-CAPS ending `TO:` or forced `>`) → italic line
 *   centered `>text<` → bold line
 *   CHARACTER cues → bold, parentheticals italic, dialogue as blockquote
 *   lyrics `~…` → italic · boneyard comments and `[[notes]]` stripped
 */
export function fountainToMarkdown(text: string): string {
  // Strip boneyard comments and notes first (both may span lines).
  let src = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\[\[[\s\S]*?\]\]/g, "");
  src = src.replace(/\r\n?/g, "\n");

  const out: string[] = [];
  const lines = src.split("\n");
  let i = 0;

  // ── Title page: leading `Key: value` pairs up to the first blank line ──
  if (/^[A-Za-z][A-Za-z ]*:/.test(lines[0] ?? "")) {
    const meta: Array<[string, string]> = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const m = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(lines[i]);
      if (m) {
        meta.push([m[1].trim(), m[2].trim()]);
      } else if (meta.length && /^\s+\S/.test(lines[i])) {
        // indented continuation line (multi-line values, e.g. Contact:)
        meta[meta.length - 1][1] = (meta[meta.length - 1][1] + " " + lines[i].trim()).trim();
      }
      i++;
    }
    const title = meta.find(([k]) => k.toLowerCase() === "title");
    if (title?.[1]) out.push(`# ${title[1]}`, "");
    const rest = meta.filter(([k, v]) => k.toLowerCase() !== "title" && v);
    if (rest.length) {
      for (const [k, v] of rest) out.push(`**${k}:** ${v}  `);
      out.push("");
    }
  }

  const isSceneHeading = (ln: string): boolean =>
    /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i.test(ln.trim());
  const isTransition = (ln: string): boolean => /^[A-Z0-9 .']+TO:$/.test(ln.trim());
  const isCharacterCue = (ln: string): boolean => {
    const t = ln.trim();
    if (!t || t.length > 60) return false;
    // ALL-CAPS (digits/space/./'/- allowed, optional trailing parenthetical
    // extension like (V.O.), optional dual-dialogue caret)
    const m = /^(@)?([A-Z0-9 .'\-]+)(\s*\([^)]*\))?\s*\^?$/.exec(t);
    if (!m) return false;
    if (m[1]) return true; // forced @CUE
    const name = m[2].trim();
    return (
      /[A-Z]/.test(name) &&
      name === name.toUpperCase() &&
      !isSceneHeading(t) &&
      !isTransition(t)
    );
  };

  while (i < lines.length) {
    const ln = lines[i].trim();

    if (ln === "") {
      if (out[out.length - 1] !== "") out.push("");
      i++;
      continue;
    }
    if (/^={3,}$/.test(ln)) {
      out.push("---", "");
      i++;
      continue;
    }
    if (/^#{1,6}\s/.test(ln)) {
      const m = /^(#{1,6})\s*(.*)$/.exec(ln)!;
      out.push(`${"#".repeat(Math.min(m[1].length + 1, 6))} ${m[2].trim()}`, "");
      i++;
      continue;
    }
    if (/^=\s/.test(ln)) {
      out.push(`*${ln.slice(1).trim()}*`, "");
      i++;
      continue;
    }
    if (/^>.*<$/.test(ln)) {
      out.push(`**${ln.slice(1, -1).trim()}**`, "");
      i++;
      continue;
    }
    if (ln.startsWith(">") || isTransition(ln)) {
      out.push(`*${ln.replace(/^>\s*/, "").trim()}*`, "");
      i++;
      continue;
    }
    // Forced scene heading `.HEADING` (but not "..." ellipsis action)
    if (ln.startsWith(".") && !ln.startsWith("..")) {
      out.push(`## ${ln.slice(1).trim()}`, "");
      i++;
      continue;
    }
    if (isSceneHeading(ln)) {
      out.push(`## ${ln}`, "");
      i++;
      continue;
    }
    if (ln.startsWith("~")) {
      out.push(`*${ln.slice(1).trim()}*`, "");
      i++;
      continue;
    }
    // Character cue: must be followed by a non-blank dialogue line.
    if (isCharacterCue(ln) && (lines[i + 1] ?? "").trim() !== "") {
      out.push(`**${ln.replace(/^@/, "").replace(/\s*\^$/, "")}**`);
      i++;
      while (i < lines.length && lines[i].trim() !== "") {
        const d = lines[i].trim();
        if (/^\(.*\)$/.test(d)) out.push(`*${d}*`);
        else out.push(`> ${d.replace(/^!/, "")}`);
        i++;
      }
      out.push("");
      continue;
    }
    // Action (default); `!` forces action — strip the marker.
    out.push(ln.replace(/^!/, ""));
    i++;
  }

  return (
    out
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}
