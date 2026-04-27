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

const HEAD = (title: string) =>
  `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head><body>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
  let inCode = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
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

function escapeRtf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/[{}]/g, "\\$&");
}
function escapeRtfInline(s: string): string {
  return escapeRtf(s)
    .replace(/\*\*([^*]+)\*\*/g, "\\b $1\\b0")
    .replace(/\*([^*]+)\*/g, "\\i $1\\i0")
    .replace(/`([^`]+)`/g, "{\\f1 $1}")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

/**
 * Markdown → LaTeX (article class). Heads → sections, lists →
 * itemize/enumerate, code fences → verbatim, $$…$$ → unwrapped display
 * math.
 */
export function markdownToLatex(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [
    "\\documentclass{article}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage{hyperref}",
    "\\usepackage{listings}",
    "\\usepackage{amsmath}",
    "\\begin{document}",
  ];
  let inCode = false;
  let inList = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      out.push(inCode ? "\\begin{verbatim}" : "\\end{verbatim}");
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      const cmd =
        h[1].length === 1
          ? "section"
          : h[1].length === 2
            ? "subsection"
            : "subsubsection";
      out.push(`\\${cmd}{${escapeLatex(h[2])}}`);
      continue;
    }
    if (/^[-*+]\s/.test(line)) {
      if (!inList) {
        out.push("\\begin{itemize}");
        inList = true;
      }
      out.push(`\\item ${escapeLatexInline(line.replace(/^[-*+]\s+/, ""))}`);
      continue;
    } else if (inList && line.trim() === "") {
      out.push("\\end{itemize}");
      inList = false;
    }
    if (!line.trim()) {
      out.push("");
      continue;
    }
    out.push(escapeLatexInline(line));
  }
  if (inList) out.push("\\end{itemize}");
  out.push("\\end{document}");
  return out.join("\n");
}

function escapeLatex(s: string): string {
  return s.replace(/[\\&%$#_{}~^]/g, "\\$&");
}
function escapeLatexInline(s: string): string {
  return escapeLatex(s)
    .replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}")
    .replace(/\*([^*]+)\*/g, "\\textit{$1}")
    .replace(/`([^`]+)`/g, "\\texttt{$1}")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "\\href{$2}{$1}");
}

/**
 * Markdown → reStructuredText. Headings get an underline of `=` / `-` / `~`
 * matching the heading text length. Inline code and emphasis convert.
 */
export function markdownToRst(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
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

/**
 * Markdown → AsciiDoc. Heading depth maps 1:1 (# → =, ## → ==), inline
 * stays close enough that a paste into Asciidoctor will Just Work.
 */
export function markdownToAdoc(md: string): string {
  return md
    .replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, t: string) => `${"=".repeat(hashes.length)} ${t}`)
    .replace(/^[-*+]\s/gm, "* ")
    .replace(/`([^`]+)`/g, "``$1``")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*"); // adoc bold
}

/**
 * Markdown → Org-mode. Heading depth maps 1:1 (# → *, ## → **), bold &
 * italic syntax adjusted, code fences become `#+BEGIN_SRC`.
 */
export function markdownToOrg(md: string): string {
  return md
    .replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, t: string) => `${"*".repeat(hashes.length)} ${t}`)
    .replace(/```(\w*)\n([\s\S]*?)```/g, "#+BEGIN_SRC $1\n$2#+END_SRC")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "/$1/")
    .replace(/`([^`]+)`/g, "=$1=");
}

/** Markdown → OPML (treat top-level lists as the outline). */
export function markdownToOpml(md: string, title = "Outline"): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<opml version="2.0">');
  out.push(`<head><title>${escapeHtml(title)}</title></head>`);
  out.push("<body>");
  const stack: number[] = [];
  for (const line of lines) {
    const m = /^( *)[-*+]\s+(.+)$/.exec(line);
    if (!m) continue;
    const depth = Math.floor(m[1].length / 2);
    while (stack.length && stack[stack.length - 1] >= depth) {
      out.push("</outline>");
      stack.pop();
    }
    out.push(`<outline text="${escapeHtml(m[2])}">`);
    stack.push(depth);
  }
  while (stack.length) {
    out.push("</outline>");
    stack.pop();
  }
  out.push("</body>");
  out.push("</opml>");
  return out.join("\n");
}

/**
 * Wrap markdown in a self-contained MHTML envelope (`Content-Type:
 * multipart/related`). Useful when you want a single-file web archive
 * for email or offline reading.
 */
export function markdownToMhtml(md: string, htmlBody: string, title: string): string {
  const boundary = "----=_LumenBoundary_" + Date.now().toString(36);
  return [
    `From: <lumen@local>`,
    `Subject: ${title}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/related; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="utf-8"`,
    `Content-Location: lumen.html`,
    ``,
    `${HEAD(title)}<article>${htmlBody}</article></body></html>`,
    ``,
    `--${boundary}`,
    `Content-Type: text/markdown; charset="utf-8"`,
    `Content-Location: lumen.md`,
    ``,
    md,
    ``,
    `--${boundary}--`,
  ].join("\r\n");
}

/** Trigger a browser download for arbitrary text content. */
export function downloadText(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
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
