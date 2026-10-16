/**
 * LiveJS "REPL across blocks" — source transform for ```live-js shared```.
 *
 * Every run executes inside an async function in the worker (so top-level
 * `await` keeps working), which would normally make `const x = 1` local to
 * that run. For shared blocks we rewrite *top-level* bindings so they land
 * on the worker's global object instead, where later runs — and later
 * `shared` blocks in the same document — can see them:
 *
 *   const a = 1, {b} = o;   →  0, a = 1, {b} = o;     (sloppy-mode globals)
 *   let c;                  →  0, c = void 0;
 *   class K extends B {…}   →  K = class K extends B {…};
 *   function f() {…}        →  kept, plus a prelude `globalThis.f = f`
 *
 * Like a browser devtools console, re-running a block may redeclare its
 * names, and `const` bindings become reassignable. Declarations nested in
 * blocks / functions / loop heads are untouched.
 *
 * The transform is token-based (strings, template literals, comments and
 * regex literals are skipped correctly) but is not a full parser; anything
 * it does not recognise is passed through unchanged.
 */

interface Token {
  /** "ident" | "punct" | "num" | "str" | "tpl" | "regex" */
  type: "ident" | "punct" | "num" | "str" | "tpl" | "regex";
  value: string;
  start: number;
  end: number;
  /** A line terminator appears between the previous token and this one. */
  nl: boolean;
  /** Bracket depth before this token. */
  depth: number;
}

const PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=",
  "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "**",
];

/** Keywords after which a `/` starts a regex literal rather than a division. */
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw",
  "case", "do", "else", "yield", "await",
]);

/** Words that cannot end an expression (so a newline after them never ends a statement). */
const OPERATOR_WORDS = new Set([
  "typeof", "instanceof", "in", "of", "new", "delete", "void", "await", "yield",
]);

const isIdStart = (c: string) => /[A-Za-z_$ -￿]/.test(c);
const isIdPart = (c: string) => /[\w$ -￿]/.test(c);

/** Tokenize JS source. Unterminated literals simply run to the end. */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let nl = false;
  let depth = 0;
  const n = src.length;

  const regexAllowed = (): boolean => {
    const prev = out[out.length - 1];
    if (!prev) return true;
    if (prev.type === "ident") return REGEX_AFTER_WORD.has(prev.value);
    if (prev.type === "punct") return !(prev.value === ")" || prev.value === "]" || prev.value === "++" || prev.value === "--");
    return false;
  };

  const skipString = (q: string, j: number): number => {
    j++;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === q) return j + 1;
      else if (c === "\n" && q !== "`") return j;
      else j++;
    }
    return n;
  };

  /** From just after `${`, skip to just after the matching `}`. */
  const skipTemplateExpr = (j: number): number => {
    let d = 0;
    while (j < n) {
      const c = src[j];
      if (c === "'" || c === '"') j = skipString(c, j);
      else if (c === "`") j = skipTemplate(j);
      else if (c === "/" && src[j + 1] === "/") {
        const e = src.indexOf("\n", j);
        j = e === -1 ? n : e;
      } else if (c === "/" && src[j + 1] === "*") {
        const e = src.indexOf("*/", j + 2);
        j = e === -1 ? n : e + 2;
      } else if (c === "{") {
        d++;
        j++;
      } else if (c === "}") {
        if (d === 0) return j + 1;
        d--;
        j++;
      } else j++;
    }
    return n;
  };

  const skipTemplate = (j: number): number => {
    j++;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === "`") return j + 1;
      else if (c === "$" && src[j + 1] === "{") j = skipTemplateExpr(j + 2);
      else j++;
    }
    return n;
  };

  const skipRegex = (j: number): number => {
    j++;
    let inClass = false;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === "\n") return j;
      else if (inClass) {
        if (c === "]") inClass = false;
        j++;
      } else if (c === "[") {
        inClass = true;
        j++;
      } else if (c === "/") {
        j++;
        while (j < n && isIdPart(src[j])) j++;
        return j;
      } else j++;
    }
    return n;
  };

  const push = (type: Token["type"], start: number, end: number) => {
    const value = src.slice(start, end);
    let d = depth;
    if (type === "punct") {
      if (value === "(" || value === "[" || value === "{") depth++;
      else if (value === ")" || value === "]" || value === "}") {
        depth = Math.max(0, depth - 1);
        d = depth;
      }
    }
    out.push({ type, value, start, end, nl, depth: d });
    nl = false;
  };

  while (i < n) {
    const c = src[i];
    if (c === "\n" || c === "\r" || c === " " || c === " ") {
      nl = true;
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i);
      i = e === -1 ? n : e;
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e === -1 ? n : e + 2;
      if (src.slice(i, end).includes("\n")) nl = true;
      i = end;
    } else if (c === "'" || c === '"') {
      const e = skipString(c, i);
      push("str", i, e);
      i = e;
    } else if (c === "`") {
      const e = skipTemplate(i);
      push("tpl", i, e);
      i = e;
    } else if (c === "/" && regexAllowed()) {
      const e = skipRegex(i);
      push("regex", i, e);
      i = e;
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let e = i + 1;
      while (e < n && /[\w.]/.test(src[e])) e++;
      push("num", i, e);
      i = e;
    } else if (isIdStart(c) || c === "#" || c === "\\") {
      let e = i + 1;
      while (e < n && isIdPart(src[e])) e++;
      push("ident", i, e);
      i = e;
    } else {
      const p = PUNCTUATORS.find((x) => src.startsWith(x, i)) ?? c;
      push("punct", i, i + p.length);
      i += p.length;
    }
  }
  return out;
}

/** Can `tok` be the last token of a complete expression? */
function endsExpression(tok: Token): boolean {
  if (tok.type === "ident") return !OPERATOR_WORDS.has(tok.value) && !REGEX_AFTER_WORD.has(tok.value);
  if (tok.type === "punct") return [")", "]", "}", "++", "--"].includes(tok.value);
  return true;
}

/** Can `tok`, starting a new line, continue the previous expression? */
function continuesExpression(tok: Token): boolean {
  if (tok.type === "tpl") return true;
  if (tok.type === "ident") return tok.value === "in" || tok.value === "instanceof" || tok.value === "of";
  if (tok.type !== "punct") return false;
  // `++` / `--` after a newline are prefix operators (restricted production).
  if (["{", "}", ")", "]", ";", "!", "~", "++", "--"].includes(tok.value)) return false;
  return true;
}

/** Whether the token at `idx` begins a statement (at top level). */
function atStatementStart(tokens: Token[], idx: number): boolean {
  const prev = tokens[idx - 1];
  if (!prev) return true;
  if (prev.type === "punct" && (prev.value === ";" || prev.value === "}")) return true;
  return tokens[idx].nl && endsExpression(prev);
}

/** Index just past the end of the statement that starts with tokens[idx]. */
function statementEnd(tokens: Token[], idx: number): { end: number; semi: boolean } {
  const base = tokens[idx].depth;
  for (let k = idx + 1; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.depth !== base) continue;
    if (t.type === "punct" && t.value === ";") return { end: k + 1, semi: true };
    // Closers at the base depth close a bracket opened inside this
    // statement (an object literal, an arrow body, a call…).
    if (t.type === "punct" && (t.value === "}" || t.value === ")" || t.value === "]")) continue;
    if (t.nl && endsExpression(tokens[k - 1]) && !continuesExpression(t)) {
      return { end: k, semi: false };
    }
  }
  return { end: tokens.length, semi: false };
}

/**
 * Rewrite top-level `const` / `let` / `var` / `class` / `function`
 * declarations so they persist on the worker's global object.
 */
export function hoistTopLevelBindings(src: string): string {
  const tokens = tokenize(src);
  const edits: Array<{ from: number; to: number; text: string }> = [];
  const functionNames: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.depth !== 0 || tok.type !== "ident") continue;
    if (!atStatementStart(tokens, i)) continue;
    const next = tokens[i + 1];

    if ((tok.value === "const" || tok.value === "let" || tok.value === "var") && next) {
      const declStart =
        next.type === "ident" || (next.type === "punct" && (next.value === "{" || next.value === "["));
      if (!declStart || (next.type === "ident" && (next.value === "in" || next.value === "instanceof"))) continue;
      const { end, semi } = statementEnd(tokens, i);
      const bodyEnd = semi ? end - 1 : end;
      // Split declarators at depth-0 commas; find each one's `=`.
      const decls: Array<{ pattern: string; init: string | null }> = [];
      let segStart = i + 1;
      const flush = (segEnd: number) => {
        if (segEnd <= segStart) return;
        let eq = -1;
        for (let k = segStart; k < segEnd; k++) {
          if (tokens[k].depth === 0 && tokens[k].type === "punct" && tokens[k].value === "=") {
            eq = k;
            break;
          }
        }
        if (eq === -1) {
          decls.push({ pattern: src.slice(tokens[segStart].start, tokens[segEnd - 1].end), init: null });
        } else {
          decls.push({
            pattern: src.slice(tokens[segStart].start, tokens[eq - 1]?.end ?? tokens[eq].start),
            init: eq + 1 < segEnd ? src.slice(tokens[eq + 1].start, tokens[segEnd - 1].end) : "void 0",
          });
        }
      };
      for (let k = i + 1; k < bodyEnd; k++) {
        if (tokens[k].depth === 0 && tokens[k].type === "punct" && tokens[k].value === ",") {
          flush(k);
          segStart = k + 1;
        }
      }
      flush(bodyEnd);
      if (decls.length === 0) continue;
      const text =
        "0, " + decls.map((d) => `${d.pattern} = ${d.init ?? "void 0"}`).join(", ") + ";";
      const last = tokens[end - 1];
      edits.push({ from: tok.start, to: last.end, text });
      i = end - 1;
      continue;
    }

    if (tok.value === "class" && next?.type === "ident" && next.value !== "extends") {
      // Find the class body `{` and its matching `}`.
      let k = i + 2;
      while (k < tokens.length && !(tokens[k].depth === 0 && tokens[k].value === "{")) k++;
      let close = k + 1;
      while (close < tokens.length && !(tokens[close].depth === 0 && tokens[close].value === "}")) close++;
      if (close >= tokens.length) continue;
      edits.push({ from: tok.start, to: tok.start, text: `${next.value} = ` });
      edits.push({ from: tokens[close].end, to: tokens[close].end, text: ";" });
      i = close;
      continue;
    }

    let fnIdx = -1;
    if (tok.value === "function") fnIdx = i;
    else if (tok.value === "async" && next?.value === "function" && !next.nl) fnIdx = i + 1;
    if (fnIdx !== -1) {
      let k = fnIdx + 1;
      if (tokens[k]?.value === "*") k++;
      const name = tokens[k];
      if (name?.type === "ident") functionNames.push(name.value);
    }
  }

  let out = src;
  for (let e = edits.length - 1; e >= 0; e--) {
    const { from, to, text } = edits[e];
    out = out.slice(0, from) + text + out.slice(to);
  }
  if (functionNames.length > 0) {
    const prelude = functionNames
      .map((f) => `if (typeof ${f} === "function") globalThis.${f} = ${f};`)
      .join(" ");
    // Same line as the first statement so reported line numbers stay put.
    out = prelude + " " + out;
  }
  return out;
}
