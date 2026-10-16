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
  /** A ```live-js block: it runs inside an async function (top-level `return` / `await`). */
  live: boolean;
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
            live: LIVE_JS_LANGS.has(open.lang),
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
      live: LIVE_JS_LANGS.has(open.lang),
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

/**
 * live-js runs a block inside an async function, so a top-level `return`
 * or `await` is valid there: the unit's own block is checked the same way.
 * (Plain ```js fences stay modules.)
 */
const LIVE_WRAP_OPEN = "(async () => {\n";
const LIVE_WRAP_CLOSE = "\n})();";

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

interface FnScope {
  /** Token range [from, to] covering parameters and body. */
  from: number;
  to: number;
  /**
   * Retained closure (declared, assigned, a method, returned): it runs
   * later, so it sees the newest declaration. Otherwise it is passed as an
   * argument or invoked in place (IIFE, `.map(x => …)`): it runs while the
   * block is evaluated and sees that time's value.
   */
  retained: boolean;
  /** Names bound inside it: parameters, its own name, local declarations. */
  locals: Set<string>;
}

/** Index of the matching bracket for every `(`, `[`, `{` and its closer. */
function matchBrackets(tokens: ReturnType<typeof tokenize>): Map<number, number> {
  const match = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((t, i) => {
    if (t.type !== "punct") return;
    if (t.value === "(" || t.value === "[" || t.value === "{") stack.push(i);
    else if (t.value === ")" || t.value === "]" || t.value === "}") {
      const open = stack.pop();
      if (open !== undefined) {
        match.set(open, i);
        match.set(i, open);
      }
    }
  });
  return match;
}

/** Find function scopes (functions, arrows, methods) in a token list. */
function functionScopes(tokens: ReturnType<typeof tokenize>, match: Map<number, number>): FnScope[] {
  const scopes: FnScope[] = [];
  const val = (i: number) => (tokens[i]?.type === "punct" || tokens[i]?.type === "ident" ? tokens[i].value : "");
  const isPunct = (i: number, v: string) => tokens[i]?.type === "punct" && tokens[i].value === v;
  /** Retained unless the function sits in argument / IIFE position. */
  const retainedAt = (before: number) => {
    let c = before;
    if (val(c) === "async") c--;
    return !(isPunct(c, "(") || isPunct(c, ","));
  };
  /** Locals: identifiers bound in the params and declared in the body. */
  const collectLocals = (paramsFrom: number, paramsTo: number, bodyFrom: number, bodyTo: number, own?: string) => {
    const locals = new Set<string>();
    if (own) locals.add(own);
    for (let i = paramsFrom; i <= paramsTo; i++) {
      const t = tokens[i];
      if (t?.type !== "ident") continue;
      if (isPunct(i - 1, ".") || (isPunct(i + 1, ":") && (isPunct(i - 1, "{") || isPunct(i - 1, ",")))) continue;
      locals.add(t.value);
    }
    for (let i = bodyFrom; i <= bodyTo; i++) {
      const v = val(i);
      if ((v === "const" || v === "let" || v === "var") && tokens[i].type === "ident") {
        // `const a`, `const { a, b: c }`, `const [d, e]`
        let j = i + 1;
        if (tokens[j]?.type === "ident") locals.add(tokens[j].value);
        else if (isPunct(j, "{") || isPunct(j, "[")) {
          const close = match.get(j) ?? j;
          for (let m = j + 1; m < close; m++) {
            if (tokens[m]?.type !== "ident") continue;
            if (isPunct(m + 1, ":")) continue; // property key, not a binding
            if (isPunct(m - 1, "=")) continue; // default value (approximation)
            locals.add(tokens[m].value);
          }
        }
      } else if ((v === "function" || v === "class") && tokens[i + 1]?.type === "ident") {
        locals.add(tokens[i + 1].value);
      }
    }
    return locals;
  };

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    // function [*] [name] ( … ) { … }
    if (t.type === "ident" && t.value === "function") {
      let p = k + 1;
      if (isPunct(p, "*")) p++;
      const own = tokens[p]?.type === "ident" ? tokens[p].value : undefined;
      if (own) p++;
      if (!isPunct(p, "(")) continue;
      const q = match.get(p);
      if (q === undefined || !isPunct(q + 1, "{")) continue;
      const end = match.get(q + 1) ?? tokens.length - 1;
      scopes.push({ from: p, to: end, retained: retainedAt(k - 1), locals: collectLocals(p, q, q + 1, end, own) });
      continue;
    }
    // ( … ) => …   /   x => …
    if (t.type === "punct" && t.value === "=>") {
      let pFrom = k - 1;
      let pTo = k - 1;
      if (isPunct(k - 1, ")")) pFrom = match.get(k - 1) ?? k - 1;
      else if (tokens[k - 1]?.type !== "ident") continue;
      let end: number;
      if (isPunct(k + 1, "{")) end = match.get(k + 1) ?? tokens.length - 1;
      else {
        // Expression body: up to a `,` / `;` at this level or the enclosing closer.
        end = k + 1;
        for (let i = k + 1; i < tokens.length; i++) {
          const v = tokens[i].type === "punct" ? tokens[i].value : "";
          if (v === "(" || v === "[" || v === "{") {
            i = match.get(i) ?? i;
            end = i;
            continue;
          }
          if (v === "," || v === ";" || v === ")" || v === "]" || v === "}") break;
          end = i;
        }
      }
      scopes.push({ from: pFrom, to: end, retained: retainedAt(pFrom - 1), locals: collectLocals(pFrom, pTo, k + 1, end) });
      continue;
    }
    // Method: name ( … ) { … } in an object literal or class body.
    if (t.type === "ident" && isPunct(k + 1, "(")) {
      const q = match.get(k + 1);
      if (q === undefined || !isPunct(q + 1, "{")) continue;
      const prev = val(k - 1);
      const keyPos = prev === "{" || prev === "," || prev === ";" || prev === "}" || prev === "*" || METHOD_PREFIXES.has(prev);
      if (!keyPos || BLOCK_HEADS.has(t.value) || t.value === "function") continue;
      const end = match.get(q + 1) ?? tokens.length - 1;
      scopes.push({ from: k + 1, to: end, retained: true, locals: collectLocals(k + 1, q, q + 1, end) });
    }
  }
  return scopes;
}

/**
 * Rewrite an EARLIER part of a shared unit for the state a later block
 * sees, renaming the bindings in `names` (name → stand-in) where they are
 * evaluated while that block ran:
 *
 *  - at top level, in statement blocks, and inside functions that run
 *    right away (IIFEs, callbacks passed as arguments) → renamed: they
 *    read the value of that time;
 *  - inside retained closures (declared or assigned functions, methods,
 *    returned arrows) → kept: they run later and, like the runtime
 *    (shared names live on the global object), see the newest declaration;
 *  - names a function binds itself (parameters, its own name, local
 *    declarations) → kept, with their references;
 *  - property accesses (`o.name`), object keys (`{ name: 1 }`) and method
 *    names keep their name; a shorthand `{ name }` keeps its key and
 *    remaps only its value.
 *
 * Earlier parts are never mapped back to the document, so lengths may change.
 */
function rewriteEarlierPart(code: string, names: ReadonlyMap<string, string>): string {
  const src = neutraliseDirectives(code);
  if (names.size === 0) return src;
  const tokens = tokenize(src);
  const match = matchBrackets(tokens);
  const scopes = functionScopes(tokens, match);
  const edits: Array<{ from: number; to: number; text: string }> = [];
  const brackets: string[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.type === "punct") {
      if (tok.value === "{" || tok.value === "[" || tok.value === "(") brackets.push(tok.value);
      else if (tok.value === "}" || tok.value === "]" || tok.value === ")") brackets.pop();
      continue;
    }
    if (tok.type !== "ident") continue;
    const to = names.get(tok.value);
    if (!to) continue;
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    const prevP = prev?.type === "punct" ? prev.value : "";
    const nextP = next?.type === "punct" ? next.value : "";
    if (prevP === "." || prevP === "?.") continue;
    const inBraces = brackets[brackets.length - 1] === "{";
    const keyPos =
      inBraces &&
      (prevP === "{" || prevP === "," || prevP === ";" || prevP === "}" || prevP === "*" ||
        (prev?.type === "ident" && METHOD_PREFIXES.has(prev.value)));
    if (keyPos && (nextP === ":" || nextP === "(")) continue; // `{ name: … }`, `{ name() {} }`
    // A named function EXPRESSION's own name is local to it (a function
    // declaration's name is the shared binding itself).
    if (prev?.type === "ident" && prev.value === "function") {
      let c = k - 2;
      if (tokens[c]?.type === "ident" && tokens[c].value === "async") c--;
      const ctx = tokens[c];
      if (ctx && ((ctx.type === "punct" && ["=", ":", "(", ",", "?", "||", "&&", "??"].includes(ctx.value)) || (ctx.type === "ident" && ctx.value === "return"))) continue;
    }
    // Enclosing functions, innermost first.
    const enclosing = scopes.filter((f) => k >= f.from && k <= f.to).sort((x, y) => (y.from - x.from) || (x.to - y.to));
    if (enclosing.some((f) => f.locals.has(tok.value))) continue; // a local binding
    if (enclosing.some((f) => f.retained)) continue; // late-bound closure
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
    if (i === k && b.live) code += LIVE_WRAP_OPEN;
    parts.push({ block: b, offset: code.length });
    code += text;
    if (i === k && b.live) code += LIVE_WRAP_CLOSE;
  }
  return { id: own.id, code, tsx: false, js: true, shared: true, parts };
}

export function toUnits(blocks: readonly TsBlock[]): TsUnit[] {
  const units: TsUnit[] = [];
  const scopes = new Map<string, TsBlock[]>();
  for (const b of blocks) {
    if (!b.scope) {
      // The wrapper would push `// @ts-check` out of the leading comments.
      const open = b.live ? (hasTsCheck(b.code) ? CHECK_HEADER : "") + LIVE_WRAP_OPEN : "";
      const code = b.live ? open + b.code + LIVE_WRAP_CLOSE : b.code;
      units.push({ id: b.id, code, tsx: b.tsx, js: b.js, shared: false, parts: [{ block: b, offset: open.length }] });
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
