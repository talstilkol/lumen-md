import { headingSlugger } from "../lib/slug";
import { unified } from "unified";
import type { ReactElement } from "react";
import remarkParse from "remark-parse";
import rehypeSlug from "rehype-slug";
import { rehypeDirAuto } from "./rehypeDirAuto";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { visit } from "unist-util-visit";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import YAML from "yaml";
import type { Root as MdastRoot } from "mdast";
import type { Root as HastRoot } from "hast";
import { components } from "./components";
import { rehypeShiki } from "./shiki";
import { prepareCriticMarkup, rehypeCriticMarkup, stripCriticDelimiters } from "./criticMarkup";
import { buildBase, hasMath, hasRawHtml } from "./hastPipeline";

type RehypeKatex = typeof import("./katexPlugin").default;

let katexPromise: Promise<RehypeKatex> | null = null;

function loadKatex(): Promise<RehypeKatex> {
  if (!katexPromise) {
    katexPromise = import("./katexPlugin").then((m) => m.default);
    katexPromise.catch(() => {
      katexPromise = null; // allow a retry after a failed chunk fetch
    });
  }
  return katexPromise;
}

/** HAST → React elements with Lumen's block components (what rehype-react did at the end of the old pipeline). */
function hastToReact(hast: HastRoot): ReactElement {
  return toJsxRuntime(hast, { Fragment, jsx, jsxs, components } as unknown as Parameters<typeof toJsxRuntime>[1]) as ReactElement;
}

/**
 * The full preview render (plan 8.1): Markdown → HAST in the render
 * worker (parse, GFM, directives, wiki links, Lumen blocks, inline-HTML
 * sanitising, CriticMarkup, heading ids, block direction), then — still
 * on the main thread until step 3 — KaTeX and Shiki over that tree, and
 * HAST → React. Where no worker can run, the same HAST code runs here.
 */
export async function renderMarkdown(
  markdownText: string,
  isDark: () => boolean,
): Promise<ReactElement> {
  const math = hasMath(markdownText);
  const [{ renderHast }, rehypeKatex] = await Promise.all([import("./renderClient"), math ? loadKatex() : null]);
  const hast = await renderHast(markdownText, { raw: hasRawHtml(markdownText) });
  // The finishing passes run on the tree in place (unified's `run`).
  const finish = rehypeKatex ? unified().use(rehypeKatex).use(rehypeShiki, { isDark }) : unified().use(rehypeShiki, { isDark });
  await finish.run(hast);
  return hastToReact(hast);
}

/**
 * Synchronous first-paint render (A7 levers 1 + 3).
 *
 * Same remark tree and heading ids as `renderMarkdown`, minus everything
 * that needs a lazy chunk: no Shiki (code renders as plain `<pre>`), no
 * KaTeX (math shows as its TeX source), no rehype-raw (inline HTML is
 * dropped). Heavy blocks (mermaid, charts, maps…) render through the same
 * `components` map, whose wrappers only fetch their chunk once the block
 * scrolls near the viewport and the browser is idle — so this pass never
 * triggers a vendor import.
 */
let fastProcessor: ReturnType<typeof buildBase> | null = null;
export function renderMarkdownFast(markdownText: string): ReactElement {
  if (!fastProcessor) {
    fastProcessor = buildBase().use(rehypeCriticMarkup).use(rehypeSlug).use(rehypeDirAuto) as unknown as ReturnType<typeof buildBase>;
  }
  const tree = fastProcessor.parse(prepareCriticMarkup(markdownText));
  return hastToReact(fastProcessor.runSync(tree) as HastRoot);
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
  // CriticMarkup delimiters are dropped so ids match the rendered
  // headings, whose <ins>/<del>/<mark> text rehype-slug reads.
  const stripped = stripCriticDelimiters(markdownText)
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/m, "")
    .replace(/^\+\+\+\r?\n[\s\S]*?\r?\n\+\+\+\r?\n?/m, "");
  const tree = unified().use(remarkParse).parse(stripped) as MdastRoot;
  // One slugger for the whole document, like rehype-slug: a repeated
  // heading gets `-1`, `-2`… and Hebrew keeps its letters (T26).
  const slugger = headingSlugger();
  visit(tree, "heading", (node) => {
    const text = mdToString(node);
    if (!text.trim()) return;
    const id = slugger.slug(text);
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
