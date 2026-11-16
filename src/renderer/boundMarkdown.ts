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
 *   - MAX_DELIMITERS `*` / `_` / `~` / `-` in one inline run (W10.D21:
 *     thousands of them cost seconds in the emphasis resolver and in GFM's
 *     autolink-literal scans; one input overflowed the stack);
 *   - MAX_HTML_DEPTH raw HTML elements left open, counted over the whole note
 *     (rehype-raw parses all of a note's raw HTML as one stream, and the
 *     hast conversion recurses per level: about 2,200 levels overflow the
 *     stack). The block that would pass the bound is shown as raw text.
 *     Review 10 M2: an element opened inside a paragraph (a heading, a list
 *     item, a table cell) is closed by the parser where that paragraph ends,
 *     unless its name is one the parser keeps open past it (CARRY: block,
 *     formatting and scoping elements) or it is in an HTML block. Only those
 *     carry over to the next block; `List<T>` or `Promise<void>` in a code
 *     span count inside their own block only.
 *
 * Lone UTF-16 surrogates (a half-deleted emoji, a broken paste) become
 * U+FFFD first: parse5 threw on one inside an HTML comment, and the whole
 * preview failed with it.
 *
 * Blank lines are blank as CommonMark reads them (spaces and tabs only): a
 * line of U+00A0 does not end a block.
 *
 * Table rows are inline runs of their own once a GFM table has started
 * (review 10 M3: a table without leading pipes was one run, and a few
 * hundred dated rows passed the delimiter bound). A line starting with `|`
 * is not a run of its own outside a table (it is paragraph text there).
 *
 * Fenced code and `$$` math blocks are never changed. A note within all
 * bounds is returned unchanged after one cheap scan. The incremental preview also falls back to raw text for a block
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
/**
 * Elements the HTML parser does not close when the paragraph (heading, list
 * item, table cell) they were opened in ends: the "special" and scoping
 * elements of the HTML standard (a block element closes the paragraph and
 * opens outside it; a scoping one hides the paragraph's end tag), the
 * formatting elements (reopened in every later paragraph), and svg / math.
 * Every other name (`T`, `void`, `span`, a custom element) is popped there.
 */
const CARRY = new Set(
  ("address applet article aside basefont bgsound blockquote body button center details dialog dir div dl fieldset figcaption figure footer form frame frameset " +
    "h1 h2 h3 h4 h5 h6 head header hgroup html iframe keygen listing main marquee menu nav noembed noframes noscript object ol param plaintext pre script search " +
    "section select style summary table template textarea title ul xmp a b big code em font i nobr s small strike strong tt u svg math foreignobject desc " +
    "mi mo mn ms mtext annotation-xml").split(" "),
);
/** HTML start tags that leave svg / math content (a self-closing slash on them is ignored, as on any HTML element). */
const BREAKOUT = new Set("b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var font".split(" "));
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*?)?(\/?)>/g;
/** An element left open: its name, and whether it stays open past the paragraph it is in. */
type Open = { name: string; carry: boolean };

/**
 * The raw-HTML elements open after `text`, starting with `open`, and the
 * deepest it reached. Tags in code spans count inside the block too: where
 * a code span ends depends on the whole paragraph or table row, and a guess
 * that pairs the wrong backticks hides the tags between them (W10.D21,
 * fuzz #970703 #428652). Review 10 M2: from the first line that starts an
 * HTML block (or from the start when `rawAtStart`), every element carries;
 * before it only CARRY names do. An end tag closes the innermost element
 * only when it has that name (`<x></y>` repeated nests in the parser, too);
 * `<x/>` opens x, as the parser reads it, except in svg / math.
 */
function htmlDepth(text: string, open: readonly Open[], rawAtStart = false): { end: Open[]; max: number } {
  const stack = open.slice();
  let max = stack.length;
  if (!text.includes("<")) return { end: stack, max };
  const rawFrom = rawAtStart ? 0 : htmlBlockOffset(text);
  let foreign = stack.filter((e) => e.name === "svg" || e.name === "math").length;
  for (const m of text.matchAll(TAG)) {
    const name = m[2].toLowerCase();
    if (NO_DEPTH.has(name)) continue;
    if (m[1]) {
      if (stack.length && stack[stack.length - 1].name === name) {
        stack.pop();
        if (name === "svg" || name === "math") foreign--;
      }
      continue;
    }
    if (m[3] && (name === "svg" || name === "math" || (foreign > 0 && !BREAKOUT.has(name)))) continue;
    stack.push({ name, carry: (m.index ?? 0) >= rawFrom || CARRY.has(name) });
    if (name === "svg" || name === "math") foreign++;
    if (stack.length > max) max = stack.length;
  }
  return { end: stack.filter((e) => e.carry), max };
}

/** Quote markers, list markers and indentation before a line's content. */
const CONTAINER_PREFIX = /^(?:[ \t]*(?:>|[*+-][ \t]|\d{1,9}[.)][ \t]))*[ \t]*/;
/** The offset of the first line in `text` that starts an HTML block, read loosely (inside quotes and list items too), or Infinity. */
function htmlBlockOffset(text: string): number {
  let at = 0;
  for (const line of text.split(/(?<=\r\n|\r(?!\n)|\n)/)) {
    const core = line.replace(EOL, "");
    if (htmlBlockStart(core, true) || htmlBlockStart(core.replace(CONTAINER_PREFIX, ""), true)) return at;
    at += line.length;
  }
  return Infinity;
}

const wellFormed = (s: string): string =>
  typeof (s as { isWellFormed?: () => boolean }).isWellFormed === "function"
    ? (s as unknown as { isWellFormed(): boolean }).isWellFormed() ? s : (s as unknown as { toWellFormed(): string }).toWellFormed()
    : s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_OPEN = /^ {0,3}(\${2,})(.*)$/;
const MATH_CLOSE = /^ {0,3}(\${2,})[ \t]*$/;
/**
 * A line that starts its own inline run: a list item or a heading (inside
 * block quotes too). A table row does once its table has started (see
 * overRuns); a line starting with `|` outside a table is paragraph text
 * (review 10: 20,000 lines of `|[` were 20,000 runs here, one paragraph to
 * the parser, 4 s).
 */
const STARTS_RUN = /^[ \t]*(?:[*+-][ \t]|\d{1,9}[.)][ \t]|#{1,6}[ \t])/;
const LIST_ITEM = /^([ \t]*)(?:[*+-]|\d{1,9}[.)])([ \t]+)/;
const QUOTES = /^(?:[ \t]*>)+/;
/**
 * Does `line` end the inline run before it? A quote line continues the
 * paragraph it is in (W10.D21: one quote paragraph of 2,500 `> [[` lines was
 * counted line by line, so its brackets never reached the bound); an empty
 * quote line or a new list item or heading inside it does not.
 */
function newRun(line: string): boolean {
  const rest = line.replace(QUOTES, "");
  return blank(rest) || STARTS_RUN.test(rest);
}

/** A GFM delimiter row (`--- | :-:`, `|-|`): it has a pipe. */
const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/** The number of cells in a table row: split at unescaped pipes, without a leading or trailing one. */
function cellCount(row: string): number {
  let t = row.trim();
  if (t.startsWith("|")) t = t.slice(1);
  let n = 1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\") i++;
    else if (t[i] === "|") n = i === t.length - 1 ? n : n + 1;
  }
  return n;
}
const quoteDepth = (line: string) => (QUOTES.exec(line)?.[0].match(/>/g) ?? []).length;
/** `line` without its `q` quote markers (and the one optional space after them). */
const unquoted = (line: string, q: number) => (q ? line.replace(QUOTES, "").replace(/^ /, "") : line);
const indent = (line: string) => /^[ \t]*/.exec(line)![0].replace(/\t/g, "    ").length;
const FOOTNOTE = /^[ \t]*\[\^/;
/** A table being read: its quote depth and the indentation its rows need (inside a list item: the item's content column). */
type Table = { q: number; min: number };
/**
 * Is `delimiter` the second line of a GFM table whose header is `header`?
 * Only where the parser surely reads it so (review 10 M3): the same quote
 * depth as the line that started the run, the same indentation (at most 3,
 * or inside the run's list item), a header without a backtick (a code span
 * does not hide its pipes from the cell split, but a guess could), and as
 * many header cells as delimiter cells. A header that is the lazy end of a
 * list item or footnote paragraph is not a table, so a run started by one
 * needs the header indented into its item. Anything else stays one run.
 */
function startsTable(header: string, delimiter: string, runStart: string): Table | null {
  const q = quoteDepth(runStart);
  if (quoteDepth(header) !== q || quoteDepth(delimiter) !== q) return null;
  const h = unquoted(header, q);
  const d = unquoted(delimiter, q);
  if (!d.includes("|") || !DELIMITER_ROW.test(d) || h.includes("`") || !h.includes("|") || blank(h) || STARTS_RUN.test(h)) return null;
  if (indent(h) !== indent(d)) return null;
  const start = unquoted(runStart, q);
  if (FOOTNOTE.test(start) || FOOTNOTE.test(h)) return null;
  const item = runStart !== header ? LIST_ITEM.exec(start) : null;
  let min = 0;
  if (item) {
    min = indent(item[1]) + (item[0].length - item[1].length - item[2].length) + Math.min(item[2].length, 4);
    if (indent(h) < min || indent(h) >= min + 4) return null;
  } else if (indent(h) > 3) return null;
  return cellCount(h) === cellCount(d) ? { q, min } : null;
}
/** Does `line` go on as a row of `table` (same quote depth, indented as its rows, not the start of another block)? */
function tableRow(line: string, table: Table): boolean {
  if (quoteDepth(line) !== table.q) return false;
  const rest = unquoted(line, table.q);
  const ind = indent(rest);
  if (blank(rest) || ind < table.min || ind >= table.min + 4) return false;
  const core = rest.slice(/^[ \t]*/.exec(rest)![0].length);
  return !STARTS_RUN.test(core) && !FENCE.test(core) && !htmlBlockStart(core, true) && !/^([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(core);
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
    // `-` too: GFM's autolink literal rescans runs of domain characters
    // ("- - - …" thousands long: 0.5-2 s; W10.D21, fuzz #10898 #193112).
    if (c === 0x2a || c === 0x5f || c === 0x7e || c === 0x2d) n++;
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

/**
 * Raw HTML left open over the whole note, a paragraph at a time. An HTML
 * block that ends at a marker (`<pre>`, `<!--` …) goes on past blank lines:
 * the paragraphs it holds are HTML, and every element in them carries.
 */
function htmlTooDeep(md: string): boolean {
  if (!md.includes("<")) return false;
  let open: Open[] = [];
  let pending: RegExp | null = null;
  for (const part of md.split(/(?:\r\n?|\n)[ \t]*(?:\r\n?|\n)/)) {
    const d = htmlDepth(part, open, pending !== null);
    if (d.max > MAX_HTML_DEPTH) return true;
    open = d.end;
    pending = htmlPending(part, pending);
  }
  return false;
}

/** The end marker of an HTML block of kind 1–5 still open after `text` (read loosely, as htmlBlockOffset), or null. */
function htmlPending(text: string, pending: RegExp | null): RegExp | null {
  for (const line of text.split(/\r\n?|\n/)) {
    if (pending) {
      if (pending.test(line)) pending = null;
      continue;
    }
    for (const l of [line, line.replace(CONTAINER_PREFIX, "")]) {
      const end = htmlBlockStart(l, true);
      if (end && end !== UNTIL_BLANK && !end.test(l.replace(/^[ \t]*<!?-?-?/, ""))) {
        pending = end;
        break;
      }
    }
  }
  return pending;
}

/** A bracket or delimiter bound passed in one inline run. One cheap count first. */
function overRuns(text: string): boolean {
  if (brackets(text, MAX_BRACKETS + 1) <= MAX_BRACKETS && delimiters(text, MAX_DELIMITERS + 1) <= MAX_DELIMITERS) return false;
  let run = 0;
  let delims = 0;
  const lines = text.split(/\r\n?|\n/);
  // The line that started the current run, and the table being read.
  let runStart = "";
  let table: Table | null = null;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    let fresh = false;
    if (table) {
      fresh = true;
      if (!tableRow(line, table)) table = null;
    } else if (k > 0 && (table = startsTable(lines[k - 1], line, runStart))) fresh = true;
    if (!fresh && blank(runStart.replace(QUOTES, ""))) runStart = line;
    if (fresh || newRun(line) || k === 0) {
      run = delims = 0;
      runStart = line;
    }
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
  let html: Open[] = [];
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
      // A container line past the bounds (`:::note[[[[…`, `:::n<div><div>…`) is raw text, and opens nothing.
      const d = htmlDepth(line, html);
      if (opens && (tooDeep(line) || overRuns(line) || d.max > MAX_HTML_DEPTH)) {
        out.push(rawRows([row]));
        continue;
      }
      html = d.end;
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
