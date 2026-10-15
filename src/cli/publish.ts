/**
 * `lumen publish` — render a folder of Markdown files to a static website.
 *
 *   lumen publish <dir|file> --out <dir>
 *
 * - Every `.md` / `.markdown` file becomes an `.html` page at the same relative
 *   path, rendered with the editor's own pipeline via `renderHtmlDocument`
 *   (the HTML export).
 * - Relative links to other Markdown files (`[x](notes/a.md#part)`) are
 *   rewritten to their `.html` counterparts; external links are untouched.
 * - Every other file (images, PDFs, …) is copied verbatim, so relative asset
 *   references keep working.
 * - `index.html` lists every page. If the source has its own root `index.md`,
 *   that page becomes `index.html` with the page list appended to it.
 * - Hidden entries, `node_modules`, and the output folder itself are skipped.
 *
 * Node-only (uses node:fs); bin/lumen.ts is the thin argv wrapper.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { renderHtmlDocument, escapeHtml } from "../storage/exportHtml";

const MD_RE = /\.(md|markdown)$/i;

export interface PublishPage {
  /** Source path relative to the input root, POSIX separators. */
  source: string;
  /** Output path relative to the out dir, POSIX separators. */
  output: string;
  title: string;
}

export interface PublishResult {
  pages: PublishPage[];
  /** Non-Markdown files copied verbatim (relative POSIX paths). */
  assets: string[];
  /** Absolute path of the written index.html. */
  index: string;
}

/** Minimal stylesheet: the app's CSS variables are absent outside Lumen. */
export const PUBLISH_CSS = [
  ":root{--bg:0 0% 100%;--fg:240 10% 12%;--fg-muted:240 5% 45%;--border:240 6% 88%;--accent:252 92% 66%;color-scheme:light dark}",
  "@media (prefers-color-scheme:dark){:root{--bg:240 10% 8%;--fg:240 5% 92%;--fg-muted:240 5% 62%;--border:240 6% 22%}}",
  "*{box-sizing:border-box}",
  "body{font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
  "a{color:hsl(var(--accent))}",
  ".lumen-site-nav{max-width:760px;margin:0 auto 1.5rem;font-size:14px;display:flex;gap:12px;color:hsl(var(--fg-muted))}",
  "h1,h2,h3{line-height:1.25}",
  "img{max-width:100%}",
  "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}",
  "pre{padding:14px 16px;border-radius:8px;overflow:auto;border:1px solid hsl(var(--border))}",
  ".code-block-header button{display:none}",
  "table{border-collapse:collapse}th,td{border:1px solid hsl(var(--border));padding:6px 10px}",
  "blockquote{margin:0;padding-left:1em;border-left:3px solid hsl(var(--border));color:hsl(var(--fg-muted))}",
  ".lumen-site-pages{list-style:none;padding:0}.lumen-site-pages li{padding:6px 0;border-bottom:1px solid hsl(var(--border))}",
  ".lumen-site-pages small{color:hsl(var(--fg-muted));margin-left:8px}",
].join("\n");

const toPosix = (p: string) => p.split(sep).join("/");

/** Rewrite relative `href="….md(#frag)"` links in rendered HTML to `.html`. */
export function rewriteMarkdownLinks(html: string): string {
  return html.replace(/(\shref=")([^"]*)"/g, (whole, pre: string, href: string) => {
    // Leave absolute URLs (scheme:, //host, /root) and pure fragments alone.
    if (/^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(href)) return whole;
    const m = /^([^?#]*?)\.(md|markdown)((?:[?#].*)?)$/i.exec(href);
    if (!m) return whole;
    return `${pre}${m[1]}.html${m[3]}"`;
  });
}

/** Page title: frontmatter `title:`, else first H1, else the file name. */
export function pageTitle(md: string, fileName: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const fmTitle = fm && /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1]);
  if (fmTitle) return fmTitle[1].trim();
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(md.replace(/^---\r?\n[\s\S]*?\r?\n---/, ""));
  if (h1) return h1[1].replace(/[*_`]/g, "").trim();
  return basename(fileName).replace(MD_RE, "");
}

function walk(root: string, skip: string, out: string[] = [], dir = root): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
    const full = join(dir, ent.name);
    if (resolve(full) === skip) continue;
    if (ent.isDirectory()) walk(root, skip, out, full);
    else if (ent.isFile()) out.push(full);
  }
  return out;
}

/** Insert markup just before the document's (last) closing </main>. */
function appendToMain(html: string, markup: string): string {
  const at = html.lastIndexOf("</main>");
  return at < 0 ? html + markup : `${html.slice(0, at)}${markup}\n${html.slice(at)}`;
}

function pageList(pages: PublishPage[], hrefPrefix = ""): string {
  const items = pages
    .map((p) => {
      const sub = dirname(p.output) === "." ? "" : `<small>${escapeHtml(dirname(p.output))}/</small>`;
      return `<li><a href="${escapeHtml(hrefPrefix + p.output)}">${escapeHtml(p.title)}</a>${sub}</li>`;
    })
    .join("\n");
  return `<ul class="lumen-site-pages">\n${items}\n</ul>`;
}

/** Publish `input` (a folder or a single .md file) as a static site in `outDir`. */
export async function publishSite(
  input: string,
  outDir: string,
  opts: { siteTitle?: string } = {},
): Promise<PublishResult> {
  const inAbs = resolve(input);
  const outAbs = resolve(outDir);
  const st = statSync(inAbs);
  const root = st.isDirectory() ? inAbs : dirname(inAbs);
  const files = st.isDirectory() ? walk(root, outAbs).sort() : [inAbs];
  const siteTitle = opts.siteTitle ?? basename(root);

  mkdirSync(outAbs, { recursive: true });
  writeFileSync(join(outAbs, "style.css"), PUBLISH_CSS);

  const mdFiles = files.filter((f) => MD_RE.test(f));
  const assets = files.filter((f) => !MD_RE.test(f));

  const pages: (PublishPage & { md: string })[] = mdFiles.map((f) => {
    const rel = toPosix(relative(root, f));
    const md = readFileSync(f, "utf8");
    return { source: rel, output: rel.replace(MD_RE, ".html"), title: pageTitle(md, rel), md };
  });
  const rootIndex = pages.find((p) => p.output.toLowerCase() === "index.html");
  const listed = pages
    .filter((p) => p !== rootIndex)
    .sort((a, b) => a.output.localeCompare(b.output));

  for (const p of pages) {
    const depth = p.output.split("/").length - 1;
    const up = "../".repeat(depth);
    const isIndex = p === rootIndex;
    const nav = isIndex
      ? ""
      : `<nav class="lumen-site-nav"><a href="${up}index.html">← ${escapeHtml(siteTitle)}</a></nav>\n`;
    let html = await renderHtmlDocument(p.md, {
      title: isIndex ? siteTitle : `${p.title} — ${siteTitle}`,
      head: `\n<link rel="stylesheet" href="${up}style.css" />`,
      before: nav,
    });
    html = rewriteMarkdownLinks(html);
    if (isIndex && listed.length) {
      html = appendToMain(html, pageList(listed));
    }
    const target = join(outAbs, ...p.output.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html);
  }

  if (!rootIndex) {
    const body =
      `<h1>${escapeHtml(siteTitle)}</h1>\n` +
      (listed.length ? pageList(listed) : "<p>No pages.</p>");
    const html = await renderHtmlDocument("", {
      title: siteTitle,
      head: `\n<link rel="stylesheet" href="style.css" />`,
    });
    writeFileSync(join(outAbs, "index.html"), appendToMain(html, body));
  }

  const assetRels: string[] = [];
  for (const a of assets) {
    const rel = toPosix(relative(root, a));
    const target = join(outAbs, ...rel.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(a, target);
    assetRels.push(rel);
  }

  return {
    pages: pages.map(({ source, output, title }) => ({ source, output, title })),
    assets: assetRels,
    index: join(outAbs, "index.html"),
  };
}
