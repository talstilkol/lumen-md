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
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  /**
   * Source files that were NOT written because their output path collides
   * with a generated file (a page, the index or style.css). Generated
   * targets always win so every Markdown page and the index survive.
   */
  skipped: { source: string; output: string; reason: string }[];
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

/**
 * Rewrite relative `href="….md(#frag)"` links in rendered HTML to `.html`.
 * `fromOutput` is the linking page's output path (e.g. `docs/a.html`): a
 * link that resolves to the site's root index — any casing, `INDEX.md`,
 * `Index.markdown` — becomes `index.html`, the name publication writes.
 */
export function rewriteMarkdownLinks(html: string, fromOutput = "index.html"): string {
  const fromDir = fromOutput.split("/").slice(0, -1);
  return html.replace(/(\shref=")([^"]*)"/g, (whole, pre: string, href: string) => {
    // Leave absolute URLs (scheme:, //host, /root) and pure fragments alone.
    if (/^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(href)) return whole;
    const m = /^([^?#]*?)\.(md|markdown)((?:[?#].*)?)$/i.exec(href);
    if (!m) return whole;
    let target = `${m[1]}.html`;
    // Resolve against the page's folder to spot the root index.
    const parts = [...fromDir];
    for (const seg of m[1].split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== "." && seg !== "") parts.push(seg);
    }
    if (parts.length === 1 && parts[0].toLowerCase() === "index") {
      target = m[1].replace(/[^/]+$/, "index") + ".html";
    }
    return `${pre}${target}${m[3]}"`;
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
      return `<li><a href="${escapeHtml(hrefPrefix + encodePath(p.output))}">${escapeHtml(p.title)}</a>${sub}</li>`;
    })
    .join("\n");
  return `<ul class="lumen-site-pages">\n${items}\n</ul>`;
}

/** Percent-encode each segment of a relative output path for use in an href (`FAQ #1.html` → `FAQ%20%231.html`). */
export function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

/** Records what the last publish wrote, so a republish can remove it first. */
export const PUBLISH_MANIFEST = ".lumen-publish.json";

/**
 * Remove the files a previous publish into `outAbs` wrote (per its
 * manifest) and the folders they leave empty. Only listed files are
 * touched — anything else in the folder is left alone — so a page or
 * asset that was removed or changed shape (a `guide.html/` folder that is
 * now a page) can't linger or block the new write.
 */
export function clearPreviousPublish(outAbs: string): void {
  let listed: unknown;
  try {
    listed = (JSON.parse(readFileSync(join(outAbs, PUBLISH_MANIFEST), "utf8")) as { files?: unknown }).files;
  } catch {
    return; // no (readable) manifest: nothing we know we wrote
  }
  if (!Array.isArray(listed)) return;
  const dirs = new Set<string>();
  for (const rel of listed) {
    if (typeof rel !== "string" || !rel) continue;
    const target = resolve(outAbs, ...rel.split("/"));
    const r = relative(outAbs, target);
    if (!r || r.startsWith("..") || isAbsolute(r)) continue; // never outside the output folder
    // Every folder between the output root and the file must be a real
    // directory: a symlinked one would make unlink delete a file outside.
    if (!realDirsBetween(outAbs, target)) continue;
    try {
      if (!lstatSync(target).isFile()) continue;
      unlinkSync(target);
    } catch {
      continue;
    }
    for (let d = dirname(target); d !== outAbs && relative(outAbs, d) && !relative(outAbs, d).startsWith(".."); d = dirname(d)) {
      dirs.add(d);
    }
  }
  // Deepest first, so a parent is empty by the time it's checked.
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      if (readdirSync(d).length === 0) rmdirSync(d);
    } catch {
      /* already gone or not empty */
    }
  }
}

/** True when each path component strictly between `root` and `target` is a real directory (not a symlink). */
function realDirsBetween(root: string, target: string): boolean {
  const parts = relative(root, target).split(sep).slice(0, -1);
  let cur = root;
  for (const part of parts) {
    cur = join(cur, part);
    try {
      const st = lstatSync(cur);
      if (st.isSymbolicLink() || !st.isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
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
  // Writing into the source folder (or one of its ancestors) would overwrite
  // source files -- style.css, hand-written .html -- with no way to restore
  // them. An output folder *inside* the source is fine: walk() skips it.
  const rel = relative(outAbs, root);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error(
      `Refusing to publish into ${outAbs}: it is the source folder or contains it. Choose a separate --out folder.`,
    );
  }
  const files = st.isDirectory() ? walk(root, outAbs).sort() : [inAbs];
  const siteTitle = opts.siteTitle ?? basename(root);

  mkdirSync(outAbs, { recursive: true });
  clearPreviousPublish(outAbs);
  writeFileSync(join(outAbs, "style.css"), PUBLISH_CSS);

  const mdFiles = files.filter((f) => MD_RE.test(f));
  const assets = files.filter((f) => !MD_RE.test(f));

  const skipped: PublishResult["skipped"] = [];
  // Output paths are compared case-insensitively: on macOS/Windows file
  // systems `Guide.html` and `guide.html` are the same file.
  const key = (p: string) => p.toLowerCase();
  // Files we will write, and the directories their paths need. A new path
  // collides with a reserved file at the same path, with a reserved file
  // standing where one of its ancestor directories must go (`guide.html`
  // vs `guide.html/img.png`), or with a directory a reserved file needs.
  const reserved = new Map<string, string>();
  const reservedDirs = new Map<string, string>();
  const ancestors = (p: string) => {
    const parts = key(p).split("/");
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
  };
  const collision = (p: string): string | undefined =>
    reserved.get(key(p)) ??
    reservedDirs.get(key(p)) ??
    ancestors(p).map((a) => reserved.get(a)).find(Boolean);
  const reserve = (p: string, what: string) => {
    reserved.set(key(p), what);
    for (const a of ancestors(p)) if (!reservedDirs.has(a)) reservedDirs.set(a, `a folder needed by ${what}`);
  };
  reserve("style.css", "the site stylesheet");

  const pages: (PublishPage & { md: string })[] = [];
  for (const f of mdFiles) {
    const rel = toPosix(relative(root, f));
    let output = rel.replace(MD_RE, ".html");
    // The root index is always written as lowercase index.html — the name
    // the navigation links and PublishResult.index use on case-sensitive
    // hosts too.
    if (output.toLowerCase() === "index.html") output = "index.html";
    const taken = collision(output);
    if (taken) {
      skipped.push({ source: rel, output, reason: `collides with ${taken}` });
      continue;
    }
    reserve(output, `the page generated from ${rel}`);
    const md = readFileSync(f, "utf8");
    pages.push({ source: rel, output, title: pageTitle(md, rel), md });
  }
  if (!reserved.has(key("index.html"))) reserve("index.html", "the generated page index");
  const rootIndex = pages.find((p) => p.output === "index.html");
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
    html = rewriteMarkdownLinks(html, p.output);
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
    const taken = collision(rel);
    if (taken) {
      skipped.push({ source: rel, output: rel, reason: `collides with ${taken}` });
      continue;
    }
    reserve(rel, `the asset ${rel}`);
    const target = join(outAbs, ...rel.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(a, target);
    assetRels.push(rel);
  }

  writeFileSync(
    join(outAbs, PUBLISH_MANIFEST),
    JSON.stringify(
      { files: ["style.css", "index.html", ...pages.map((p) => p.output), ...assetRels].filter((f, i, a) => a.indexOf(f) === i) },
      null,
      2,
    ) + "\n",
  );

  return {
    pages: pages.map(({ source, output, title }) => ({ source, output, title })),
    assets: assetRels,
    index: join(outAbs, "index.html"),
    skipped,
  };
}
