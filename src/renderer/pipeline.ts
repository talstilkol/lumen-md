import { unified } from "unified";
import type { Processor } from "unified";
import type { ReactElement } from "react";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

// Inline remark-breaks plugin: converts single newlines in paragraphs to <br>.
function remarkBreaks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.children) {
        const next: any[] = [];
        for (const child of node.children) {
          if (child.type === "text" && child.value.includes("\n")) {
            const parts = child.value.split("\n");
            parts.forEach((part: string, i: number) => {
              if (part) next.push({ type: "text", value: part });
              if (i < parts.length - 1) next.push({ type: "break" });
            });
          } else {
            visit(child);
            next.push(child);
          }
        }
        node.children = next;
      }
    };
    visit(tree);
  };
}
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeReact from "rehype-react";
// Side-effect import: registers \ce{}/\pu{} macros on KaTeX
import "katex/contrib/mhchem";
import { visit } from "unist-util-visit";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import YAML from "yaml";
import type { Root as MdastRoot, Code } from "mdast";
import type { Root as HastRoot } from "hast";
import { components } from "./components";
import { rehypeShiki } from "./shiki";

const SPECIAL_LANGS = new Set([
  "mermaid",
  "chart",
  "csv",
  "tsv",
  "json-table",
  "insights",
  "jsonl",
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
  "live-glsl",
  "glsl-live",
  "glsl",
  "shader",
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
      else if (lang === "graphviz") tag = "lumen-dot";
      else if (lang === "puml") tag = "lumen-plantuml";
      else if (lang === "html-preview" || lang === "htmlpreview")
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
      else if (lang === "live-svg" || lang === "svg-live") tag = "lumen-livesvg";
      else if (lang === "live-glsl" || lang === "glsl-live" || lang === "glsl" || lang === "shader")
        tag = "lumen-liveglsl";
      else tag = `lumen-${lang}`;
      const data = (node.data ?? (node.data = {})) as Record<string, unknown>;
      data.hName = tag;
      data.hProperties = { lang, meta: node.meta ?? "" };
      data.hChildren = [{ type: "text", value: node.value ?? "" }];
    });
  };
}

/**
 * Convert `[[Page Name]]` and `[[target|label]]` text occurrences into
 * intra-document links. v1: target slug becomes the URL fragment, so clicking
 * jumps to a heading with that title. Workspace-aware behavior comes later.
 */
function remarkWikiLinks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(parent: any) {
    if (!parent || !Array.isArray(parent.children)) return;
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      if (
        child.type === "text" &&
        typeof child.value === "string" &&
        child.value.includes("[[")
      ) {
        const replacement = splitWikiText(child.value);
        if (replacement.length > 1) {
          parent.children.splice(i, 1, ...replacement);
          i += replacement.length - 1;
        }
      } else if (
        child.type !== "code" &&
        child.type !== "inlineCode" &&
        child.type !== "link" &&
        Array.isArray(child.children)
      ) {
        walk(child);
      }
    }
  }
  return (tree: MdastRoot) => walk(tree);
}

interface MdastTextLike {
  type: "text" | "link";
  value?: string;
  url?: string;
  title?: null;
  data?: { hProperties?: Record<string, unknown> };
  children?: { type: "text"; value: string }[];
}

function splitWikiText(value: string): MdastTextLike[] {
  const out: MdastTextLike[] = [];
  const re = /\[\[([^\]\r\n|]+?)(?:\|([^\]\r\n]+?))?\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) {
      out.push({ type: "text", value: value.slice(last, m.index) });
    }
    const target = m[1].trim();
    const label = (m[2] ?? target).trim();
    out.push({
      type: "link",
      url: `#${slug(target)}`,
      title: null,
      data: {
        hProperties: { className: ["wiki-link"], "data-wiki-target": target },
      },
      children: [{ type: "text", value: label }],
    });
    last = m.index + m[0].length;
  }
  if (last < value.length) {
    out.push({ type: "text", value: value.slice(last) });
  }
  return out;
}

/**
 * remark plugin: convert :::name container directives into admonitions.
 */
function remarkAdmonitions() {
  const known = new Set(["note", "tip", "info", "warning", "danger"]);
  // remark-directive nodes don't ship type defs in mdast — narrow locally.
  interface DirectiveNode {
    type: string;
    name: string;
    attributes?: Record<string, string | undefined> & { title?: string };
    data?: Record<string, unknown>;
    children?: unknown[];
  }
  return (tree: MdastRoot) => {
    visit(tree, (node) => {
      const n = node as unknown as DirectiveNode;
      if (
        n.type !== "containerDirective" &&
        n.type !== "leafDirective" &&
        n.type !== "textDirective"
      ) {
        return;
      }
      if (!known.has(n.name)) return;

      const data = (n.data ?? (n.data = {})) as Record<string, unknown>;
      data.hName = "div";
      data.hProperties = { className: ["admonition", n.name] };

      const titleText: string =
        (n.attributes && n.attributes.title) ??
        (n.name as string).charAt(0).toUpperCase() + (n.name as string).slice(1);

      const titleNode = {
        type: "paragraph",
        data: {
          hName: "div",
          hProperties: { className: ["admonition-title"] },
        },
        children: [{ type: "text", value: titleText }],
      };
      n.children = [titleNode, ...(n.children ?? [])];
    });
  };
}

/**
 * remark plugin: render `:::columns{cols=N}` container directives as a
 * CSS grid. Each `:::` separator inside the column block delimits a
 * column; the children between separators become column contents.
 *
 *   :::columns{cols=3}
 *   First column body. Multiple paragraphs welcome.
 *   :::
 *   Second column body.
 *   :::
 *   Third column body.
 *   :::
 *
 * The number of columns defaults to the number of `:::`-separated
 * groups when `cols` isn't passed explicitly.
 *
 * Why a renderer-side directive instead of a ProseMirror NodeSpec:
 * markdown round-trip stays trivial (the source is just text), the
 * directive parses on every render so concurrent edits don't conflict
 * with collab, and we avoid pushing 200 lines of NodeSpec + serializer
 * into the WYSIWYG path. The cost: there's no inline editing of
 * individual columns in WYSIWYG — users edit the source.
 */
function remarkColumns() {
  interface DirectiveNode {
    type: string;
    name: string;
    attributes?: Record<string, string | undefined>;
    data?: Record<string, unknown>;
    children?: Array<{ type: string; data?: Record<string, unknown> }>;
  }
  return (tree: MdastRoot) => {
    visit(tree, (node) => {
      const n = node as unknown as DirectiveNode;
      if (n.type !== "containerDirective") return;
      if (n.name !== "columns") return;

      // Parse `cols=N` attr; fall back to number of children at top level.
      const colsAttr = n.attributes?.cols;
      const cols = colsAttr ? Math.max(1, Math.min(6, parseInt(colsAttr, 10) || 0)) : 0;

      const data = (n.data ?? (n.data = {})) as Record<string, unknown>;
      data.hName = "div";
      data.hProperties = {
        className: ["lumen-columns"],
        style: `display: grid; grid-template-columns: repeat(${
          cols || (n.children?.length ?? 1)
        }, 1fr); gap: 16px;`,
      };

      // Wrap each direct child in a `lumen-column` div so flexible
      // content (paragraphs, lists) renders inside its own grid cell.
      n.children = (n.children ?? []).map((child) => ({
        type: "paragraph",
        data: {
          hName: "div",
          hProperties: { className: ["lumen-column"] },
        },
        children: [child],
      }));
    });
  };
}

/**
 * remark plugin: strip the YAML frontmatter node (we surface it elsewhere).
 */
function remarkStripFrontmatter() {
  return (tree: MdastRoot) => {
    tree.children = tree.children.filter((c) => c.type !== "yaml");
  };
}

let processor: Processor<MdastRoot, MdastRoot, HastRoot, HastRoot, ReactElement> | null = null;

function getProcessor(isDark: () => boolean) {
  if (!processor) {
    processor = unified()
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
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
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
      } as unknown as Parameters<typeof rehypeReact>[0]) as unknown as Processor<MdastRoot, MdastRoot, HastRoot, HastRoot, ReactElement>;
  }
  return processor;
}

export async function renderMarkdown(
  markdownText: string,
  isDark: () => boolean,
): Promise<ReactElement> {
  const proc = getProcessor(isDark);
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

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
