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
// Info string: a backtick fence's may not contain backticks (CommonMark);
// a tilde fence's may.
const OPEN_RE = /^ {0,3}(?:(`{3,})\s*([^\s`]*)([^`]*)|(~{3,})\s*(\S*)(.*))$/;
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
      if (m) {
        const fence = m[1] ?? m[4];
        open = {
          char: fence[0],
          len: fence.length,
          lang: (m[2] ?? m[5] ?? "").toLowerCase(),
          meta: (m[1] ? m[3] : m[6]) ?? "",
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
 *    renamed in the earlier parts, so references use the newest
 *    declaration's type, as the runtime replaces the value;
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
  const lead = LEADING_COMMENTS_RE.exec(code)?.[0] ?? "";
  return /@ts-check\b/.test(lead) && !/@ts-nocheck\b/.test(lead);
}

/** The leading comments of a block (where TypeScript reads file directives). */
const LEADING_COMMENTS_RE = /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/;

/** Neutralise `@ts-check` / `@ts-nocheck` in the leading comments only. */
function neutraliseDirectives(code: string): string {
  const lead = LEADING_COMMENTS_RE.exec(code)?.[0] ?? "";
  if (!lead) return code;
  return lead.replace(/@ts-(no)?check\b/g, (m) => "@ts-" + "_".repeat(m.length - 4)) + code.slice(lead.length);
}

/** Words before `(` that make the following `{` a statement block, not a function body. */
const BLOCK_HEADS = new Set(["if", "while", "for", "with", "switch", "catch"]);
/** Words that may precede a method name in an object literal or class body. */
const METHOD_PREFIXES = new Set(["get", "set", "static", "async"]);

/**
 * Rewrite an EARLIER part of a shared unit for the state a later block
 * sees, renaming the bindings in `names` (name → stand-in) where they are
 * evaluated immediately:
 *
 *  - references at top level (and in nested statement blocks) are
 *    renamed: they read the value of that time;
 *  - references inside function, method and arrow bodies are NOT: those
 *    run later and, like the runtime (shared names live on the global
 *    object), see the newest declaration;
 *  - property accesses (`o.name`), object keys (`{ name: 1 }`) and method
 *    names (`{ name() {} }`, `get name()`) keep their name; a shorthand
 *    `{ name }` keeps its key and remaps only its value.
 *
 * Earlier parts are never mapped back to the document, so lengths may change.
 */
function rewriteEarlierPart(code: string, names: ReadonlyMap<string, string>): string {
  const src = neutraliseDirectives(code);
  if (names.size === 0) return src;
  const tokens = tokenize(src);
  const edits: Array<{ from: number; to: number; text: string }> = [];
  // One frame per open bracket: its char and whether it starts a function body.
  const frames: Array<{ ch: string; fn: boolean }> = [];
  // Matching `(` index for each open paren, to classify the `{` after `)`.
  const parenOpen: number[] = [];
  const closedParenOpener = new Map<number, number>();
  // Arrow bodies without braces: function scope until the expression ends.
  const arrowExprDepths: number[] = [];
  const inFunction = () => frames.some((f) => f.fn) || arrowExprDepths.length > 0;

  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    if (tok.type === "punct") {
      const v = tok.value;
      if (v === "(" || v === "[") {
        if (v === "(") parenOpen.push(k);
        frames.push({ ch: v, fn: false });
      } else if (v === "{") {
        let fn = false;
        if (prev?.type === "punct" && prev.value === "=>") fn = true;
        else if (prev?.type === "punct" && prev.value === ")") {
          const open = closedParenOpener.get(k - 1);
          const head = open !== undefined ? tokens[open - 1] : undefined;
          const headWord = head?.type === "ident" ? head.value : "";
          fn = !(BLOCK_HEADS.has(headWord) || (headWord === "await" && tokens[open! - 2]?.value === "for"));
        }
        frames.push({ ch: v, fn });
      } else if (v === ")" || v === "]" || v === "}") {
        if (v === ")") {
          const open = parenOpen.pop();
          if (open !== undefined) closedParenOpener.set(k, open);
        }
        frames.pop();
        while (arrowExprDepths.length && frames.length < arrowExprDepths[arrowExprDepths.length - 1]) arrowExprDepths.pop();
      } else if (v === "=>" && !(next?.type === "punct" && next.value === "{")) {
        arrowExprDepths.push(frames.length);
      } else if ((v === "," || v === ";") && arrowExprDepths.length && frames.length === arrowExprDepths[arrowExprDepths.length - 1]) {
        arrowExprDepths.pop();
      }
      continue;
    }
    if (tok.type !== "ident") continue;
    const to = names.get(tok.value);
    if (!to) continue;
    const prevP = prev?.type === "punct" ? prev.value : "";
    const nextP = next?.type === "punct" ? next.value : "";
    if (prevP === "." || prevP === "?.") continue;
    const inBraces = frames[frames.length - 1]?.ch === "{";
    const keyPos =
      inBraces &&
      (prevP === "{" || prevP === "," || prevP === ";" || prevP === "}" || prevP === "*" ||
        (prev?.type === "ident" && METHOD_PREFIXES.has(prev.value)));
    if (keyPos && (nextP === ":" || nextP === "(")) continue; // `{ name: … }`, `{ name() {} }`
    if (inFunction()) continue; // late-bound: sees the newest declaration
    const shorthand = keyPos && (nextP === "}" || nextP === "," || nextP === "=");
    edits.push({ from: tok.start, to: tok.end, text: shorthand ? `${tok.value}: ${to}` : to });
  }
  let out = src;
  for (let e = edits.length - 1; e >= 0; e--) out = out.slice(0, edits[e].from) + edits[e].text + out.slice(edits[e].to);
  return out;
}

function sharedUnit(scope: readonly TsBlock[], k: number): TsUnit {
  const own = scope[k];
  // For each name: the last part (≤ k) that declares it.
  const lastDecl = new Map<string, number>();
  const declared = scope.slice(0, k + 1).map((b) => topLevelNames(b.code));
  declared.forEach((names, i) => names.forEach((n) => lastDecl.set(n, i)));
  // Stand-ins for superseded bindings: `name$prev`, unique against every
  // identifier in the unit's parts (nested bindings included).
  const allIdents = new Set<string>();
  for (const b of scope.slice(0, k + 1)) for (const t of tokenize(b.code)) if (t.type === "ident") allIdents.add(t.value);
  const mangled = new Map<string, string>();
  const standIn = (name: string): string => {
    let m = mangled.get(name);
    if (!m) {
      m = `${name}$prev`;
      for (let n = 2; allIdents.has(m) || [...mangled.values()].includes(m); n++) m = `${name}$prev${n}`;
      mangled.set(name, m);
    }
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
