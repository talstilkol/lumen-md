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

/** Does the `{` at `i` open a class body (`class X [extends Y] {`)? */
function isClassBody(tokens: ReturnType<typeof tokenize>, i: number): boolean {
  for (let j = i - 1, depth = 0; j >= 0 && i - j < 64; j--) {
    const t = tokens[j];
    if (t.type === "punct") {
      if (t.value === ")" || t.value === "]") depth++;
      else if (t.value === "(" || t.value === "[") depth--;
      else if (depth === 0 && (t.value === ";" || t.value === "{" || t.value === "}" || t.value === "=>")) return false;
      continue;
    }
    if (depth === 0 && t.type === "ident" && t.value === "class") return true;
  }
  return false;
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

/** Callees that invoke their callback argument before returning. */
const SYNC_CALLBACK_METHODS = new Set([
  "map", "filter", "forEach", "reduce", "reduceRight", "some", "every", "find", "findIndex",
  "findLast", "findLastIndex", "flatMap", "sort", "toSorted", "from", "replace", "replaceAll",
  "groupBy", "fromEntries",
]);

/** Find function scopes (functions, arrows, methods) in a token list. */
function functionScopes(tokens: ReturnType<typeof tokenize>, match: Map<number, number>): FnScope[] {
  const scopes: FnScope[] = [];
  const pending: Array<() => FnScope> = [];
  const val = (i: number) => (tokens[i]?.type === "punct" || tokens[i]?.type === "ident" ? tokens[i].value : "");
  const isPunct = (i: number, v: string) => tokens[i]?.type === "punct" && tokens[i].value === v;
  /** Retained unless the function sits in argument / IIFE position. */
  const CALLEE_END = new Set([")", "]"]);
  const NOT_CALLEE = new Set(["return", "typeof", "void", "delete", "await", "yield", "in", "of", "new", "case", "else", "do"]);
  /**
   * A callback passed to the call whose `(` is at `open`: run now only when
   * the callee is known to call it synchronously (array / string helpers,
   * `new Promise(executor)`); anything else may keep it for later
   * (`callbacks.push(fn)`, `setTimeout`, event listeners, `.then`).
   */
  const callbackRetained = (open: number): boolean => {
    const callee = tokens[open - 1];
    if (callee?.type !== "ident") return true;
    if (callee.value === "Promise" && val(open - 2) === "new") return false;
    if (!SYNC_CALLBACK_METHODS.has(callee.value) || !isPunct(open - 2, ".")) return true;
    // Only when the receiver is known to be the built-in: an array literal
    // (`[…].map`), a string literal (`"…".replace`), `Array.from`,
    // `Object.fromEntries` / `Object.groupBy`. A user's own `holder.map`
    // may keep the callback.
    const recv = tokens[open - 3];
    if (!recv) return true;
    if (recv.type === "str" || recv.type === "tpl") return !(callee.value === "replace" || callee.value === "replaceAll");
    if (recv.type === "ident") {
      if (recv.value === "Array") return callee.value !== "from";
      if (recv.value === "Object") return !(callee.value === "fromEntries" || callee.value === "groupBy");
      return true;
    }
    if (isPunct(open - 3, "]")) {
      const lit = match.get(open - 3);
      const before = lit !== undefined ? tokens[lit - 1] : undefined;
      // `[…]` is a literal unless it indexes something (`a[0]`, `f()[0]`).
      const indexes = before && (before.type === "ident" || (before.type === "punct" && CALLEE_END.has(before.value)));
      return !!indexes;
    }
    return true;
  };
  const retainedAt = (before: number): boolean => {
    let c = before;
    if (val(c) === "async") c--;
    if (isPunct(c, ",")) {
      // A later argument: find the call's `(` and classify like the first.
      // A later argument (or array / object item): find the enclosing opener.
      let open = c - 1;
      while (open >= 0) {
        if ((isPunct(open, "(") || isPunct(open, "[") || isPunct(open, "{")) && (match.get(open) ?? -1) > c) break;
        open = isPunct(open, ")") || isPunct(open, "]") || isPunct(open, "}") ? (match.get(open) ?? open) - 1 : open - 1;
      }
      if (!isPunct(open, "(")) return true; // array / object item: kept for later
      const callee = tokens[open - 1];
      const isCall = callee && ((callee.type === "ident" && !NOT_CALLEE.has(callee.value)) || (callee.type === "punct" && CALLEE_END.has(callee.value)));
      return isCall ? callbackRetained(open) : true;
    }
    if (!isPunct(c, "(")) return true;
    // `( … )(…)`: an IIFE runs now.
    const close = match.get(c);
    if (close !== undefined && isPunct(close + 1, "(")) return false;
    const t = tokens[c - 1];
    if (t && ((t.type === "ident" && !NOT_CALLEE.has(t.value)) || (t.type === "punct" && CALLEE_END.has(t.value)))) {
      return callbackRetained(c);
    }
    // A grouping parenthesis: classify by what the group sits in.
    return retainedAt(c - 1);
  };
  /** Function bodies [open, close] (to skip nested function scopes). */
  const fnBodies: Array<[number, number]> = [];
  /**
   * Names declared in the block whose braces are [from, to]: let / const /
   * class / function at its own level; with `fnLevel`, also `var` anywhere
   * inside (hoisted to the function), but never inside nested functions.
   */
  const addDeclarations = (into: Set<string>, from: number, to: number, fnLevel: boolean) => {
    let depth = 0;
    for (let i = from + 1; i < to; i++) {
      const t = tokens[i];
      if (t.type === "punct") {
        if (t.value === "{" || t.value === "(" || t.value === "[") {
          const nested = fnBodies.find(([a]) => a === i);
          if (nested) {
            i = nested[1];
            continue;
          }
          depth++;
        } else if (t.value === "}" || t.value === ")" || t.value === "]") depth--;
        continue;
      }
      const v = t.type === "ident" ? t.value : "";
      const here = depth === 0;
      if ((v === "const" || v === "let") && !here) continue;
      if (v === "var" && !fnLevel && !here) continue;
      if (v === "const" || v === "let" || v === "var") {
        const j = i + 1;
        if (tokens[j]?.type === "ident") into.add(tokens[j].value);
        else if (isPunct(j, "{") || isPunct(j, "[")) {
          const close = match.get(j) ?? j;
          for (let m = j + 1; m < close; m++) {
            if (tokens[m]?.type !== "ident") continue;
            if (isPunct(m + 1, ":")) continue; // property key, not a binding
            if (isPunct(m - 1, "=")) continue; // default value (approximation)
            into.add(tokens[m].value);
          }
        }
      } else if (here && (v === "function" || v === "class") && tokens[i + 1]?.type === "ident") {
        into.add(tokens[i + 1].value);
      }
    }
  };
  /** Locals: identifiers bound in the params and declared in the body. */
  const collectLocals = (paramsFrom: number, paramsTo: number, bodyFrom: number, bodyTo: number, own?: string) => {
    const locals = new Set<string>();
    if (own) locals.add(own);
    for (let i = paramsFrom; i <= paramsTo; i++) {
      const t = tokens[i];
      // `x = value`: the default expression references, it doesn't bind.
      if (isPunct(i, "=")) {
        let depth = 0;
        for (i++; i <= paramsTo; i++) {
          const v = tokens[i].type === "punct" ? tokens[i].value : "";
          if (v === "(" || v === "[" || v === "{") depth++;
          else if (v === ")" || v === "]" || v === "}") {
            if (depth === 0) break;
            depth--;
          } else if (v === "," && depth === 0) break;
        }
        continue;
      }
      if (t?.type !== "ident") continue;
      if (isPunct(i - 1, ".") || (isPunct(i + 1, ":") && (isPunct(i - 1, "{") || isPunct(i - 1, ",")))) continue;
      locals.add(t.value);
    }
    addDeclarations(locals, bodyFrom, bodyTo, true);
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
      fnBodies.push([q + 1, end]);
      pending.push(() => ({ from: p, to: end, retained: retainedAt(k - 1), locals: collectLocals(p, q, q + 1, end, own) }));
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
      if (isPunct(k + 1, "{")) fnBodies.push([k + 1, end]);
      pending.push(() => ({ from: pFrom, to: end, retained: retainedAt(pFrom - 1), locals: collectLocals(pFrom, pTo, k + 1, end) }));
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
      fnBodies.push([q + 1, end]);
      pending.push(() => ({ from: k + 1, to: end, retained: true, locals: collectLocals(k + 1, q, q + 1, end) }));
    }
  }
  // Locals need every function body known first (nested ones are skipped).
  for (const make of pending) scopes.push(make());
  // Statement blocks are scopes too: a `let` / `const` inside `{ … }` only
  // shadows within it. (Object literals declare nothing, so they're inert.)
  tokens.forEach((t, i) => {
    if (t.type !== "punct" || t.value !== "{" || fnBodies.some(([a]) => a === i)) return;
    const close = match.get(i);
    if (close === undefined) return;
    // Class bodies: field initializers run at `new`, i.e. later — late-bound
    // like methods. (A `static` initializer runs at definition; rare enough
    // to treat the same.)
    if (isClassBody(tokens, i)) {
      scopes.push({ from: i, to: close, retained: true, locals: new Set() });
      return;
    }
    const locals = new Set<string>();
    addDeclarations(locals, i, close, false);
    if (locals.size) scopes.push({ from: i, to: close, retained: false, locals });
  });
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
      if (tok.value === "{") brackets.push(isClassBody(tokens, k) ? "class" : "{");
      else if (tok.value === "[" || tok.value === "(") brackets.push(tok.value);
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
    const top = brackets[brackets.length - 1];
    const inBraces = top === "{" || top === "class";
    const keyPos =
      inBraces &&
      (prevP === "{" || prevP === "," || prevP === ";" || prevP === "}" || prevP === "*" ||
        (prev?.type === "ident" && METHOD_PREFIXES.has(prev.value)));
    if (keyPos && (nextP === ":" || nextP === "(")) continue; // `{ name: … }`, `{ name() {} }`
    // A class member name (`value;`, `value = 1`, `static value`, last in
    // the body, or ending its line) is a key, never the shared binding.
    if (top === "class" && keyPos && (nextP === ";" || nextP === "=" || nextP === "}" || !next || next.nl)) continue;
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

/** Top-level `const` → `let  ` (length kept, so offsets don't move). */
function constAsLet(code: string): string {
  let out = code;
  for (const t of tokenize(code)) {
    if (t.type === "ident" && t.value === "const" && t.depth === 0) out = out.slice(0, t.start) + "let  " + out.slice(t.end);
  }
  return out;
}

function sharedUnit(scope: readonly TsBlock[], k: number): TsUnit {
  const own = scope[k];
  // For each name: the parts (≤ k) that declare it, in order.
  const declaredIn = new Map<string, number[]>();
  scope.slice(0, k + 1).forEach((b, i) => {
    for (const n of topLevelNames(b.code)) {
      const at = declaredIn.get(n) ?? [];
      if (at[at.length - 1] !== i) at.push(i);
      declaredIn.set(n, at);
    }
  });
  // One stand-in per superseded VERSION (declaring part), unique against
  // every identifier in the unit's parts (nested bindings included):
  // `name$prev`, `name$prev2`, …
  const allIdents = new Set<string>();
  for (const b of scope.slice(0, k + 1)) for (const t of tokenize(b.code)) if (t.type === "ident") allIdents.add(t.value);
  const used = new Set<string>();
  const versions = new Map<string, string>();
  const standIn = (name: string, part: number): string => {
    const key = `${name}@${part}`;
    let m = versions.get(key);
    if (!m) {
      m = `${name}$prev`;
      for (let n = 2; allIdents.has(m) || used.has(m); n++) m = `${name}$prev${n}`;
      used.add(m);
      versions.set(key, m);
    }
    return m;
  };
  /** Part i's renames: each superseded name → the version visible to part i. */
  const renamesFor = (i: number): Map<string, string> => {
    const rename = new Map<string, string>();
    for (const [n, at] of declaredIn) {
      const newest = at[at.length - 1];
      if (newest <= i) continue; // part i already sees the final version
      const visible = [...at].reverse().find((d) => d <= i) ?? at[0];
      rename.set(n, standIn(n, visible));
    }
    return rename;
  };

  let code = hasTsCheck(own.code) ? CHECK_HEADER : "";
  const parts: TsUnit["parts"] = [];
  for (let i = 0; i <= k; i++) {
    const b = scope[i];
    if (i > 0) code += PART_SEPARATOR;
    let text = i < k ? rewriteEarlierPart(b.code, renamesFor(i)) : b.code;
    // Shared runs turn top-level bindings into reassignable globals
    // (liveJsScope.hoistTopLevelBindings): `const` → `let`, same length.
    text = constAsLet(text);
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
