/**
 * Web Playground — the runner page's half: what runs inside the sandboxed
 * frame (src/playground/runner.ts) and the messages between it and the
 * block. No parser and no transpiler here: the block compiles the project
 * (./compile.ts) and the runner only links and runs it, so the runner
 * bundle (public/runners/playground-runner.js, scripts/build-runners.mjs) is
 * built from this repository's code alone. Pure: no DOM.
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

/** One project file as the block compiled it: JavaScript, its import specifiers, or why it didn't compile. */
export type CompiledFile =
  | { name: string; code: string; specs: Array<{ start: number; end: number; spec: string }> }
  | { name: string; error: string };

/**
 * What the runner needs besides the project: every file compiled (Sucrase,
 * loop guards, specifiers) and the vendor libraries' source text. The block
 * reads the libraries from the app's own origin and sends them, so the
 * runner page loads no script by URL (its CSP allows one hash and blob:).
 */
export interface PlaygroundBuild {
  files: CompiledFile[];
  vendor: { react?: string; reactDom?: string; vue?: string };
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

/**
 * The error for a circular import (A4, a documented decision): the runner
 * links every file as its own blob: module, and a blob's URL exists only
 * once its code is final, so two files can't import each other. `stack`
 * is the chain of files being linked, `name` the one imported again.
 */
export function circularImportMessage(stack: readonly string[], name: string): string {
  const loop = [...stack.slice(Math.max(0, stack.indexOf(name))), name];
  return `Circular import: ${loop.join(" → ")}. Playground files are linked one by one, so they can't import each other in a loop; move the shared code into a separate file that both import.`;
}

/** The loop guard the runner defines (it throws once the page has been busy too long). */
export const LOOP_GUARD = "__lumenLoop";

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
  // Strings are cut to the remaining budget before JSON-encoding them, so a
  // huge string value or key is never serialized whole.
  const str = (t: string) => JSON.stringify(t.slice(0, Math.max(0, max - out.length) + 1));
  const seen = new WeakSet<object>();
  const walk = (v: unknown, inArray: boolean): void => {
    if (full()) return;
    if (v !== null && typeof v === "object" && typeof (v as { toJSON?: unknown }).toJSON === "function") {
      try {
        v = (v as { toJSON: () => unknown }).toJSON();
      } catch {
        /* why: a throwing toJSON: show the object itself */
      }
    }
    if (typeof v === "function") return write(str(`[Function ${String((v as { name?: string }).name || "anonymous").slice(0, max)}]`));
    if (typeof v === "bigint") return write(JSON.stringify(`${v}n`));
    if (v === undefined || typeof v === "symbol") return write(inArray ? "null" : String(v));
    if (typeof v === "number") return write(Number.isFinite(v) ? String(v) : "null");
    if (typeof v === "string") return write(str(v));
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
        write(str(k) + ":");
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

/** Messages between the block (page) and the runner (sandboxed iframe). */
export type RunnerRequest = { type: "run"; runId: number; project: PlaygroundProject; build: PlaygroundBuild };
export type RunnerMessage =
  | { type: "ready" }
  | { type: "console"; runId: number; level: "log" | "info" | "warn" | "error"; text: string }
  | { type: "error"; runId: number; message: string }
  | { type: "done"; runId: number; ms: number };
