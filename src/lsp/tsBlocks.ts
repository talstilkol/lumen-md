/**
 * TypeScript code blocks in a Markdown document — the units the in-editor
 * type checker analyses (see ./tsService and ../editor/tsCheckExtension).
 * Pure: no DOM, no TypeScript import.
 */

export interface TsBlock {
  /** Stable per position in the document: `block-<n>`. */
  id: string;
  /** `.tsx` blocks allow JSX. */
  tsx: boolean;
  /** Offset of the first code character in the document. */
  from: number;
  /** Offset just past the last code character. */
  to: number;
  code: string;
}

const TS_LANGS = new Set(["ts", "typescript", "mts", "cts", "tsx"]);
const OPEN_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;

/** Fenced ```ts / ```typescript / ```tsx blocks, in document order. */
export function findTsBlocks(doc: string): TsBlock[] {
  const out: TsBlock[] = [];
  let pos = 0;
  let open: { char: string; len: number; lang: string; codeFrom: number } | null = null;
  while (pos <= doc.length) {
    const nl = doc.indexOf("\n", pos);
    const end = nl === -1 ? doc.length : nl;
    const line = doc.slice(pos, end);
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === open.char && close[1].length >= open.len) {
        if (TS_LANGS.has(open.lang)) {
          // Code ends before the newline that precedes the closing fence.
          const to = Math.max(open.codeFrom, pos - 1);
          out.push({
            id: `block-${out.length}`,
            tsx: open.lang === "tsx",
            from: open.codeFrom,
            to,
            code: doc.slice(open.codeFrom, to),
          });
        }
        open = null;
      }
    } else {
      const m = OPEN_RE.exec(line);
      if (m && !(m[1][0] === "`" && line.slice(m[0].length).includes("`"))) {
        open = {
          char: m[1][0],
          len: m[1].length,
          lang: m[2].toLowerCase(),
          codeFrom: nl === -1 ? doc.length : nl + 1,
        };
      }
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  // An unclosed fence runs to the end of the document (CommonMark) — a
  // block still being typed is checked too.
  if (open && TS_LANGS.has(open.lang) && open.codeFrom <= doc.length) {
    out.push({
      id: `block-${out.length}`,
      tsx: open.lang === "tsx",
      from: open.codeFrom,
      to: doc.length,
      code: doc.slice(open.codeFrom),
    });
  }
  return out;
}

/** The block containing document offset `pos` (inclusive end), or null. */
export function blockAt(blocks: readonly TsBlock[], pos: number): TsBlock | null {
  return blocks.find((b) => pos >= b.from && pos <= b.to) ?? null;
}
