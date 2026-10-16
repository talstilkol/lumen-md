/**
 * Web Playground runner — the page inside the block's sandboxed iframe
 * (`sandbox="allow-scripts"`, no same-origin: an opaque origin with no
 * access to the app's storage, cookies or DOM). It receives one project per
 * load, transpiles JSX / TypeScript with Sucrase, links the files as blob
 * ES modules, provides react / react-dom / vue from self-hosted copies
 * (/playground/vendor/, no CDN), runs the entry module, and reports console
 * output and errors back to the page.
 */
import { transform } from "sucrase";
import {
  importSpecifiers,
  resolveImport,
  type PlaygroundProject,
  type RunnerMessage,
  type RunnerRequest,
} from "./files";

// Beneath Vite's base (a subpath deployment serves them at /app/playground/…).
const vendor = (file: string) => new URL(`${import.meta.env.BASE_URL}playground/vendor/${file}`, location.href).href;
let runId = 0;
const post = (msg: RunnerMessage) => parent.postMessage(msg, "*");

function show(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    const head = `${value.name}: ${value.message}`;
    // Firefox / Safari stacks don't start with the message.
    if (!value.stack) return head;
    return value.stack.includes(value.message) ? value.stack : `${head}\n${value.stack}`;
  }
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_k, v: unknown) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      if (typeof v === "function") return `[Function ${(v as { name?: string }).name || "anonymous"}]`;
      if (typeof v === "bigint") return `${v}n`;
      return v;
    }) ?? String(value);
  } catch {
    return String(value);
  }
}

const MAX_CONSOLE = 500;
let sent = 0;
for (const level of ["log", "info", "warn", "error"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    orig(...args);
    if (sent++ < MAX_CONSOLE) post({ type: "console", runId, level, text: args.map(show).join(" ").slice(0, 10_000) });
  };
}
// Errors share the console's budget and size cap, so a huge thrown value
// can't flood the parent.
const postError = (message: string) => {
  if (sent++ < MAX_CONSOLE) post({ type: "error", runId, message: String(message).slice(0, 10_000) });
};
addEventListener("error", (e) => postError(e.error ? show(e.error) : e.message));
addEventListener("unhandledrejection", (e) => postError(show(e.reason)));

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const blob = (code: string) => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));

/** An ES module re-exporting a global (React / ReactDOM). */
function globalModule(name: string, extra = ""): string {
  const g = (window as unknown as Record<string, Record<string, unknown> | undefined>)[name];
  if (!g) throw new Error(`${name} is not loaded`);
  const keys = Object.keys(g).filter((k) => IDENT_RE.test(k) && k !== "default");
  return `const G = window.${name};\nexport default G;\n${keys.length ? `export const { ${keys.join(", ")} } = G;\n` : ""}${extra}`;
}

async function providedModules(framework: PlaygroundProject["framework"]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (framework === "react") {
    await loadScript(vendor("react.production.min.js"));
    await loadScript(vendor("react-dom.production.min.js"));
    out.react = blob(globalModule("React"));
    out["react-dom"] = blob(globalModule("ReactDOM"));
    out["react-dom/client"] = out["react-dom"];
    // Automatic JSX runtime on top of createElement.
    out["react/jsx-runtime"] = blob(
      [
        "const R = window.React;",
        "export const Fragment = R.Fragment;",
        "export function jsx(type, props, key) {",
        "  const { children, ...rest } = props || {};",
        "  if (key !== undefined) rest.key = key;",
        "  return children === undefined ? R.createElement(type, rest)",
        "    : Array.isArray(children) ? R.createElement(type, rest, ...children)",
        "    : R.createElement(type, rest, children);",
        "}",
        "export const jsxs = jsx;",
        "export const jsxDEV = jsx;",
      ].join("\n"),
    );
  }
  out.vue = vendor("vue.esm-browser.prod.js");
  return out;
}


async function link(project: PlaygroundProject): Promise<string> {
  const provided = await providedModules(project.framework);
  const names = project.files.map((f) => f.name);
  const urls = new Map<string, string>();
  const visiting = new Set<string>();
  const build = (name: string): string => {
    const done = urls.get(name);
    if (done) return done;
    if (visiting.has(name)) throw new Error(`Circular import involving ${name} isn't supported`);
    visiting.add(name);
    const file = project.files.find((f) => f.name === name)!;
    let code = file.code;
    if (/\.css$/i.test(name)) code = `export default ${JSON.stringify(file.code)};`;
    else if (/\.json$/i.test(name)) code = `export default ${file.code};`;
    else {
      const ts = /\.tsx?$/i.test(name);
      const jsx = /\.(jsx|tsx)$/i.test(name) || (project.framework === "react" && /\.js$/i.test(name));
      code = transform(code, {
        transforms: [...(ts ? (["typescript"] as const) : []), ...(jsx ? (["jsx"] as const) : [])],
        jsxRuntime: project.framework === "react" ? "automatic" : "classic",
        production: true,
        filePath: name,
      }).code;
    }
    // Only real import / re-export specifiers (not text in comments or
    // strings), replaced from the end so offsets stay valid.
    for (const { start, end, spec } of importSpecifiers(code).reverse()) {
      let url: string;
      if (spec in provided) url = provided[spec];
      else {
        const target = resolveImport(spec, name, names);
        if (target) url = build(target);
        else if (/^(\.|\/)/.test(spec)) throw new Error(`${name}: can't find "${spec}"`);
        else throw new Error(`${name}: package "${spec}" isn't available here (react, react-dom, vue are)`);
      }
      code = code.slice(0, start) + JSON.stringify(url) + code.slice(end);
    }
    const url = blob(code + `\n//# sourceURL=${name}`);
    urls.set(name, url);
    visiting.delete(name);
    return url;
  };
  if (!project.entry) throw new Error("No script to run: add a main.js / main.jsx file");
  return build(project.entry);
}

async function run(project: PlaygroundProject): Promise<void> {
  const started = performance.now();
  for (const css of project.css) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
  // The project's own markup (scripts inside it don't run: use files).
  const tpl = document.createElement("template");
  tpl.innerHTML = project.html;
  tpl.content.querySelectorAll("script").forEach((s) => s.remove());
  document.body.replaceChildren(tpl.content);
  try {
    const entry = await link(project);
    await import(/* @vite-ignore */ entry);
  } catch (err) {
    post({ type: "error", runId, message: show(err) });
  }
  // Let synchronous render work settle before reporting.
  setTimeout(() => post({ type: "done", runId, ms: Math.round(performance.now() - started) }), 0);
}

let started = false;
addEventListener("message", (e: MessageEvent<RunnerRequest>) => {
  if (e.source !== parent || started || e.data?.type !== "run") return;
  started = true; // one project per load: the page reloads the frame to re-run
  runId = e.data.runId;
  if (!e.data.project?.files?.every((f) => typeof f.code === "string" && typeof f.name === "string")) return;
  void run(e.data.project);
});
post({ type: "ready" });

