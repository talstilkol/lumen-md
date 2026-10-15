import { unified } from "unified";
import type { Processor } from "unified";
import type { ReactElement } from "react";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
// rehype-raw is dynamically imported in getProcessorWithRaw() — it
// pulls in parse5 (~275 KB raw / ~40 KB gzipped) and most docs don't
// need it. Splitting it out of the main bundle is M12-followup-2.
import rehypeReact from "rehype-react";
// Eager-import katex BEFORE mhchem so Rollup's chunk graph keeps the
// canonical katex module evaluated first. Without this, the production
// bundle's vendor-katex chunk hits a Temporal Dead Zone error
// ("Cannot access 'xn' before initialization") because mhchem's
// side-effect mutation of katex internals runs before katex's own
// initializers complete. The eager import binds katex into the chunk
// graph as a regular dependency, not a side-effect afterthought.
import "katex";
// Side-effect import: registers \ce{}/\pu{} macros on KaTeX
import "katex/contrib/mhchem";
import { visit } from "unist-util-visit";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import YAML from "yaml";
import type { Root as MdastRoot, Code } from "mdast";
import type { Root as HastRoot } from "hast";
import { components } from "./components";
import { rehypeShiki } from "./shiki";
import {
  remarkBreaks,
  remarkWikiLinks,
  remarkAdmonitions,
  remarkColumns,
  remarkStripFrontmatter,
  slug,
} from "./remarkLumen";

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
      else tag = `lumen-${lang}`;
      const data = (node.data ?? (node.data = {})) as Record<string, unknown>;
      data.hName = tag;
      data.hProperties = { lang, meta: node.meta ?? "" };
      data.hChildren = [{ type: "text", value: node.value ?? "" }];
    });
  };
}

type LumenProcessor = Processor<MdastRoot, MdastRoot, HastRoot, HastRoot, ReactElement>;

let processorNoRaw: LumenProcessor | null = null;
let processorWithRaw: LumenProcessor | null = null;

function buildBase(_isDark: () => boolean) {
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

function finishPipeline(p: ReturnType<typeof buildBase>, isDark: () => boolean): LumenProcessor {
  return p
    .use(rehypeSlug)
    .use(rehypeKatex)
    .use(rehypeShiki, { isDark })
    .use(rehypeReact, {
      Fragment,
      jsx,
      jsxs,
      components,
      // rehype-react's option type is parameterised by the JSX runtime
      // shape; our `components` map is locally typed through hast-util's
      // Components but rehype-react still wants a wider partial. The
      // outer cast resolves the Processor type-parameter mismatch — the
      // inner narrow lifts the option-bag through `unknown`.
    } as unknown as Parameters<typeof rehypeReact>[0]) as unknown as LumenProcessor;
}

function getProcessorNoRaw(isDark: () => boolean): LumenProcessor {
  if (!processorNoRaw) {
    processorNoRaw = finishPipeline(buildBase(isDark), isDark);
  }
  return processorNoRaw;
}

async function getProcessorWithRaw(isDark: () => boolean): Promise<LumenProcessor> {
  if (!processorWithRaw) {
    // Lazy import: parse5 + entities (~275 KB raw + 70 KB raw) only
    // ship for docs that actually contain inline HTML.
    const { default: rehypeRaw } = await import("rehype-raw");
    processorWithRaw = finishPipeline(buildBase(isDark).use(rehypeRaw), isDark);
  }
  return processorWithRaw;
}

/**
 * Cheap detection: does the markdown source contain anything that
 * looks like raw HTML? Matches `<tag`, `</tag`, `<!--`. Doesn't try to
 * be strict about code-fence boundaries — a false positive just means
 * we load the bigger pipeline once for that doc, never a correctness
 * issue.
 */
function hasRawHtml(source: string): boolean {
  return /<[a-zA-Z!/]/.test(source);
}

export async function renderMarkdown(
  markdownText: string,
  isDark: () => boolean,
): Promise<ReactElement> {
  const proc = hasRawHtml(markdownText)
    ? await getProcessorWithRaw(isDark)
    : getProcessorNoRaw(isDark);
  const file = await proc.process(markdownText);
  return file.result as ReactElement;
}

/** Extract YAML frontmatter (parsed) from a markdown source, or null. */
export function extractFrontmatter(
  markdownText: string,
): Record<string, unknown> | null {
  const m = markdownText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  try {
    const parsed = YAML.parse(m[1]);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Extract heading TOC from markdown (used by Outline panel). */
export function extractToc(
  markdownText: string,
): Array<{ depth: number; text: string; id: string }> {
  const out: Array<{ depth: number; text: string; id: string }> = [];
  // Strip YAML / TOML frontmatter before parsing so it never appears in the
  // heading list (a top-level `---title:…---` block parses as a setext h2
  // when the frontmatter plugin isn't applied).
  const stripped = markdownText
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/m, "")
    .replace(/^\+\+\+\r?\n[\s\S]*?\r?\n\+\+\+\r?\n?/m, "");
  const tree = unified().use(remarkParse).parse(stripped) as MdastRoot;
  visit(tree, "heading", (node) => {
    const text = mdToString(node);
    if (!text.trim()) return;
    const id = slug(text);
    out.push({ depth: node.depth, text, id });
  });
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mdToString(node: any): string {
  if (typeof node?.value === "string") return node.value;
  if (Array.isArray(node?.children))
    return node.children.map(mdToString).join("");
  return "";
}
