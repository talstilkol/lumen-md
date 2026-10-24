/**
 * The Markdown → HAST half of the preview pipeline (plan 8.1): everything
 * from parsing to heading ids and block direction, with no React in it.
 * It runs in the render worker (./render.worker.ts) and, where a worker
 * cannot be started, on the main thread; the synchronous first-paint
 * pass (./pipeline.ts) builds on the same base, so both produce the same
 * tree for the same text.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import { visit } from "unist-util-visit";
import type { Root as MdastRoot, Code } from "mdast";
import type { Root as HastRoot } from "hast";
import { rehypeDirAuto } from "./rehypeDirAuto";
import { rehypeSanitizeRaw } from "./rehypeSanitizeRaw";
import { prepareCriticMarkup, rehypeCriticMarkup } from "./criticMarkup";
import { remarkBreaks, remarkWikiLinks, remarkAdmonitions, remarkColumns, remarkStripFrontmatter } from "./remarkLumen";

const SPECIAL_LANGS = new Set([
  "mermaid",
  "chart",
  "csv",
  "tsv",
  "json-table",
  "insights",
  "jsonl",
  "code-doctor",
  "fix-json",
  // Tabular conversions — share the DataBlock renderer.
  "sql",
  "pandas",
  "object",
  "data",
  "map",
  "geojson",
  "dot",
  "graphviz",
  "abc",
  "model",
  "plantuml",
  "puml",
  "embed",
  "htmlpreview",
  "html-preview",
  "bibtex",
  "bib",
  "database",
  // Single-language live previews — render the snippet inside a tiny
  // sandboxed iframe so users can experiment with HTML/CSS/JS/GLSL/SVG
  // without writing the full boilerplate of an `htmlpreview` block.
  "live-css",
  "css-live",
  "live-js",
  "js-live",
  "live-svg",
  "svg-live",
  "svg",
  "live-glsl",
  "glsl-live",
  "glsl",
  "shader",
  // Live Python via Pyodide (WASM, lazy-loaded on Run).
  "live-python",
  "python-live",
  "live-py",
  "py-live",
  // Live SQL via sql.js / SQLite (WASM, lazy-loaded on Run).
  "live-sql",
  "sql-live",
  // Live Lua via wasmoon (Lua 5.4 WASM in a Worker, lazy-loaded on Run).
  "live-lua",
  "lua-live",
  // Live R via webR (R in WASM, self-hosted under /webr/, loaded on Run).
  "live-r",
  "r-live",
  // Live Ruby via ruby.wasm (CRuby in WASI, in a Worker, loaded on Run).
  "live-ruby",
  "ruby-live",
  // Web Playground: multi-file HTML / CSS / JS / JSX / TS (+ React / Vue).
  "playground",
  "web-playground",
  // Plain `html` fence as alias for `html-preview` — Lumen treats a raw
  // HTML fence as "render this HTML safely in a sanitized preview" rather
  // than a syntax-highlighted code block. Matches the dynamic-blocks-
  // hardening contract: any HTML the user types must round-trip through
  // markupSanitizer before it touches the DOM.
  "html",
]);

/**
 * remark plugin: transform code blocks with special langs into custom hast nodes.
 * The block source becomes the text child so React components receive it as `children`.
 */
function remarkLumenBlocks() {
  return (tree: MdastRoot) => {
    visit(tree, "code", (node: Code) => {
      const lang = (node.lang ?? "").toLowerCase();
      if (!SPECIAL_LANGS.has(lang)) return;
      // Aliases.
      let tag: string;
      if (lang === "json-table") tag = "lumen-jsontable";
      else if (lang === "insights" || lang === "jsonl") tag = "lumen-insights";
      else if (lang === "code-doctor" || lang === "fix-json") tag = "lumen-code-doctor";
      else if (lang === "graphviz") tag = "lumen-dot";
      else if (lang === "puml") tag = "lumen-plantuml";
      else if (lang === "html-preview" || lang === "htmlpreview" || lang === "html")
        tag = "lumen-htmlpreview";
      else if (lang === "bib") tag = "lumen-bibtex";
      // Tabular conversions all share the DataBlock component, with `lang`
      // forwarded as a prop so it picks the right parser.
      else if (lang === "sql" || lang === "pandas" || lang === "object" || lang === "data")
        tag = "lumen-data";
      // Live web-language blocks — fold short / long names into a
      // single tag so React mounts the right component regardless of
      // which spelling the user picked.
      else if (lang === "live-css" || lang === "css-live") tag = "lumen-livecss";
      else if (lang === "live-js" || lang === "js-live") tag = "lumen-livejs";
      else if (lang === "live-svg" || lang === "svg-live" || lang === "svg") tag = "lumen-livesvg";
      else if (lang === "live-glsl" || lang === "glsl-live" || lang === "glsl" || lang === "shader")
        tag = "lumen-liveglsl";
      else if (lang === "live-python" || lang === "python-live" || lang === "live-py" || lang === "py-live")
        tag = "lumen-livepython";
      else if (lang === "live-sql" || lang === "sql-live") tag = "lumen-livesql";
      else if (lang === "live-lua" || lang === "lua-live") tag = "lumen-livelua";
      else if (lang === "live-r" || lang === "r-live") tag = "lumen-liver";
      else if (lang === "live-ruby" || lang === "ruby-live") tag = "lumen-liveruby";
      else if (lang === "playground" || lang === "web-playground") tag = "lumen-playground";
      else tag = `lumen-${lang}`;
      const data = (node.data ?? (node.data = {})) as Record<string, unknown>;
      data.hName = tag;
      data.hProperties = { lang, meta: node.meta ?? "" };
      data.hChildren = [{ type: "text", value: node.value ?? "" }];
    });
  };
}

export function buildBase() {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkStripFrontmatter)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkMath)
    .use(remarkDirective)
    .use(remarkAdmonitions)
    .use(remarkColumns)
    .use(remarkWikiLinks)
    .use(remarkLumenBlocks)
    .use(remarkRehype, { allowDangerousHtml: true });
}

/**
 * Cheap detection: does the markdown source contain anything that
 * looks like raw HTML? Matches `<tag`, `</tag`, `<!--`. Doesn't try to
 * be strict about code-fence boundaries — a false positive just means
 * we load the bigger pipeline once for that doc, never a correctness
 * issue.
 */
export function hasRawHtml(source: string): boolean {
  return /<[a-zA-Z!/]/.test(source);
}

/** remark-math only recognises `$…$` / `$$…$$`; no `$` → no KaTeX. */
export function hasMath(source: string): boolean {
  return source.includes("$");
}

export interface HastOptions {
  /** The source has inline HTML: parse it (rehype-raw) and sanitise it. */
  raw: boolean;
}

type HastProcessor = ReturnType<typeof buildBase>;
const processors = new Map<string, Promise<HastProcessor>>();

/**
 * The processor for a raw / no-raw document. rehype-raw pulls in parse5
 * (~40 KB gz): only documents with inline HTML pay for it, and only once.
 */
function getProcessor(opts: HastOptions): Promise<HastProcessor> {
  const key = opts.raw ? "raw" : "plain";
  let p = processors.get(key);
  if (!p) {
    p = (async () => {
      let proc = buildBase();
      if (opts.raw) {
        const rehypeRaw = (await import("rehype-raw")).default;
        // Inline HTML goes through the allowlist sanitizer right after parsing (T48).
        proc = proc.use(rehypeRaw).use(rehypeSanitizeRaw) as unknown as HastProcessor;
      }
      // CriticMarkup (suggesting mode) → <ins>/<del>/<mark>; before rehypeSlug
      // so heading ids are computed from the rendered text.
      return proc.use(rehypeCriticMarkup).use(rehypeSlug).use(rehypeDirAuto) as unknown as HastProcessor;
    })();
    p.catch(() => processors.delete(key)); // a failed chunk fetch may be retried
    processors.set(key, p);
  }
  return p;
}

/** Drop source positions: nothing after parsing reads them, and they double the tree's size over postMessage. */
export function stripPositions(node: { position?: unknown; children?: unknown[] }): void {
  delete node.position;
  if (Array.isArray(node.children)) for (const c of node.children) stripPositions(c as { position?: unknown; children?: unknown[] });
}

/** Markdown → HAST, up to heading ids and block direction (no Shiki, KaTeX or React). */
export async function renderToHast(markdownText: string, opts: HastOptions): Promise<HastRoot> {
  const proc = await getProcessor(opts);
  const tree = proc.parse(prepareCriticMarkup(markdownText));
  const hast = (await proc.run(tree)) as HastRoot;
  stripPositions(hast);
  return hast;
}
