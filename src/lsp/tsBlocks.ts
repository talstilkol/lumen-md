/**
 * TypeScript code blocks in a Markdown document — the units the in-editor
 * type checker analyses (see ./tsService and ../editor/tsCheckExtension).
 * Pure: no DOM, no TypeScript import.
 */
import { tokenize, topLevelNames } from "../plugins/liveJsScope";

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
const JS_LANGS = new Set(["js", "javascript", "mjs", "cjs", "jsx", "live-js", "js-live"]);
/** Fences that run as live-js (and so accept `shared`). */
const LIVE_JS_LANGS = new Set(["live-js", "js-live"]);
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
          const shared = LIVE_JS_LANGS.has(open.lang) ? SHARED_RE.exec(open.meta) : null;
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
  // An unclosed fence runs to the end of the document (CommonMark) — a
  // block still being typed is checked too.
  if (open && (TS_LANGS.has(open.lang) || JS_LANGS.has(open.lang)) && open.codeFrom <= doc.length) {
    const shared = LIVE_JS_LANGS.has(open.lang) ? SHARED_RE.exec(open.meta) : null;
    out.push({
      id: `block-${out.length}`,
      tsx: open.lang === "tsx" || open.lang === "jsx",
      js: JS_LANGS.has(open.lang),
      scope: shared ? (shared[1] ?? "default") : null,
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

/**
 * A file the language service checks. A plain block is its own unit. A
 * `live-js shared` block is checked in a unit made of every EARLIER block
 * of its scope followed by itself — the state it sees at run time:
 *
 *  - later blocks are not part of it, so their declarations are invisible
 *    (running this block first would throw a ReferenceError too);
 *  - parts are joined with a statement boundary (`;`), as each block is a
 *    separate run — semicolonless code can't merge across blocks;
 *  - a name an earlier block declares and a later one re-declares is
 *    renamed (same length) in the earlier parts, so references use the
 *    newest declaration's type, as the runtime replaces the value;
 *  - only the unit's own block decides `// @ts-check`: directives in the
 *    earlier parts are neutralised and the unit gets its own header.
 *
 * Diagnostics, hover and completion only use the unit's own (last) part;
 * `parts` maps file offsets back to blocks.
 */
export interface TsUnit {
  id: string;
  code: string;
  tsx: boolean;
  js: boolean;
  shared: boolean;
  parts: Array<{ block: TsBlock; offset: number }>;
}

/** Joins the parts of a shared unit: ends any statement / line comment. */
const PART_SEPARATOR = "\n;\n";
const CHECK_HEADER = "// @ts-check\n";

/** Does the block opt into type checking (`// @ts-check` in its leading comments)? */
export function hasTsCheck(code: string): boolean {
  const lead = /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/.exec(code)?.[0] ?? "";
  return /@ts-check\b/.test(lead) && !/@ts-nocheck\b/.test(lead);
}

/** Same-length stand-ins for renamed identifiers (Hebrew letters: valid ID_Start). */
const MANGLE_PREFIXES = Array.from({ length: 27 }, (_, i) => String.fromCharCode(0x05d0 + i));

/**
 * Rename `names` (map: name → stand-in of the same length) in JS `code`,
 * skipping property accesses (`o.name`) and object-literal keys
 * (`{ name: 1 }`), and neutralise `@ts-check` / `@ts-nocheck` directives.
 */
function rewriteEarlierPart(code: string, names: ReadonlyMap<string, string>): string {
  let out = code.replace(/@ts-(no)?check\b/g, (m) => "@ts-" + "_".repeat(m.length - 4));
  if (names.size === 0) return out;
  const tokens = tokenize(code);
  const chars = out.split("");
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.type !== "ident") continue;
    const to = names.get(tok.value);
    if (!to) continue;
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    if (prev?.type === "punct" && (prev.value === "." || prev.value === "?.")) continue;
    if (next?.type === "punct" && next.value === ":" && prev?.type === "punct" && (prev.value === "{" || prev.value === ",")) continue;
    for (let c = 0; c < to.length; c++) chars[tok.start + c] = to[c];
  }
  out = chars.join("");
  return out;
}

function sharedUnit(scope: readonly TsBlock[], k: number): TsUnit {
  const own = scope[k];
  // For each name: the last part (≤ k) that declares it.
  const lastDecl = new Map<string, number>();
  const declared = scope.slice(0, k + 1).map((b) => topLevelNames(b.code));
  declared.forEach((names, i) => names.forEach((n) => lastDecl.set(n, i)));
  const used = new Set<string>();
  const mangled = new Map<string, string>();
  const standIn = (name: string): string => {
    let m = mangled.get(name);
    if (m) return m;
    for (const p of MANGLE_PREFIXES) {
      const cand = p + name.slice(1);
      if (!used.has(cand) && !lastDecl.has(cand)) {
        m = cand;
        break;
      }
    }
    m ??= MANGLE_PREFIXES[0] + name.slice(1);
    used.add(m);
    mangled.set(name, m);
    return m;
  };

  let code = hasTsCheck(own.code) ? CHECK_HEADER : "";
  const parts: TsUnit["parts"] = [];
  for (let i = 0; i <= k; i++) {
    const b = scope[i];
    if (i > 0) code += PART_SEPARATOR;
    let text = b.code;
    if (i < k) {
      const rename = new Map<string, string>();
      for (const [n, at] of lastDecl) if (at > i) rename.set(n, standIn(n));
      text = rewriteEarlierPart(b.code, rename);
    }
    parts.push({ block: b, offset: code.length });
    code += text;
  }
  return { id: own.id, code, tsx: false, js: true, shared: true, parts };
}

export function toUnits(blocks: readonly TsBlock[]): TsUnit[] {
  const units: TsUnit[] = [];
  const scopes = new Map<string, TsBlock[]>();
  for (const b of blocks) {
    if (!b.scope) {
      units.push({ id: b.id, code: b.code, tsx: b.tsx, js: b.js, shared: false, parts: [{ block: b, offset: 0 }] });
      continue;
    }
    let scope = scopes.get(b.scope);
    if (!scope) scopes.set(b.scope, (scope = []));
    scope.push(b);
    units.push(sharedUnit(scope, scope.length - 1));
  }
  return units;
}

/** The unit's own block (the one its diagnostics and positions belong to). */
export function ownPart(unit: TsUnit): { block: TsBlock; offset: number } {
  return unit.parts[unit.parts.length - 1];
}

/**
 * Document range of a unit-relative range in the unit's own block
 * (clamped to it), or null when it lies in an earlier part.
 */
export function unitRangeToDoc(
  unit: TsUnit,
  start: number,
  length: number,
): { from: number; to: number } | null {
  const { block, offset } = ownPart(unit);
  if (start < offset || start > offset + block.code.length) return null;
  const from = block.from + (start - offset);
  const to = Math.min(from + Math.max(length, 1), block.to);
  return to > from ? { from, to } : { from, to: Math.min(from + 1, block.to + 1) };
}

/** The unit and unit-relative offset for a document position, or null. */
export function unitAt(units: readonly TsUnit[], pos: number): { unit: TsUnit; offset: number } | null {
  for (const unit of units) {
    const { block, offset } = ownPart(unit);
    if (pos >= block.from && pos <= block.to) return { unit, offset: offset + (pos - block.from) };
  }
  return null;
}
