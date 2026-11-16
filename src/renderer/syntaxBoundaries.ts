/**
 * Two refinements of the syntax Lumen reads (part of the `markdownSyntax`
 * preset, ./syntax.ts), both about where an extension may start:
 *
 *  - A text directive (`:name`, remark-directive) must not follow a letter
 *    or digit. Prose such as `Re:subject` or `Note:important` stays text;
 *    before this, the word after the colon became an empty directive and
 *    vanished from the preview (CommonMark example 609, GFM 617: `<m:abc>`).
 *  - A GFM autolink literal is never formed across a backslash escape (or a
 *    character reference): the writer escaped the character to keep it
 *    literal (CommonMark 606, GFM 614: `<foo\+@bar.example.com>` is text in
 *    cmark-gfm too). Needs the source; without it the link stays.
 *
 * A directive becomes the exact source it came from (or, when the
 * processor was run without the source, its name and label); a link becomes
 * its text.
 */
import type { Root as MdastRoot } from "mdast";

interface Node {
  type: string;
  name?: string;
  value?: string;
  url?: string;
  children?: Node[];
  attributes?: Record<string, string | null | undefined> | null;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const WORD = /[\p{L}\p{N}]$/u;

function textOf(n: Node): string {
  if (typeof n.value === "string") return n.value;
  return (n.children ?? []).map(textOf).join("");
}

function sourceOf(n: Node, src: string): string | null {
  const s = n.position?.start.offset;
  const e = n.position?.end.offset;
  return src && s !== undefined && e !== undefined ? src.slice(s, e) : null;
}

/** The text before `n` in its parent: the source when known, else the previous sibling's text. */
function before(parent: Node, i: number, n: Node, src: string): string {
  const s = n.position?.start.offset;
  if (src && s !== undefined) return src.slice(Math.max(0, s - 1), s);
  const prev = parent.children?.[i - 1];
  return prev ? textOf(prev) : "";
}

/**
 * A link GFM made from a bare URL or email address. mdast-util-gfm-autolink-literal
 * finds them in the text nodes after parsing, so they carry no position; a
 * written link (`<…>`, `[…](…)`) always has one.
 */
function literalAutolink(n: Node): boolean {
  if (n.type !== "link" || n.position) return false;
  const text = textOf(n);
  const url = n.url ?? "";
  return url === text || url === `mailto:${text}` || url === `http://${text}`;
}

function rewrite(parent: Node, src: string, block = ""): void {
  const kids = parent.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.type === "textDirective" && WORD.test(before(parent, i, n, src))) {
      const raw = sourceOf(n, src);
      kids[i] = { type: "text", value: raw ?? `:${n.name ?? ""}${textOf(n) ? `[${textOf(n)}]` : ""}`, position: n.position };
      continue;
    }
    // The address is not in the block's source as written: an escape (or a character reference) split it.
    if (literalAutolink(n) && block && !block.includes(textOf(n))) {
      kids[i] = { type: "text", value: textOf(n) };
      continue;
    }
    rewrite(n, src, sourceOf(n, src) ?? block);
  }
}

export function remarkSyntaxBoundaries() {
  return (tree: MdastRoot, file?: { value?: unknown }) => {
    const v = file?.value;
    const src = typeof v === "string" ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : "";
    rewrite(tree as unknown as Node, src);
  };
}
