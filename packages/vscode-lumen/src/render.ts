/**
 * Markdown → HTML for the Lumen preview webview. No `vscode` import, so the
 * root vitest suite can test it directly.
 *
 * Reuse strategy: Lumen's app pipeline (src/renderer/pipeline.ts) ends in
 * rehype-react with ~30 lazily-loaded React block components (ECharts,
 * Leaflet, Pyodide, …) and Shiki — far too heavy and browser-bound for a
 * webview that only needs static HTML. Instead we share the SAME remark
 * dialect (src/renderer/remarkLumen.ts: callouts, columns, wikilinks, soft
 * breaks) and the same unified plugin chain (GFM, math, frontmatter,
 * directives), then stringify with hast-util-to-html. Math is rendered to
 * HTML by KaTeX at build time; ```mermaid fences become
 * `<pre class="mermaid">` that the webview's bundled mermaid renders.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import { toHtml } from "hast-util-to-html";
import { visit } from "unist-util-visit";
import type { Root as MdastRoot, Code, Html } from "mdast";
import type { Root as HastRoot, Element } from "hast";
import {
  remarkBreaks,
  remarkWikiLinks,
  remarkAdmonitions,
  remarkColumns,
  remarkStripFrontmatter,
} from "../../../src/renderer/remarkLumen";

/** GitHub-style `> [!NOTE]` alerts → Lumen admonitions (same CSS classes). */
const GH_ALERTS: Record<string, string> = {
  NOTE: "note",
  TIP: "tip",
  IMPORTANT: "info",
  WARNING: "warning",
  CAUTION: "danger",
};

function remarkGithubAlerts() {
  return (tree: MdastRoot) => {
    visit(tree, "blockquote", (node) => {
      const first = node.children[0];
      if (first?.type !== "paragraph") return;
      const text = first.children[0];
      if (text?.type !== "text") return;
      const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i.exec(text.value);
      if (!m) return;
      const kind = m[1].toUpperCase();
      text.value = text.value.slice(m[0].length);
      if (!text.value) first.children.shift();
      if (!first.children.length) node.children.shift();
      const data = (node.data ?? (node.data = {})) as Record<string, unknown>;
      data.hName = "div";
      data.hProperties = { className: ["admonition", GH_ALERTS[kind]] };
      node.children.unshift({
        type: "paragraph",
        data: { hName: "div", hProperties: { className: ["admonition-title"] } },
        children: [{ type: "text", value: kind.charAt(0) + kind.slice(1).toLowerCase() }],
      } as never);
    });
  };
}

/**
 * Lumen's interactive fences (charts, live code, maps…) need the app. In the
 * preview they stay readable as code, labelled so the reader knows Lumen
 * renders them richer. Mermaid is handled for real.
 */
const LUMEN_ONLY_LANGS = new Set([
  "chart", "csv", "tsv", "json-table", "insights", "jsonl", "map", "geojson",
  "dot", "graphviz", "abc", "model", "plantuml", "puml", "embed", "htmlpreview",
  "html-preview", "bibtex", "bib", "database", "live-css", "live-js", "live-svg",
  "live-glsl", "live-python", "live-py", "live-sql", "live-lua", "code-doctor",
]);

function remarkFences() {
  return (tree: MdastRoot) => {
    visit(tree, "code", (node: Code, index, parent) => {
      const lang = (node.lang ?? "").toLowerCase();
      if (lang === "mermaid" && parent && index !== undefined) {
        // remark-rehype's `code` handler always wraps in its own <pre>, so
        // swap in a custom node it converts from `data` alone.
        parent.children[index] = {
          type: "lumenMermaid",
          data: {
            hName: "pre",
            hProperties: { className: ["mermaid"] },
            hChildren: [{ type: "text", value: node.value }],
          },
        } as never;
        return;
      }
      if (LUMEN_ONLY_LANGS.has(lang) && parent && index !== undefined) {
        const label: Html = {
          type: "html",
          value: `<div class="lumen-block-label">${lang} — interactive in Lumen</div>`,
        };
        parent.children.splice(index, 0, label);
        return index + 2;
      }
    });
  };
}

/** Mark `language-xxx` code blocks so the webview's CSS can style them. */
function rehypeCodeLang() {
  return (tree: HastRoot) => {
    visit(tree, "element", (el: Element) => {
      if (el.tagName !== "pre") return;
      const code = el.children[0];
      if (code?.type !== "element" || code.tagName !== "code") return;
      const cls = (code.properties?.className as string[] | undefined)?.find((c) => c.startsWith("language-"));
      if (cls) el.properties = { ...el.properties, dataLang: cls.slice("language-".length) };
    });
  };
}

/**
 * Drop raw HTML from the source: the webview's CSP blocks inline scripts
 * anyway, but stripping it also stops `<style>`/`<iframe>` injection.
 */
function remarkDropRawHtml() {
  return (tree: MdastRoot) => {
    // Runs before remarkFences, so only user-authored HTML is removed.
    visit(tree, "html", (_node: Html, index, parent) => {
      if (!parent || index === undefined) return;
      parent.children.splice(index, 1);
      return index;
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkStripFrontmatter)
  .use(remarkGfm)
  // Before remarkBreaks, which would split "[!TIP]\n…" into text + <br>.
  .use(remarkGithubAlerts)
  .use(remarkBreaks)
  .use(remarkMath)
  .use(remarkDirective)
  .use(remarkAdmonitions)
  .use(remarkColumns)
  .use(remarkWikiLinks)
  .use(remarkDropRawHtml)
  .use(remarkFences)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeSlug)
  .use(rehypeKatex, { throwOnError: false, strict: false })
  .use(rehypeCodeLang);

/** Render Markdown to an HTML fragment (the preview body). */
export function renderMarkdownBody(markdown: string): string {
  const mdast = processor.parse(markdown);
  const hast = processor.runSync(mdast) as HastRoot;
  return toHtml(hast, { allowDangerousHtml: true });
}

export interface PreviewDocumentOptions {
  /** Per-load nonce for the CSP `script-src`. */
  nonce: string;
  /** Webview CSP source (`webview.cspSource`). */
  cspSource: string;
  /** Webview URIs (as strings) for the bundled assets. */
  styleUri: string;
  katexCssUri: string;
  scriptUri: string;
  title: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Wrap a rendered body in the webview document (strict CSP, nonce'd script). */
export function renderPreviewDocument(markdown: string, opts: PreviewDocumentOptions): string {
  const body = renderMarkdownBody(markdown);
  const csp = [
    "default-src 'none'",
    `img-src ${opts.cspSource} https: data:`,
    `style-src ${opts.cspSource} 'unsafe-inline'`,
    `font-src ${opts.cspSource}`,
    `script-src 'nonce-${opts.nonce}'`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
<link rel="stylesheet" href="${escapeHtml(opts.katexCssUri)}" />
<link rel="stylesheet" href="${escapeHtml(opts.styleUri)}" />
</head>
<body>
<main class="lumen-preview" dir="auto">
${body}
</main>
<script nonce="${opts.nonce}" src="${escapeHtml(opts.scriptUri)}"></script>
</body>
</html>`;
}
