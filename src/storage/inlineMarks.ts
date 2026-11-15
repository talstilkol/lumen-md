/**
 * Inline Markdown → private-use markers, for the exporters that write another
 * lightweight markup (Org, AsciiDoc; W12 format round trip).
 *
 * One line at a time: code spans become `CODE…CODE` with their CommonMark
 * content, `**x**` / `__x__` become `BOLD x BOLD`, `*x*` / `_x_` become
 * `EM x EM`, and link destinations and autolinks are parked so nothing inside
 * them is rewritten. Underscores follow CommonMark's rule that `_` inside a
 * word is not emphasis (snake_case stays as it is). Emphasis that spans lines
 * is not seen and stays as written.
 */

export const EM = "\uE001";
export const BOLD = "\uE002";
export const CODE = "\uE003";
/** Placeholder for a parked link destination or autolink. */
export const LINK = "\uE004";

export interface MarkedLine {
  /** The line with markers; parked links are `LINK n LINK`. */
  text: string;
  /** Put the parked links back. */
  restore: (s: string) => string;
}

const WORD = /[\p{L}\p{N}]/u;

/** Mark one line of inline Markdown. */
export function markInline(line: string): MarkedLine {
  const code: string[] = [];
  // CommonMark drops one space at each end of a code span when both are there.
  let text = line.replace(/(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_m, _t: string, c: string) => {
    code.push(/^ [\s\S]* $/.test(c) && c.trim() !== "" ? c.slice(1, -1) : c);
    return `${CODE}${code.length - 1}${CODE}`;
  });
  const links: string[] = [];
  text = text.replace(/\]\([^)\s]*(?:\s+"[^"]*")?\)|<[a-z][\w+.-]*:[^\s<>]*>/gi, (m) => `${LINK}${links.push(m) - 1}${LINK}`);
  // A span may hold whole spans of the other kind, never half of one
  // (*a _b* c_ crosses, so it is left as written).
  const balanced = (inner: string): boolean => (inner.split(EM).length - 1) % 2 === 0 && (inner.split(BOLD).length - 1) % 2 === 0;
  const wrap = (mark: string, n: number) => (m: string) => {
    const inner = m.slice(n, -n);
    return balanced(inner) ? `${mark}${inner}${mark}` : m;
  };
  // The text of a span: escapes (\*) allowed, starts and ends with a non-space.
  const body = (d: string) => `(?=[^\\s${d}])(?:\\\\.|[^${d}\\\\\\n])*?(?:\\\\.|[^\\s${d}\\\\])`;
  const star = (n: number) => new RegExp(`${n === 1 ? "(?<![*\\\\])" : "(?<!\\\\)"}${"\\*".repeat(n)}${body("*")}${"\\*".repeat(n)}${n === 1 ? "(?!\\*)" : ""}`, "g");
  // Underscore runs: not inside a word, and not across a link or a tag.
  const us = (n: number) =>
    new RegExp(`(?<![\\p{L}\\p{N}_\\\\])${"_".repeat(n)}${body("_\\[\\]<>")}${"_".repeat(n)}(?![\\p{L}\\p{N}_])`, "gu");
  // Innermost spans first; a few passes take nesting (*a **b** c*, ***x***).
  for (let pass = 0; pass < 3; pass++) {
    const before = text;
    text = text.replace(star(2), wrap(BOLD, 2)).replace(us(2), wrap(BOLD, 2)).replace(star(1), wrap(EM, 1)).replace(us(1), wrap(EM, 1));
    if (text === before) break;
  }
  // Code goes back as CODE<content>CODE, so the writer sees it whole.
  text = text.replace(new RegExp(`${CODE}(\\d+)${CODE}`, "g"), (_m, i: string) => `${CODE}${code[Number(i)]}${CODE}`);
  return { text, restore: (s) => s.replace(new RegExp(`${LINK}(\\d+)${LINK}`, "g"), (_m, i: string) => links[Number(i)]) };
}

export const isWordChar = (c: string | undefined): boolean => c !== undefined && WORD.test(c);
