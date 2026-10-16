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
export const PROVIDED_MODULES = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "vue"] as const;

/** Messages between the block (page) and the runner (sandboxed iframe). */
export type RunnerRequest = { type: "run"; runId: number; project: PlaygroundProject };
export type RunnerMessage =
  | { type: "ready" }
  | { type: "console"; runId: number; level: "log" | "info" | "warn" | "error"; text: string }
  | { type: "error"; runId: number; message: string }
  | { type: "done"; runId: number; ms: number };
