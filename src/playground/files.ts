/**
 * Web Playground — the fence body as a small multi-file project.
 *
 *   ```playground react
 *   --- index.html ---
 *   <div id="root"></div>
 *   --- App.jsx ---
 *   export default function App() { return <h1>Hi</h1>; }
 *   --- main.jsx ---
 *   import { createRoot } from "react-dom/client";
 *   import App from "./App.jsx";
 *   createRoot(document.getElementById("root")).render(<App />);
 *   ```
 *
 * A body without markers is a single file: `main.jsx` for react, `main.js`
 * for vue / vanilla. Pure: no DOM.
 */

import { tokenize } from "../plugins/liveJsScope";

export type PlaygroundFramework = "vanilla" | "react" | "vue";

export interface PlaygroundFile {
  name: string;
  code: string;
}

export interface PlaygroundProject {
  framework: PlaygroundFramework;
  files: PlaygroundFile[];
  /** The module the page runs first (`main.*`, else the first script). */
  entry: string | null;
  /** index.html body (the runner adds its own document around it). */
  html: string;
  /** All CSS files, in order. */
  css: string[];
}

const MARKER_RE = /^-{3,}\s*([\w./-]+\.[A-Za-z0-9]+)\s*-{3,}\s*$/;
export const SCRIPT_EXT_RE = /\.(m?jsx?|tsx?)$/i;

export function frameworkFromMeta(meta?: string): PlaygroundFramework {
  const m = meta ?? "";
  if (/\breact\b/i.test(m)) return "react";
  if (/\bvue\b/i.test(m)) return "vue";
  return "vanilla";
}

/** Split the body at `--- name.ext ---` lines. */
export function splitFiles(body: string, framework: PlaygroundFramework): PlaygroundFile[] {
  const lines = body.split("\n");
  const files: PlaygroundFile[] = [];
  let cur: PlaygroundFile | null = null;
  const loose: string[] = [];
  for (const line of lines) {
    const m = MARKER_RE.exec(line);
    if (m) {
      cur = { name: m[1].replace(/^\.\//, ""), code: "" };
      files.push(cur);
      continue;
    }
    if (cur) cur.code += (cur.code ? "\n" : "") + line;
    else loose.push(line);
  }
  const before = loose.join("\n").trim();
  if (!files.length) {
    return before ? [{ name: framework === "react" ? "main.jsx" : "main.js", code: before }] : [];
  }
  // Text before the first marker is ignored unless it's code-like.
  if (before) files.unshift({ name: framework === "react" ? "main.jsx" : "main.js", code: before });
  return files.map((f) => ({ ...f, code: f.code.replace(/\n+$/, "") }));
}

export function buildProject(body: string, meta?: string): PlaygroundProject {
  const framework = frameworkFromMeta(meta);
  const files = splitFiles(body, framework);
  const scripts = files.filter((f) => SCRIPT_EXT_RE.test(f.name));
  const entry =
    scripts
      .filter((f) => /(?:^|\/)(main|index)\.(m?jsx?|tsx?)$/i.test(f.name))
      // The shallowest main / index wins (`main.js` before `src/main.jsx`).
      .sort((a, b) => a.name.split("/").length - b.name.split("/").length)[0]?.name ??
    scripts[0]?.name ??
    null;
  const htmlFiles = files.filter((f) => /\.html?$/i.test(f.name));
  // `index.html` is the page; another HTML file only when there's no index.
  const htmlFile = htmlFiles.find((f) => /(?:^|\/)index\.html?$/i.test(f.name)) ?? htmlFiles[0];
  const html = htmlFile?.code ?? (framework === "vue" ? '<div id="app"></div>' : '<div id="root"></div>');
  return { framework, files, entry, html, css: files.filter((f) => /\.css$/i.test(f.name)).map((f) => f.code) };
}

/** Import attributes right after a specifier: static `with {…}` / `assert {…}`, or a dynamic import's options. */
export const IMPORT_ATTRS_RE = /^\s*(?:(?:with|assert)\s*\{[^{}]*\}|,\s*\{\s*(?:with|assert)\s*:\s*\{[^{}]*\}\s*,?\s*\}\s*,?)/;

/** Resolve a relative import (`./App.jsx`, `./App`) against the project. */
export function resolveImport(spec: string, from: string, names: readonly string[]): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  const base = parts.join("/");
  const candidates = [base, ...[".js", ".jsx", ".ts", ".tsx", ".mjs", ".css", ".json"].map((e) => base + e), ...["/index.js", "/index.jsx", "/index.ts", "/index.tsx"].map((e) => base + e)];
  return candidates.find((c) => names.includes(c)) ?? null;
}

/** Bare specifiers the runner provides. */
/**
 * Module specifiers of a module's real imports and re-exports — static
 * `import … from "x"`, `import "x"`, `export … from "x"` and `import("x")`
 * with a string literal — found with the live-js tokenizer, so import-like
 * text in comments, strings and templates is ignored. `start` / `end`
 * cover the string literal, quotes included.
 */
export function importSpecifiers(code: string): Array<{ start: number; end: number; spec: string }> {
  const tokens = tokenize(code);
  const out: Array<{ start: number; end: number; spec: string }> = [];
  const add = (i: number) => {
    const t = tokens[i];
    if (t?.type === "str" || isPlainTemplate(t)) out.push({ start: t.start, end: t.end, spec: t.value.slice(1, -1) });
  };
  // Inside a top-level `import` / `export` statement, waiting for `from`.
  let inDecl = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    if (t.type === "tpl") {
      // `${ … }` expressions inside a template can hold dynamic imports.
      for (const e of templateExpressions(t.value)) {
        for (const hit of importSpecifiers(e.code)) {
          out.push({ start: t.start + e.offset + hit.start, end: t.start + e.offset + hit.end, spec: hit.spec });
        }
      }
      continue;
    }
    if (t.type === "punct") {
      if (t.value === ";") inDecl = false;
      continue;
    }
    if (t.type !== "ident" || prev?.value === "." || prev?.value === "?.") continue;
    if (t.value === "import") {
      const next = tokens[i + 1];
      if (next?.type === "str") {
        add(i + 1); // import "x"
        continue;
      }
      const arg = tokens[i + 2];
      if (next?.value === "(" && (arg?.type === "str" || isPlainTemplate(arg)) && (tokens[i + 3]?.value === ")" || tokens[i + 3]?.value === ",")) {
        add(i + 2); // import("x") / import(`x`) / import("x", { with: … })
        continue;
      }
      if (t.depth === 0 && next?.value !== "." && next?.value !== "(") inDecl = true;
      continue;
    }
    if (t.value === "export" && t.depth === 0) {
      inDecl = true;
      continue;
    }
    if (t.value === "from" && inDecl && t.depth === 0 && tokens[i + 1]?.type === "str") {
      add(i + 1);
      inDecl = false;
    }
  }
  return out;
}

/** A template literal with no `${…}` substitutions or escapes: a static string. */
function isPlainTemplate<T extends { type: string; value: string }>(t: T | undefined): t is T {
  return t?.type === "tpl" && !/\$\{|\\/.test(t.value);
}

/** The loop guard the runner defines (it throws once the page has been busy too long). */
export const LOOP_GUARD = "__lumenLoop";

/**
 * Loop conditions guarded: `while (c)` → `while (__lumenLoop() && (c))`,
 * `for (a; c; b)` likewise (`do … while` is covered by its `while`), so a
 * runaway loop throws instead of freezing the editor. `for … of / in`
 * loops are left alone.
 */
export function guardLoops(code: string): string {
  const tokens = tokenize(code);
  const edits: Array<{ at: number; text: string }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "ident" || (t.value !== "while" && t.value !== "for")) continue;
    // Only the loop statements: not `o.while(…)`, nor a method named
    // `while` / `for` in a class body or object literal.
    if (!inStatementPosition(tokens, i)) continue;
    const open = tokens[i + 1];
    if (!open || open.value !== "(") continue;
    const d = open.depth;
    let close = -1;
    const semis: number[] = [];
    for (let k = i + 2; k < tokens.length; k++) {
      const x = tokens[k];
      if (x.type === "punct" && x.value === ")" && x.depth === d) {
        close = k;
        break;
      }
      if (x.type === "punct" && x.value === ";" && x.depth === d + 1) semis.push(k);
    }
    if (close === -1) continue;
    if (t.value === "while") {
      edits.push({ at: open.end, text: `${LOOP_GUARD}() && (` }, { at: tokens[close].start, text: ")" });
    } else if (semis.length === 2) {
      const [a, b] = semis;
      if (b === a + 1) edits.push({ at: tokens[a].end, text: ` ${LOOP_GUARD}()` });
      else edits.push({ at: tokens[a].end, text: ` ${LOOP_GUARD}() && (` }, { at: tokens[b].start, text: ")" });
    }
  }
  let out = code;
  for (const e of edits.sort((x, y) => y.at - x.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at);
  return out;
}

type Tok = ReturnType<typeof tokenize>[number];

/** Words before a method name: `static for()`, `get while()`, `async *for()`. */
const METHOD_PREFIX = new Set(["static", "get", "set", "async", "*", "accessor"]);
/** Keywords whose `{` that follows opens a block (never an object literal). */
const BLOCK_AFTER = new Set(["else", "do", "try", "finally"]);

/**
 * Whether the keyword at `i` starts a statement — rather than being a
 * property (`o.while`), a method name in a class body or object literal
 * (`{ while(x) {…} }`), or an object key.
 */
function inStatementPosition(tokens: Tok[], i: number): boolean {
  const prev = tokens[i - 1];
  if (!prev) return true;
  if (prev.value === "." || prev.value === "?." || prev.value === "," || METHOD_PREFIX.has(prev.value)) return false;
  // Statement or member boundary: decide by the enclosing `{ … }`.
  const depth = tokens[i].depth;
  if (depth === 0) return true;
  let b = i - 1;
  while (b >= 0 && tokens[b].depth >= depth) b--;
  const brace = tokens[b];
  if (!brace || brace.value !== "{") return true; // inside ( … ) / [ … ]: not a member list
  return !isClassBody(tokens, b) && !isObjectLiteral(tokens, b);
}

/** `class X extends Y {`: the `{` at `b` opens a class body. */
function isClassBody(tokens: Tok[], b: number): boolean {
  const d = tokens[b].depth;
  for (let k = b - 1; k >= 0; k--) {
    const t = tokens[k];
    if (t.depth < d) return false;
    if (t.depth > d) continue;
    if (t.type === "ident" && t.value === "class") return true;
    if (t.value === ";" || t.value === "{" || t.value === "}" || t.value === "=>" || t.value === "=") return false;
    if (t.type === "ident" && (BLOCK_AFTER.has(t.value) || t.value === "function" || t.value === "if" || t.value === "while" || t.value === "for" || t.value === "switch" || t.value === "catch" || t.value === "with")) return false;
  }
  return false;
}

/** The `{` at `b` stands where an expression goes, so it opens an object literal. */
function isObjectLiteral(tokens: Tok[], b: number): boolean {
  const prev = tokens[b - 1];
  if (!prev) return false;
  if (prev.type === "ident") return ["return", "yield", "await", "typeof", "void", "in", "of", "case", "delete", "throw", "new"].includes(prev.value);
  if (prev.type !== "punct") return false;
  if (prev.value === ")" || prev.value === "]" || prev.value === "}" || prev.value === ";" || prev.value === "{" || prev.value === "=>") return false;
  if (prev.value === ":") {
    // `label: {` is a labeled block when the label starts a statement: at
    // the start, after `;` / `}`, or inside a `{` that is itself a block.
    const label = tokens[b - 2];
    if (label?.type === "ident") {
      const before = tokens[b - 3];
      if (!before || before.value === ";" || before.value === "}") return false;
      if (before.value === "{") return isObjectLiteral(tokens, b - 3);
    }
    // `case x: {` / `default: {` open a block.
    for (let k = b - 2; k >= 0 && tokens[k].depth >= prev.depth; k--) {
      const t = tokens[k];
      if (t.depth > prev.depth) continue;
      if (t.value === "case" || t.value === "default") return false;
      if (t.value === ";" || t.value === "{" || t.value === "}" || t.value === "," || t.value === "?" || t.value === "(") break;
    }
  }
  // `=`, `(`, `,`, `[`, `?`, `:`, `&&`, `||`, `...` and other operators.
  return true;
}

/** The `${ … }` expressions of a template literal's source, with offsets into it. */
function templateExpressions(tpl: string): Array<{ offset: number; code: string }> {
  const out: Array<{ offset: number; code: string }> = [];
  for (let i = 1; i < tpl.length; i++) {
    if (tpl[i] === "\\") {
      i++;
      continue;
    }
    if (tpl[i] !== "$" || tpl[i + 1] !== "{") continue;
    const from = i + 2;
    // The expression ends at the first `}` outside its own brackets,
    // strings and nested templates (the tokenizer tracks those).
    const close = tokenize(tpl.slice(from)).find((x) => x.type === "punct" && x.value === "}" && x.depth === 0);
    if (!close) break;
    out.push({ offset: from, code: tpl.slice(from, from + close.start) });
    i = from + close.start;
  }
  return out;
}

/**
 * JSON-like text for a logged value, built with an output budget: the walk
 * stops once `max` characters are written (ending in `…`), so logging a
 * huge object or typed array never serializes all of it. Circular
 * references, functions and bigints are shown the way JSON can't.
 */
export function formatValue(value: unknown, max = 10_000): string {
  let out = "";
  const full = () => out.length >= max;
  const write = (s: string) => {
    if (!full()) out += s;
  };
  const seen = new WeakSet<object>();
  const walk = (v: unknown, inArray: boolean): void => {
    if (full()) return;
    if (v !== null && typeof v === "object" && typeof (v as { toJSON?: unknown }).toJSON === "function") {
      try {
        v = (v as { toJSON: () => unknown }).toJSON();
      } catch {
        /* keep the object */
      }
    }
    if (typeof v === "function") return write(JSON.stringify(`[Function ${(v as { name?: string }).name || "anonymous"}]`));
    if (typeof v === "bigint") return write(JSON.stringify(`${v}n`));
    if (v === undefined || typeof v === "symbol") return write(inArray ? "null" : String(v));
    if (typeof v === "number") return write(Number.isFinite(v) ? String(v) : "null");
    if (v === null || typeof v !== "object") return write(JSON.stringify(v));
    if (seen.has(v)) return write('"[Circular]"');
    seen.add(v);
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const list = v as ArrayLike<unknown>;
      write("[");
      for (let k = 0; k < list.length && !full(); k++) {
        if (k) write(",");
        walk(list[k], true);
      }
      write("]");
    } else {
      write("{");
      let first = true;
      for (const k in v) {
        if (full()) break;
        if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
        const x = (v as Record<string, unknown>)[k];
        if (x === undefined || typeof x === "symbol") continue;
        if (!first) write(",");
        first = false;
        write(JSON.stringify(k) + ":");
        walk(x, false);
      }
      write("}");
    }
    seen.delete(v);
  };
  try {
    walk(value, false);
  } catch {
    return String(value).slice(0, max);
  }
  return out.length >= max ? out.slice(0, max) + "…" : out;
}

export const PROVIDED_MODULES = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "vue"] as const;

/** Messages between the block (page) and the runner (sandboxed iframe). */
export type RunnerRequest = { type: "run"; runId: number; project: PlaygroundProject };
export type RunnerMessage =
  | { type: "ready" }
  | { type: "console"; runId: number; level: "log" | "info" | "warn" | "error"; text: string }
  | { type: "error"; runId: number; message: string }
  | { type: "done"; runId: number; ms: number };
