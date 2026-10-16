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
    scripts.find((f) => /^(main|index)\.(m?jsx?|tsx?)$/i.test(f.name))?.name ?? scripts[0]?.name ?? null;
  const htmlFile = files.find((f) => /\.html?$/i.test(f.name));
  const html = htmlFile?.code ?? (framework === "vue" ? '<div id="app"></div>' : '<div id="root"></div>');
  return { framework, files, entry, html, css: files.filter((f) => /\.css$/i.test(f.name)).map((f) => f.code) };
}

/** Resolve a relative import (`./App.jsx`, `./App`) against the project. */
export function resolveImport(spec: string, from: string, names: readonly string[]): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  const base = parts.join("/");
  const candidates = [base, ...[".js", ".jsx", ".ts", ".tsx", ".mjs"].map((e) => base + e), ...["/index.js", "/index.jsx", "/index.ts", "/index.tsx"].map((e) => base + e)];
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
    if (t?.type === "str") out.push({ start: t.start, end: t.end, spec: t.value.slice(1, -1) });
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
      if (next?.value === "(" && tokens[i + 2]?.type === "str" && tokens[i + 3]?.value === ")") {
        add(i + 2); // import("x")
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

export const PROVIDED_MODULES = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "vue"] as const;

/** Messages between the block (page) and the runner (sandboxed iframe). */
export type RunnerRequest = { type: "run"; runId: number; project: PlaygroundProject };
export type RunnerMessage =
  | { type: "ready" }
  | { type: "console"; runId: number; level: "log" | "info" | "warn" | "error"; text: string }
  | { type: "error"; runId: number; message: string }
  | { type: "done"; runId: number; ms: number };
