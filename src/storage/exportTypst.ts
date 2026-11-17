/**
 * Markdown → Typst source (.typ), plan W12.F2.
 *
 * Typst (https://typst.app, Apache-2.0) is a modern typesetting language
 * with good right-to-left support. This writer is pure and has no
 * dependencies: it turns a note into a `.typ` file that `typst compile`
 * renders to PDF. The PDF step in the browser (typst.ts as a lazy wasm chunk)
 * is owed: the package is not in this repository yet, see the docs.
 *
 * Direction: a Hebrew note gets `#set text(lang: "he")`, which makes Typst lay
 * paragraphs out right to left. A paragraph whose first strong character is
 * in the other direction is wrapped in a scoped `#[#set text(dir: …) …]`, the
 * Typst equivalent of a per-paragraph `dir`.
 *
 * Covered: headings, paragraphs, bold, italic, inline code, links, images
 * (as a path), bullet and numbered lists (nested), task lists, pipe tables,
 * fenced code (with its language), block quotes, thematic breaks, footnotes
 * and math. Typst math is not LaTeX: a small, common subset of TeX
 * (fractions, roots, Greek letters, relations, sums and integrals) is
 * translated; anything else is kept as raw text, so nothing is silently
 * mistranslated.
 */
import { firstStrongDirection, markdownBaseDirection, type BaseDirection } from "../lib/textDirection";

/** Characters with a meaning in Typst markup, escaped with a backslash. */
const MARKUP_SPECIAL = /[\\*_`#$<>@[\]~/=+\-"]/g;

/** Escape text for Typst markup. `-`, `+`, `=` and `/` only matter at a line start or as `//`, but escaping them everywhere is valid and safe. */
export function escapeTypst(s: string): string {
  return s.replace(MARKUP_SPECIAL, (c) => `\\${c}`);
}

/** A Typst string literal. */
const str = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;

/* ─── math ───────────────────────────────────────────────────────────── */

const TEX_SYMBOLS: Record<string, string> = {
  alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta", epsilon: "epsilon", varepsilon: "epsilon.alt",
  zeta: "zeta", eta: "eta", theta: "theta", iota: "iota", kappa: "kappa", lambda: "lambda", mu: "mu", nu: "nu",
  xi: "xi", pi: "pi", rho: "rho", sigma: "sigma", tau: "tau", phi: "phi", varphi: "phi.alt", chi: "chi",
  psi: "psi", omega: "omega", Gamma: "Gamma", Delta: "Delta", Theta: "Theta", Lambda: "Lambda", Pi: "Pi",
  Sigma: "Sigma", Phi: "Phi", Psi: "Psi", Omega: "Omega",
  cdot: "dot", times: "times", div: "div", pm: "plus.minus", mp: "minus.plus", le: "<=", leq: "<=", ge: ">=",
  geq: ">=", neq: "!=", ne: "!=", approx: "approx", equiv: "equiv", infty: "infinity", sum: "sum", prod: "product",
  int: "integral", partial: "diff", nabla: "nabla", to: "->", rightarrow: "->", leftarrow: "<-", Rightarrow: "=>",
  in: "in", notin: "in.not", subset: "subset", subseteq: "subset.eq", cup: "union", cap: "sect", forall: "forall",
  exists: "exists", ldots: "...", cdots: "dots.h.c", sin: "sin", cos: "cos", tan: "tan", log: "log", ln: "ln",
  lim: "lim", max: "max", min: "min", exp: "exp",
};

/** Read one TeX argument `{…}` (balanced) or a single token at `i`. */
function texArg(tex: string, i: number): [string, number] {
  while (tex[i] === " ") i++;
  if (tex[i] !== "{") return [tex[i] ?? "", i + 1];
  let depth = 0;
  for (let j = i; j < tex.length; j++) {
    if (tex[j] === "{") depth++;
    else if (tex[j] === "}" && --depth === 0) return [tex.slice(i + 1, j), j + 1];
  }
  return [tex.slice(i + 1), tex.length];
}

/**
 * TeX → Typst math for the common subset, or null when the formula uses
 * anything else (the caller then keeps it as raw text).
 */
export function texToTypstMath(tex: string): string | null {
  let out = "";
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
      if (!m) return null;
      const name = m[1];
      i += m[0].length;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const [a, j] = texArg(tex, i);
        const [b, k] = texArg(tex, j);
        const ta = texToTypstMath(a);
        const tb = texToTypstMath(b);
        if (ta === null || tb === null) return null;
        out += `(${ta})/(${tb})`;
        i = k;
      } else if (name === "sqrt") {
        const [a, j] = texArg(tex, i);
        const ta = texToTypstMath(a);
        if (ta === null) return null;
        out += `sqrt(${ta})`;
        i = j;
      } else if (name === "text" || name === "mathrm") {
        const [a, j] = texArg(tex, i);
        out += str(a);
        i = j;
      } else if (name in TEX_SYMBOLS) {
        out += ` ${TEX_SYMBOLS[name]} `;
      } else if (name === "," || name === ";" || name === " " || name === "quad") {
        out += " ";
      } else if (name === "{" || name === "}") {
        out += `\\${name}`;
      } else return null;
      continue;
    }
    if (c === "^" || c === "_") {
      const [a, j] = texArg(tex, i + 1);
      const ta = texToTypstMath(a);
      if (ta === null) return null;
      out += `${c}(${ta})`;
      i = j;
      continue;
    }
    if (c === "{") {
      const [a, j] = texArg(tex, i);
      const ta = texToTypstMath(a);
      if (ta === null) return null;
      out += `(${ta})`;
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      // Typst reads a run of letters as one identifier: keep TeX's single-letter variables apart.
      out += /[A-Za-z]/.test(tex[i + 1] ?? "") ? `${c} ` : c;
      i++;
      continue;
    }
    if (c === '"' || c === "#" || c === "$") return null;
    out += c;
    i++;
  }
  return out.replace(/ {2,}/g, " ").replace(/ +([)^_,])/g, "$1").replace(/\( +/g, "(").trim();
}

function mathTypst(tex: string, display: boolean): string {
  const t = texToTypstMath(tex.trim());
  if (t === null) return display ? `#raw(${str(tex.trim())}, block: true)` : `#raw(${str(tex.trim())})`;
  return display ? `$ ${t} $` : `$${t}$`;
}

/* ─── inline ─────────────────────────────────────────────────────────── */

interface Ctx {
  notes: Map<string, string>;
}

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\$([^$\s](?:[^$]*[^$\s])?)\$|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<![*\w])\*(?=\S)([^*\n]+?)\*(?![*\w])|(?<![_\w])_(?=\S)([^_\n]+?)_(?![_\w])|~~([^~\n]+?)~~|!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[\^([^\]\s]+)\]|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>/g;

export function inlineTypst(text: string, ctx: Ctx = { notes: new Map() }): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    out += escapeTypst(text.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] !== undefined) out += `#raw(${str(m[2].replace(/^ (.*) $/, "$1"))})`;
    else if (m[3] !== undefined) out += mathTypst(m[3], false);
    else if (m[4] !== undefined || m[5] !== undefined) out += `#strong[${inlineTypst(m[4] ?? m[5], ctx)}]`;
    else if (m[6] !== undefined || m[7] !== undefined) out += `#emph[${inlineTypst(m[6] ?? m[7], ctx)}]`;
    else if (m[8] !== undefined) out += `#strike[${inlineTypst(m[8], ctx)}]`;
    else if (m[10] !== undefined) out += `#figure(image(${str(m[10])}), caption: [${inlineTypst(m[9], ctx)}])`;
    else if (m[11] !== undefined) {
      const body = ctx.notes.get(m[11]);
      out += body === undefined ? escapeTypst(m[0]) : `#footnote[${inlineTypst(body, ctx)}]`;
    } else if (m[12] !== undefined) out += `#link(${str(m[13])})[${inlineTypst(m[12], ctx)}]`;
    else if (m[14] !== undefined) out += `#link(${str(m[14])})`;
  }
  return out + escapeTypst(text.slice(last));
}

/* ─── blocks ─────────────────────────────────────────────────────────── */

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const isTableSep = (l: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}
const blockStart = (l: string, next: string | undefined) =>
  !l.trim() || /^\s*(```|~~~|\$\$|#{1,6}\s|>)/.test(l) || LIST.test(l) || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l) || (l.includes("|") && next !== undefined && isTableSep(next));

/** A paragraph-like block in the base direction, or scoped to the other one. */
function directed(text: string, base: BaseDirection, body: string): string {
  const d = firstStrongDirection(text);
  return d && d !== base ? `#[#set text(dir: ${d})\n${body}]` : body;
}

function extractNotes(lines: string[], ctx: Ctx): string[] {
  const kept: string[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    const def = fence ? null : /^\[\^([^\]\s]+)\]:\s?(.*)$/.exec(lines[i]);
    if (!def) {
      kept.push(lines[i]);
      continue;
    }
    let body = def[2];
    while (i + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[i + 1])) body += " " + lines[++i].trim();
    if (!ctx.notes.has(def[1])) ctx.notes.set(def[1], body);
  }
  return kept;
}

function bodyTypst(md: string, ctx: Ctx, base: BaseDirection): string[] {
  const lines = extractNotes(md.replace(/\r\n?/g, "\n").split("\n"), ctx);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++;
      out.push(`#raw(${str(code.join("\n"))}, block: true${fence[2] ? `, lang: ${str(fence[2])}` : ""})`);
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line)) {
      const tex: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*\$\$\s*$/.test(lines[j])) tex.push(lines[j++]);
      if (j < lines.length) {
        out.push(mathTypst(tex.join(" "), true));
        i = j + 1;
        continue;
      }
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      out.push(directed(h[2], base, `${"=".repeat(h[1].length)} ${inlineTypst(h[2], ctx)}`));
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("#line(length: 100%)");
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "end" : "start"));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const cols = Math.max(header.length, ...rows.map((r) => r.length));
      const cell = (c: string | undefined) => `[${inlineTypst(c ?? "", ctx)}]`;
      const row = (r: string[]) => Array.from({ length: cols }, (_, k) => cell(r[k])).join(", ");
      // `start`/`end` follow the text direction, so a Hebrew table's first column is on the right.
      out.push(
        `#table(\n  columns: ${cols},\n  align: (${Array.from({ length: cols }, (_, k) => aligns[k] ?? "start").join(", ")},),\n` +
          `  table.header(${row(header)}),\n${rows.map((r) => `  ${row(r)},`).join("\n")}\n)`,
      );
      continue;
    }
    if (LIST.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (m) {
          const depth = Math.floor(m[1].replace(/\t/g, "    ").length / 2);
          const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
          const text = task ? `${task[1] === " " ? "☐" : "☑"} ${inlineTypst(task[2], ctx)}` : inlineTypst(m[3], ctx);
          items.push(`${"  ".repeat(depth)}${/\d/.test(m[2]) ? "+" : "-"} ${text}`);
          i++;
        } else if (lines[i].trim() && !blockStart(lines[i], lines[i + 1])) {
          items[items.length - 1] += " " + inlineTypst(lines[i++].trim(), ctx);
        } else break;
      }
      out.push(items.join("\n"));
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      out.push(`#quote(block: true)[\n${bodyTypst(quote.join("\n"), ctx, base).join("\n\n")}\n]`);
      continue;
    }
    const raw: string[] = [line];
    i++;
    while (i < lines.length && !blockStart(lines[i], lines[i + 1])) raw.push(lines[i++]);
    // A hard break (two trailing spaces or a backslash) is Typst's `\` at the line end.
    const body = raw
      .map((l, k) => inlineTypst(l.trim().replace(/\\$/, ""), ctx) + (k < raw.length - 1 && /( {2,}|\\)$/.test(l) ? " \\" : ""))
      .join("\n");
    out.push(directed(raw.join(" "), base, body));
  }
  return out;
}

/**
 * The document's direction: `dir:` in the frontmatter when pinned, else the
 * script most of its letters are in. A Hebrew note that opens with an English
 * product name is still a Hebrew document (its language, hyphenation and page
 * direction); each paragraph still takes its own first strong character.
 */
export function typstBaseDirection(md: string): BaseDirection {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md)?.[1];
  if (fm && /^dir:\s*["']?(ltr|rtl)/m.test(fm)) return markdownBaseDirection(md);
  const text = md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "").replace(/\]\([^)]*\)/g, "]");
  const rtl = text.match(/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g)?.length ?? 0;
  const ltr = text.match(/[A-Za-z]/g)?.length ?? 0;
  return rtl > ltr ? "rtl" : rtl === ltr ? markdownBaseDirection(md) : "ltr";
}

export interface TypstOptions {
  title?: string;
}

/** The note as a complete Typst document. */
export function markdownToTypst(md: string, opts: TypstOptions = {}): string {
  let body = md;
  let title = opts.title;
  if (body.startsWith("---\n")) {
    const end = body.indexOf("\n---", 4);
    if (end > 0) {
      const fm = body.slice(4, end);
      title ??= /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm)?.[1];
      body = body.slice(end + 4).replace(/^\n/, "");
    }
  }
  const base = typstBaseDirection(md);
  const ctx: Ctx = { notes: new Map() };
  const blocks = bodyTypst(body, ctx, base);
  const head = [
    "// Lumen → Typst. Compile with: typst compile note.typ",
    title ? `#set document(title: ${str(title)})` : null,
    base === "rtl"
      ? '#set text(lang: "he", font: ("David CLM", "Noto Serif Hebrew", "Libertinus Serif"))'
      : '#set text(lang: "en", font: ("Libertinus Serif", "Noto Serif Hebrew"))',
    "#set par(justify: false)",
    '#show raw: set text(dir: ltr)',
    "",
  ].filter((l): l is string => l !== null);
  return head.join("\n") + blocks.join("\n\n") + "\n";
}
