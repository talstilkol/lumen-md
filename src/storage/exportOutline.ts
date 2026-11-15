/**
 * Markdown → AsciiDoc, Org-mode and OPML (split out of exportFormats.ts, which
 * re-exports all three). Inline Markdown is first turned into private-use
 * markers by inlineMarks.ts, so each format can write its own markup and check
 * the characters around it. Measured by formatRoundTrip.ts (W12.F1).
 */
import { createFenceTracker } from "./fenceTracker";
import { BOLD, CODE, EM, isWordChar, markInline } from "./inlineMarks";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Write marked inline text (inlineMarks.ts) in a markup whose markers only
 * count next to certain characters. `place` writes a marker for where it
 * stands (adding a separator, or doubling it, where the bare one would not
 * count). Every other character goes through `literal`, which
 * escapes a `*` (or `_`) that the target would read as markup.
 */
interface InlineWriter {
  em: [string, string];
  bold: [string, string];
  /** A code span, given the characters on both sides of it. */
  code: (c: string, prev: string | undefined, next: string | undefined) => string;
  /** The marker as written, given the characters on both sides of it and its index in the marked text. */
  place: (mark: string, prev: string | undefined, next: string | undefined, opening: boolean, i: number) => string;
  literal: (marked: string, i: number) => string;
}

function writeMarked(line: string, w: InlineWriter): string {
  const { text, restore } = markInline(line);
  const open: Record<string, boolean> = {};
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === CODE) {
      const end = text.indexOf(CODE, i + 1);
      out += w.code(text.slice(i + 1, end), text[i - 1], text[end + 1]);
      i = end;
      continue;
    }
    if (c === EM || c === BOLD) {
      const opening = !open[c];
      const [o, cl] = c === EM ? w.em : w.bold;
      out += w.place(opening ? o : cl, text[i - 1], text[i + 1], opening, i);
      open[c] = opening;
      continue;
    }
    out += w.literal(text, i);
  }
  return restore(out);
}

/** AsciiDoc: constrained `*x*` / `_x_` between non-word characters, else unconstrained `**x**` / `__x__`. */
function adocInline(line: string): string {
  const { text } = markInline(line);
  // Decide constrained/unconstrained per span, from the characters outside it.
  const spans = new Map<number, boolean>();
  for (const m of text.matchAll(/([\uE001\uE002])[\s\S]*?\1/g)) {
    const before = text[m.index - 1];
    const after = text[m.index + m[0].length];
    const ok = !isWordChar(before) && !isWordChar(after) && /\S/.test(m[0][1] ?? "") && /\S/.test(m[0][m[0].length - 2] ?? "");
    spans.set(m.index, ok);
    spans.set(m.index + m[0].length - 1, ok);
  }
  return writeMarked(line, {
    em: ["_", "_"],
    bold: ["*", "*"],
    // A span with a backtick in it is Asciidoctor's literal monospace `+…+`.
    code: (c) => (c.includes("`") ? "`+" + c + "+`" : "``" + c + "``"),
    place: (mark, _p, _n, _o, i) => (spans.get(i) ? mark : mark + mark),
    literal: (t, i) => {
      const c = t[i];
      // A literal * or _ next to another one, or that could close a pair, is escaped.
      if ((c === "*" || c === "_") && t[i - 1] !== "\\" && /[*_\uE001\uE002]/.test((t[i - 1] ?? "") + (t[i + 1] ?? ""))) return "\\" + c;
      if ((c === "*" || c === "_") && t[i - 1] !== "\\" && new RegExp(`\\${c}[^\\s${c}]`).test(t.slice(i, i + 2)) && t.indexOf(c, i + 1) > 0) return "\\" + c;
      return c;
    },
  });
}

/**
 * Markdown → AsciiDoc. Heading depth maps 1:1 (# → =, ## → ==); bold and
 * italic use the constrained marks between words and the unconstrained ones
 * inside a word; inline code is ``code``. Code blocks are copied untouched.
 */
export function markdownToAdoc(md: string): string {
  const fenceAt = createFenceTracker();
  const lines = md.split("\n");
  return lines
    .map((line, i) => {
      const { fence, inCode } = fenceAt(line);
      if (fence || inCode) return line;
      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (h) return `${"=".repeat(h[1].length)} ${adocInline(h[2])}`;
      // A thematic break is ''' (--- right under text stays: a setext underline).
      const hr = /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/.exec(line);
      if (hr && !(hr[1] === "-" && i > 0 && lines[i - 1].trim())) return "'''";
      const li = /^([-*+])(\s+)(.*)$/.exec(line);
      if (li && !hr) return `*${li[2]}${adocInline(li[3])}`;
      return adocInline(line);
    })
    .join("\n");
}

// Org reads a marker only after a space or one of -('"{ and before a space or
// punctuation (org-emphasis-regexp-components); markers may nest.
const ORG_PRE = /[\s\-('"{\uE001\uE002]/;
const ORG_POST = /[\s\-.,:!?;'")}[\\\uE001\uE002]/;

/**
 * Inline Markdown → Org: `code` → =code=, **bold** → *bold*, *italic* → /italic/.
 * Where Markdown has markup inside a word (common in Hebrew: ב**קובץ**) a
 * zero-width space separates it from the word, as the Org manual suggests;
 * orgToMarkdown drops it again. A literal * that Org would read as a marker
 * is the entity \ast{} (Org has no backslash escapes).
 */
function orgInline(line: string): string {
  const { text } = markInline(line);
  // Literal asterisks that Org would pair up into bold on this line.
  const pairs = new Set<number>();
  for (const m of text.matchAll(/(?<=^|[\s\-('"{\uE001\uE002\uE003])(?<!\\)\*(?=[^\s*])(?:[^\n*]*?[^\s*\\])??\*(?=$|[\s\-.,:!?;'")}[\\\uE001\uE002\uE003])/g)) {
    pairs.add(m.index);
    pairs.add(m.index + m[0].length - 1);
  }
  const zw = (ok: boolean) => (ok ? "" : "\u200B");
  return writeMarked(line, {
    em: ["/", "/"],
    bold: ["*", "*"],
    // =verbatim=, or ~code~ when the text has an = in it.
    code: (c, prev, next) => {
      const m = c.includes("=") && !c.includes("~") ? "~" : "=";
      return zw(prev === undefined || ORG_PRE.test(prev)) + m + c + m + zw(next === undefined || ORG_POST.test(next));
    },
    place: (mark, prev, next, opening) =>
      opening ? zw(prev === undefined || ORG_PRE.test(prev)) + mark : mark + zw(next === undefined || ORG_POST.test(next)),
    literal: (t, i) => {
      const c = t[i];
      const touches = c === "*" && t[i - 1] !== "\\" && /[\uE001\uE002]/.test((t[i - 1] ?? "") + (t[i + 1] ?? ""));
      return c === "*" && (pairs.has(i) || touches) ? "\\ast{}" : c;
    },
  });
}

/**
 * Markdown → Org-mode. Heading depth maps 1:1 (# → *, ## → **), bold &
 * italic syntax adjusted, code fences (``` and ~~~, with their language)
 * become `#+BEGIN_SRC`, and their content is copied untouched. A top-level
 * `*` bullet becomes `-`, since `* x` at the start of an Org line is a heading.
 */
export function markdownToOrg(md: string): string {
  const fenceAt = createFenceTracker();
  const lines = md.split("\n");
  let skip = -1;
  return lines
    .map((line, i) => {
      const { fence, inCode } = fenceAt(line);
      if (i === skip) return null;
      // A one-line setext heading (text, then === or ---) is an Org heading too.
      const under = !fence && !inCode && i + 1 < lines.length ? /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[i + 1]) : null;
      if (under && (i === 0 || !lines[i - 1].trim()) && /^ {0,3}[^\s#>*+\-=`~|<\d]/.test(line) && !/^ {0,3}(?:\d+[.)]\s|\[[^\]]+\]:)/.test(line)) {
        skip = i + 1;
        fenceAt(lines[i + 1]);
        return `${under[1][0] === "=" ? "*" : "**"} ${orgInline(line.trim())}`;
      }
      if (fence) return inCode ? `#+BEGIN_SRC ${/^ {0,3}(?:`{3,}|~{3,})\s*(.*)$/.exec(line)![1].trim()}`.trimEnd() : "#+END_SRC";
      if (inCode) return line;
      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (h) return `${"*".repeat(h[1].length)} ${orgInline(h[2])}`;
      // A thematic break is Org's rule of five dashes, on its own paragraph.
      // (--- right under text is a setext underline, handled above or kept.)
      const hr = /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/.exec(line);
      const afterText = i > 0 && lines[i - 1].trim() !== "";
      if (hr && !(hr[1] === "-" && afterText)) return afterText ? "\n-----" : "-----";
      const org = orgInline(line.replace(/^\*(?=[ \t]+\S)/, "-"));
      // A paragraph that starts with "** " would be an Org heading.
      return /^\*+[ \t]/.test(org) ? "\\ast{}" + org.slice(1) : org;
    })
    .filter((l) => l !== null)
    .join("\n");
}

/** An XML attribute value: newlines and tabs as character references, so attribute normalization keeps them. */
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");
}

/** A tight `-`/`*`/`+` list whose depths step by one (two spaces each) → [depth, text][], else null. */
function simpleOutline(body: string): Array<[number, string]> | null {
  const lines = body.replace(/^\n+|\n+$/g, "").split("\n");
  const items: Array<[number, string]> = [];
  for (const line of lines) {
    const m = /^( *)[-*+] +(\S.*)$/.exec(line);
    if (!m || m[1].length % 2) return null;
    const depth = m[1].length / 2;
    if (depth > (items.length ? items[items.length - 1][0] + 1 : 0)) return null;
    items.push([depth, m[2]]);
  }
  return items.length ? items : null;
}

/**
 * Markdown → OPML 2.0. Headings become outline levels: a heading is an
 * `<outline>` with `_heading` (its level) and the section's body nests under
 * it. A body that is a plain bullet list becomes child outlines; any other
 * body is kept as Markdown in `_note`, the attribute pandoc, OmniOutliner and
 * Fargo use for an outline's text. Content before the first heading is a list
 * of outlines when it is a list, otherwise an outline with `_note` only.
 */
export function markdownToOpml(md: string, title = "Outline"): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<opml version="2.0">');
  out.push(`<head><title>${escapeHtml(title)}</title></head>`);
  out.push("<body>");
  // Split into sections at ATX headings outside code fences.
  const fenceAt = createFenceTracker();
  const sections: Array<{ level: number; text: string; body: string[] }> = [{ level: 0, text: "", body: [] }];
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const { fence, inCode } = fenceAt(line);
    const h = !fence && !inCode ? /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line) : null;
    if (h) sections.push({ level: h[1].length, text: (h[2] ?? "").trim(), body: [] });
    else sections[sections.length - 1].body.push(line);
  }
  const open: number[] = []; // levels of the open heading outlines
  const emitBody = (lines: string[], depth: number): void => {
    const body = lines.join("\n");
    if (!body.trim()) return;
    const items = simpleOutline(body);
    const pad = "  ".repeat(depth);
    if (!items) {
      out.push(`${pad}<outline text="" _note="${escapeAttr(body.replace(/^\n+|\n+$/g, ""))}"/>`);
      return;
    }
    const stack: number[] = [];
    for (const [d, text] of items) {
      while (stack.length && stack[stack.length - 1] >= d) {
        stack.pop();
        out.push(`${pad}${"  ".repeat(stack.length)}</outline>`);
      }
      out.push(`${pad}${"  ".repeat(stack.length)}<outline text="${escapeAttr(text)}">`);
      stack.push(d);
    }
    while (stack.length) {
      stack.pop();
      out.push(`${pad}${"  ".repeat(stack.length)}</outline>`);
    }
  };
  for (const sec of sections) {
    if (sec.level === 0) {
      emitBody(sec.body, 0);
      continue;
    }
    while (open.length && open[open.length - 1] >= sec.level) {
      open.pop();
      out.push(`${"  ".repeat(open.length)}</outline>`);
    }
    out.push(`${"  ".repeat(open.length)}<outline text="${escapeAttr(sec.text)}" _heading="${sec.level}">`);
    open.push(sec.level);
    emitBody(sec.body, open.length);
  }
  while (open.length) {
    open.pop();
    out.push(`${"  ".repeat(open.length)}</outline>`);
  }
  out.push("</body>");
  out.push("</opml>");
  return out.join("\n");
}
