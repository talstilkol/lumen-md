/**
 * Bounds on pathological Markdown before it is parsed (plan W4.16).
 *
 * W1.27's fuzzer found inputs of 8–14 KB that take 0.5–2.8 s in the
 * preview's remark/rehype chain. All seven have runs of thousands of `[` or
 * `]`, and one also nests lists 231 levels deep. In micromark every `]`
 * looks back through the open link starts (and through all events when
 * there are none), and every nesting level stays open: the cost grows with
 * the square of the text. A note with such a block would freeze the editor
 * on every keystroke — a denial of service from a shared note.
 *
 * A block (text between blank lines) with a part over either bound is shown as raw
 * text instead: it goes into a fenced `text` code block, which the parser
 * reads line by line. Escaping the extra brackets one by one is not enough:
 * thousands of escapes are thousands of tokens, still hundreds of ms.
 *
 *   - MAX_BRACKETS `[` / `]` in one inline run (a paragraph, a list item, a
 *     quote line, a heading, a table row): there the cost is superlinear;
 *     2,000 links in 2,000 list items are not, and stay as they are;
 *   - MAX_CONTAINER_DEPTH nested list items and block quotes on one line.
 *
 *   - MAX_DELIMITERS `*` / `_` / `~` in one inline run (W10.D21: thousands
 *     of them cost seconds in the emphasis resolver, and after a URL in GFM's
 *     autolink-literal trailing-punctuation scan; one input overflowed the stack);
 *   - MAX_HTML_DEPTH raw HTML elements left open, counted over the whole note
 *     (rehype-raw parses all of a note's raw HTML as one stream, and the
 *     hast conversion recurses per level: about 2,200 levels overflow the
 *     stack). The block that would pass the bound is shown as raw text.
 *
 * Lone UTF-16 surrogates (a half-deleted emoji, a broken paste) become
 * U+FFFD first: parse5 threw on one inside an HTML comment, and the whole
 * preview failed with it.
 *
 * Blank lines are blank as CommonMark reads them (spaces and tabs only): a
 * line of U+00A0 does not end a block.
 *
 * Fenced code and `$$` math blocks are never changed. A note within both
 * bounds (every real note we know of) is returned unchanged after one cheap
 * scan. The incremental preview also falls back to raw text for a block
 * whose render took longer than its deadline (src/renderer/incrementalPreview.ts).
 */

export const MAX_BRACKETS = 1024;
export const MAX_CONTAINER_DEPTH = 32;
export const MAX_DELIMITERS = 1024;
export const MAX_HTML_DEPTH = 256;

const isSpace = (c: number) => c === 0x20 || c === 0x09;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

/**
 * Nested list items and block quotes at the start of one line, counted by a
 * linear scan. (W10.D21: this was a regular expression whose whitespace
 * could split two ways at every level; 32 `2)` markers with long space runs
 * and no match took minutes.)
 */
function lineDepth(line: string): number {
  let i = 0;
  let depth = 0;
  while (i < line.length && isSpace(line.charCodeAt(i))) i++;
  for (;;) {
    const c = line.charCodeAt(i);
    // A footnote definition holds blocks as a list item does (W10.D21: "> [^x]: - - - …").
    const note = c === 0x5b ? /^\[\^[^\]\r\n]{1,999}\]:/.exec(line.slice(i, i + 1004)) : null;
    if (note) {
      if (++depth > MAX_CONTAINER_DEPTH) return depth;
      i += note[0].length;
      while (i < line.length && isSpace(line.charCodeAt(i))) i++;
      continue;
    }
    let j = i;
    if (c === 0x3e /* > */ || c === 0x2a || c === 0x2b || c === 0x2d /* * + - */) j = i + 1;
    else if (isDigit(c)) {
      while (j < line.length && j - i < 9 && isDigit(line.charCodeAt(j))) j++;
      const d = line.charCodeAt(j);
      if (d !== 0x2e && d !== 0x29 /* . ) */) return depth;
      j++;
    } else return depth;
    // A list marker needs a space after it; a block quote's `>` does not (`>>` is two quotes).
    if (c !== 0x3e && j < line.length && !isSpace(line.charCodeAt(j))) return depth;
    depth++;
    if (depth > MAX_CONTAINER_DEPTH) return depth;
    i = j;
    while (i < line.length && isSpace(line.charCodeAt(i))) i++;
  }
}

function tooDeep(md: string): boolean {
  // CommonMark line endings: \r\n, \n and a lone \r.
  for (const line of md.split(/\r\n?|\n/)) if (lineDepth(line) > MAX_CONTAINER_DEPTH) return true;
  return false;
}

/** A blank line as CommonMark reads it: spaces and tabs only (not U+00A0, which `trim()` drops). */
const blank = (line: string) => /^[ \t]*$/.test(line);

/** HTML elements the parser closes by itself (or that have no content): they never nest deeper. */
const NO_DEPTH = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "p", "li", "dt", "dd", "tr", "td", "th", "option", "optgroup", "thead", "tbody", "tfoot", "rb", "rt", "rp", "colgroup", "caption"]);
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*?)?(\/?)>/g;

/** `text` without its code spans, in linear time (a backreference regex is quadratic on unmatched runs). */
function withoutCodeSpans(text: string): string {
  if (!text.includes("`")) return text;
  const runs: Array<[number, number]> = [];
  for (const m of text.matchAll(/`+/g)) runs.push([m.index, m[0].length]);
  const next = new Array<number>(runs.length).fill(-1);
  const last = new Map<number, number>();
  for (let i = runs.length - 1; i >= 0; i--) {
    next[i] = last.get(runs[i][1]) ?? -1;
    last.set(runs[i][1], i);
  }
  let out = "";
  let at = 0;
  for (let i = 0; i < runs.length; i++) {
    const j = next[i];
    if (j < 0) continue;
    out += text.slice(at, runs[i][0]);
    at = runs[j][0] + runs[j][1];
    i = j;
  }
  return out + text.slice(at);
}

/** The raw-HTML depth after `text`, starting at `depth`, and the deepest it reached. Code spans are not HTML. */
function htmlDepth(text: string, depth: number): { end: number; max: number } {
  let max = depth;
  if (!text.includes("<")) return { end: depth, max };
  for (const m of withoutCodeSpans(text).matchAll(TAG)) {
    if (m[3] || NO_DEPTH.has(m[2].toLowerCase())) continue;
    depth = m[1] ? Math.max(0, depth - 1) : depth + 1;
    if (depth > max) max = depth;
  }
  return { end: depth, max };
}

const wellFormed = (s: string): string =>
  typeof (s as { isWellFormed?: () => boolean }).isWellFormed === "function"
    ? (s as unknown as { isWellFormed(): boolean }).isWellFormed() ? s : (s as unknown as { toWellFormed(): string }).toWellFormed()
    : s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_OPEN = /^ {0,3}(\${2,})(.*)$/;
const MATH_CLOSE = /^ {0,3}(\${2,})[ \t]*$/;
/** A line that starts its own inline run: a list item, a heading or a table row (inside block quotes too). */
const STARTS_RUN = /^[ \t]*(?:[*+-][ \t]|\d{1,9}[.)][ \t]|#{1,6}[ \t]|\|)/;
/**
 * Does `line` end the inline run before it? A quote line continues the
 * paragraph it is in (W10.D21: one quote paragraph of 2,500 `> [[` lines was
 * counted line by line, so its brackets never reached the bound); an empty
 * quote line or a new list item, heading or table row inside it does not.
 */
function newRun(line: string): boolean {
  const rest = line.replace(/^(?:[ \t]*>)+/, "");
  return blank(rest) || STARTS_RUN.test(rest);
}

function brackets(text: string, stopAt = Infinity): number {
  let n = 0;
  for (let i = 0; i < text.length && n < stopAt; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x5b || c === 0x5d) n++;
  }
  return n;
}

function delimiters(text: string, stopAt = Infinity): number {
  let n = 0;
  for (let i = 0; i < text.length && n < stopAt; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x2a || c === 0x5f || c === 0x7e) n++;
  }
  return n;
}

/**
 * Is this text over a bound? The bracket bound is per inline run (a
 * paragraph, a list item, a quote line, a heading or a table row): that is
 * where the parser's cost is superlinear; many links in many list items are
 * not. One cheap scan first, so normal notes pay nothing.
 */
export function needsBounding(md: string): boolean {
  return tooDeep(md) || overRuns(md) || htmlTooDeep(md);
}

/** Raw HTML left open over the whole note, a paragraph at a time (a code span never crosses a blank line). */
function htmlTooDeep(md: string): boolean {
  if (!md.includes("<")) return false;
  let depth = 0;
  for (const part of md.split(/(?:\r\n?|\n)[ \t]*(?:\r\n?|\n)/)) {
    const d = htmlDepth(part, depth);
    if (d.max > MAX_HTML_DEPTH) return true;
    depth = d.end;
  }
  return false;
}

/** A bracket or delimiter bound passed in one inline run. One cheap count first. */
function overRuns(text: string): boolean {
  if (brackets(text, MAX_BRACKETS + 1) <= MAX_BRACKETS && delimiters(text, MAX_DELIMITERS + 1) <= MAX_DELIMITERS) return false;
  let run = 0;
  let delims = 0;
  for (const line of text.split(/\r\n?|\n/)) {
    if (newRun(line)) run = delims = 0;
    run += brackets(line);
    delims += delimiters(line);
    if (run > MAX_BRACKETS || delims > MAX_DELIMITERS) return true;
  }
  return false;
}

/** `text` as a fenced code block that shows it exactly (the fence outlasts any backtick run inside). */
export function asRawText(text: string): string {
  let longest = 2;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text.replace(/\n+$/, "")}\n${fence}`;
}

/** `md` with every block over a bound shown as raw text (unchanged when none is). */
/** CommonMark HTML block starts. Kinds 1–5 end at their marker (across blank lines), 6 and 7 at a blank line. */
const HTML_RAW = /^ {0,3}<(?:script|pre|style|textarea)(?:[\s>]|$)/i;
const HTML_BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const HTML_6 = new RegExp(`^ {0,3}</?(?:${HTML_BLOCK_TAGS})(?:[\\s/>]|$)`, "i");
const HTML_7 = /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)[ \t]*$/;
const UNTIL_BLANK = /(?!)/;
const CONTAINER_OPEN = /^ {0,3}:{3,}[A-Za-z]/;
const CONTAINER_CLOSE = /^ {0,3}:{3,}[ \t]*$/;

/** The end of the HTML block `line` starts, or null. Kind 7 cannot interrupt a paragraph. */
function htmlBlockStart(line: string, atBlockStart: boolean): RegExp | null {
  if (HTML_RAW.test(line)) return /<\/(?:script|pre|style|textarea)>/i;
  if (/^ {0,3}<!--/.test(line)) return /-->/;
  if (/^ {0,3}<\?/.test(line)) return /\?>/;
  if (/^ {0,3}<!\[CDATA\[/.test(line)) return /\]\]>/;
  if (/^ {0,3}<![A-Za-z]/.test(line)) return />/;
  if (HTML_6.test(line) || (atBlockStart && HTML_7.test(line))) return UNTIL_BLANK;
  return null;
}

/** A row's line without its line ending (CommonMark: \r\n, \n or a lone \r). */
const EOL = /(?:\r\n|\r|\n)$/;
const bare = (row: string) => row.replace(EOL, "");
/** `rows` (each with its line ending) shown as raw text; the last row's line ending stays outside the fence. */
function rawRows(rows: string[]): string {
  const text = rows.join("");
  const core = text.replace(EOL, "");
  return asRawText(core) + text.slice(core.length);
}

export function boundMarkdown(input: string): string {
  const md = wellFormed(input);
  if (!needsBounding(md)) return md;
  const out: string[] = [];
  let block: string[] = [];
  let html = 0;
  const flush = () => {
    if (!block.length) return;
    const text = block.join("").replace(EOL, "");
    let raw = tooDeep(text) || overRuns(text);
    if (!raw) {
      const d = htmlDepth(text, html);
      if (d.max > MAX_HTML_DEPTH) raw = true;
      else html = d.end;
    }
    out.push(raw ? rawRows(block) : block.join(""));
    block = [];
  };
  // A fenced code or `$$` math region is never changed, unless a line in it
  // is nested past the bound: then the region was probably not what it
  // seemed (a fence or `$$` inside a list, quote or directive ends with it)
  // and the whole region is shown as raw text.
  let region: string[] | null = null;
  let fence: string | null = null;
  let math = false;
  let mathLength = 2;
  const endRegion = () => {
    if (!region) return;
    out.push(region.some((r) => lineDepth(bare(r)) > MAX_CONTAINER_DEPTH) ? rawRows(region) : region.join(""));
    region = null;
    fence = null;
    math = false;
  };
  // Directive containers (`:::note` … `:::`) open: a fence or math region
  // inside one ends where the container does.
  let containers = 0;
  // Inside an HTML block a fence line is HTML text, not a fence (W10.D21: an
  // unclosed "~~~" there hid the deep HTML after it from the bounds).
  let htmlEnd: RegExp | null = null;
  // Rows split at every CommonMark line ending, a lone \r too (W10.D21: "$$\r[[[…"
  // closes the math block on its first line; read as one line, it hid the rest).
  const rows = md.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
  // Front matter is YAML (or TOML) to the parser, never Markdown: pass it
  // through, so no raw-text fence starts inside it (W10.D21: a fence opened
  // in the front matter ended there, and the block it should have held was
  // parsed after all).
  const fm = /^(---|\+\+\+)[ \t]*$/.exec(bare(rows[0] ?? ""));
  let start = 0;
  if (fm) {
    const close = rows.findIndex((r, i) => i > 0 && bare(r).replace(/[ \t]+$/, "") === fm[1]);
    if (close > 0) {
      out.push(...rows.slice(0, close + 1));
      start = close + 1;
    }
  }
  for (const row of rows.slice(start)) {
    const line = bare(row);
    const opens = CONTAINER_OPEN.test(line);
    const closes = containers > 0 && CONTAINER_CLOSE.test(line);
    if (region) {
      if (closes) {
        endRegion();
        containers--;
        out.push(row);
        continue;
      }
      region.push(row);
      if (fence) {
        const f = FENCE.exec(line);
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) endRegion();
      } else if (math) {
        const m = MATH_CLOSE.exec(line);
        if (m && m[1].length >= mathLength) endRegion();
      }
      continue;
    }
    if (htmlEnd) {
      // An HTML block inside a directive container ends with it.
      if (closes) {
        htmlEnd = null;
        flush();
        out.push(row);
        containers--;
        continue;
      }
      if (htmlEnd === UNTIL_BLANK && blank(line)) {
        htmlEnd = null;
        flush();
        out.push(row);
        continue;
      }
      block.push(row);
      if (htmlEnd !== UNTIL_BLANK && htmlEnd.test(line)) htmlEnd = null;
      continue;
    }
    // A container's own fence lines are never inside a raw-text block: the
    // container would end inside it, and the rest of the block be parsed.
    if (opens || closes) {
      flush();
      // A container label past the bounds (`:::note[[[[…`) is raw text, and opens nothing.
      if (opens && overRuns(line)) {
        out.push(rawRows([row]));
        continue;
      }
      out.push(row);
      if (opens) containers++;
      else containers--;
      continue;
    }
    // An opening fence as CommonMark (and remark-math) read it: a backtick
    // fence's info string has no backtick, a `$$` fence's meta no `$`
    // (W10.D21: "```ma…`…" and "$$ text" were taken the wrong way round, and
    // the "fence" hid the rest of the note).
    const f = FENCE.exec(line);
    const m = f ? null : MATH_OPEN.exec(line);
    if ((f && !(f[1][0] === "`" && line.slice(f[0].length).includes("`"))) || (m && !m[2].includes("$"))) {
      flush();
      region = [row];
      if (f) fence = f[1];
      else {
        math = true;
        mathLength = m![1].length;
      }
      continue;
    }
    if (blank(line)) {
      flush();
      out.push(row);
      continue;
    }
    const end = htmlBlockStart(line, block.length === 0);
    if (end) {
      block.push(row);
      // A kind 1–5 block can end on its first line (`<!-- x -->`).
      if (end === UNTIL_BLANK || !end.test(line.replace(/^ *<!?-?-?/, ""))) htmlEnd = end;
      continue;
    }
    block.push(row);
  }
  endRegion();
  flush();
  return out.join("");
}
