/**
 * TypeScript code blocks in a Markdown document — the units the in-editor
 * type checker analyses (see ./tsService and ../editor/tsCheckExtension).
 * Pure: no DOM, no TypeScript import.
 */

export interface TsBlock {
  /** Stable per position in the document: `block-<n>`. */
  id: string;
  /** `.tsx` / `.jsx` blocks allow JSX. */
  tsx: boolean;
  /** JavaScript (```js / ```live-js): syntax always, types with `// @ts-check`. */
  js: boolean;
  /** `live-js shared[=name]` blocks share one global scope per name. */
  scope: string | null;
  /** Offset of the first code character in the document. */
  from: number;
  /** Offset just past the last code character. */
  to: number;
  code: string;
}

const TS_LANGS = new Set(["ts", "typescript", "mts", "cts", "tsx"]);
const JS_LANGS = new Set(["js", "javascript", "mjs", "cjs", "jsx", "live-js"]);
const OPEN_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)([^`]*)$/;
const SHARED_RE = /(?:^|\s)shared(?:=([\w-]+))?(?=\s|$)/;

/** Fenced ```ts / ```typescript / ```tsx blocks, in document order. */
export function findTsBlocks(doc: string): TsBlock[] {
  const out: TsBlock[] = [];
  let pos = 0;
  let open: { char: string; len: number; lang: string; meta: string; codeFrom: number } | null = null;
  while (pos <= doc.length) {
    const nl = doc.indexOf("\n", pos);
    const end = nl === -1 ? doc.length : nl;
    const line = doc.slice(pos, end);
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === open.char && close[1].length >= open.len) {
        const js = JS_LANGS.has(open.lang);
        if (TS_LANGS.has(open.lang) || js) {
          // Code ends before the newline that precedes the closing fence.
          const to = Math.max(open.codeFrom, pos - 1);
          const shared = open.lang === "live-js" ? SHARED_RE.exec(open.meta) : null;
          out.push({
            id: `block-${out.length}`,
            tsx: open.lang === "tsx" || open.lang === "jsx",
            js,
            scope: shared ? (shared[1] ?? "default") : null,
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
          meta: m[3] ?? "",
          codeFrom: nl === -1 ? doc.length : nl + 1,
        };
      }
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  return out;
}

/** The block containing document offset `pos` (inclusive end), or null. */
export function blockAt(blocks: readonly TsBlock[], pos: number): TsBlock | null {
  return blocks.find((b) => pos >= b.from && pos <= b.to) ?? null;
}

/**
 * A file the language service checks: one block, or every `live-js shared`
 * block of one scope concatenated (so later blocks see earlier
 * declarations, as at run time). `parts` maps file offsets back to blocks.
 */
export interface TsUnit {
  id: string;
  code: string;
  tsx: boolean;
  js: boolean;
  shared: boolean;
  parts: Array<{ block: TsBlock; offset: number }>;
}

export function toUnits(blocks: readonly TsBlock[]): TsUnit[] {
  const units: TsUnit[] = [];
  const scopes = new Map<string, TsUnit>();
  for (const b of blocks) {
    if (!b.scope) {
      units.push({ id: b.id, code: b.code, tsx: b.tsx, js: b.js, shared: false, parts: [{ block: b, offset: 0 }] });
      continue;
    }
    let u = scopes.get(b.scope);
    if (!u) {
      u = { id: `scope-${b.scope}`, code: "", tsx: false, js: true, shared: true, parts: [] };
      scopes.set(b.scope, u);
      units.push(u);
    } else {
      u.code += "\n";
    }
    u.parts.push({ block: b, offset: u.code.length });
    u.code += b.code;
  }
  return units;
}

/** Document range of a unit-relative range (clamped to its block), or null. */
export function unitRangeToDoc(
  unit: TsUnit,
  start: number,
  length: number,
): { from: number; to: number } | null {
  for (let i = unit.parts.length - 1; i >= 0; i--) {
    const { block, offset } = unit.parts[i];
    if (start >= offset && start <= offset + block.code.length) {
      const from = block.from + (start - offset);
      const to = Math.min(from + Math.max(length, 1), block.to);
      return to > from ? { from, to } : { from, to: Math.min(from + 1, block.to + 1) };
    }
  }
  return null;
}

/** The unit and unit-relative offset for a document position, or null. */
export function unitAt(units: readonly TsUnit[], pos: number): { unit: TsUnit; offset: number } | null {
  for (const unit of units) {
    for (const { block, offset } of unit.parts) {
      if (pos >= block.from && pos <= block.to) return { unit, offset: offset + (pos - block.from) };
    }
  }
  return null;
}
