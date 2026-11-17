#!/usr/bin/env node
/**
 * Accessibility of the docs pages (plan W13.D5), in a real Chromium.
 *
 *   node scripts/docs-a11y-content.mjs                 offline: the Markdown of the 30 pages of
 *                                                      docs/a11y-pages.json, rendered to HTML (remark)
 *                                                      inside a docs-like shell (lang, dir, sidebar,
 *                                                      table of contents laid out with logical CSS)
 *   node scripts/docs-a11y-content.mjs --site docs/dist   the built site (after npm run docs:build)
 *
 * On every page: axe (WCAG 2.0/2.1 A + AA) has no serious or critical
 * violation; on a Hebrew page the document is dir="rtl" and the sidebar
 * sits on the right of the content, the table of contents on its left.
 * Exit 1 on any problem. Prints one line per page and a summary.
 *
 * The offline run checks what the pages' own Markdown decides (headings,
 * link text, tables, image text, language and direction); the Lighthouse
 * score of the built site is scripts/lighthouse-a11y.mjs --site docs.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(ROOT, "package.json"));
const DOCS = join(ROOT, "docs/src/content/docs");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const VOID = new Set(["br", "hr", "img", "input", "meta", "link"]);
/** hast → HTML (enough for Markdown output). */
export function toHtml(node) {
  if (node.type === "root") return node.children.map(toHtml).join("");
  if (node.type === "text") return esc(node.value);
  if (node.type === "raw") return node.value;
  if (node.type !== "element") return "";
  const attrs = Object.entries(node.properties ?? {})
    .filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => {
      const name = k === "className" ? "class" : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return v === true ? ` ${name}` : ` ${name}="${esc(Array.isArray(v) ? v.join(" ") : v)}"`;
    })
    .join("");
  if (VOID.has(node.tagName)) return `<${node.tagName}${attrs}>`;
  return `<${node.tagName}${attrs}>${(node.children ?? []).map(toHtml).join("")}</${node.tagName}>`;
}

function frontAndBody(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const title = m ? (/^title:\s*(.*)$/m.exec(m[1])?.[1] ?? "").replace(/^["']|["']$/g, "") : "";
  let body = m ? text.slice(m[0].length) : text;
  // MDX: imports and components are the site's, not the page's content.
  body = body.replace(/^(import|export)\s.*$/gm, "").replace(/<\/?[A-Z][\w.]*[^>]*>/g, "");
  return { title, body };
}

/** The page as HTML in a docs-like shell (what Starlight gives: lang, dir, landmarks, a sidebar and a table of contents). */
export async function renderPage(rel) {
  // markdown-it (GFM tables, raw HTML), from this checkout or the machine's tools.
  const MarkdownIt = req(req.resolve("markdown-it", { paths: [ROOT, "/opt/npm-tools/node_modules"] }));
  const { title, body } = frontAndBody(readFileSync(join(DOCS, rel), "utf8"));
  const he = rel.startsWith("he/");
  // Starlight asides (:::note … :::) as <aside>, as the site renders them.
  const asides = body.replace(/^:::(\w+)[^\n]*\n([\s\S]*?)^:::\s*$/gm, (_m, kind, inner) => `<aside aria-label="${kind}">\n\n${inner}\n</aside>\n`);
  let html = new MarkdownIt({ html: true, linkify: false }).render(asides);
  // Code blocks scroll sideways: focusable, as Expressive Code (Starlight's code blocks) makes them.
  html = html.replace(/<pre>/g, '<pre tabindex="0">');
  // Headings in the page start at h2 (the title is the h1); ids for the table of contents.
  const toc = [];
  let n = 0;
  html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_m, lvl, inner) => {
    const id = `h-${++n}`;
    if (lvl === "2") toc.push({ id, text: inner.replace(/<[^>]+>/g, "") });
    return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
  });
  const L = he ? { nav: "ניווט ראשי", toc: "בעמוד הזה", skip: "דילוג לתוכן" } : { nav: "Main", toc: "On this page", skip: "Skip to content" };
  return `<!doctype html><html lang="${he ? "he" : "en"}" dir="${he ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title>
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;color:#111;background:#fff;display:grid;grid-template-columns:220px 1fr 200px;gap:24px}
nav.sidebar{grid-column:1;padding-inline:12px;border-inline-end:1px solid #ccc}main{grid-column:2;min-width:0}aside.toc{grid-column:3}
a{color:#0645ad}code,pre{background:#f3f3f3;color:#111}pre{overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px}
.skip{position:absolute;inset-inline-start:-999px}.skip:focus{inset-inline-start:8px}</style></head>
<body><a class="skip" href="#main">${L.skip}</a><nav class="sidebar" aria-label="${L.nav}"><ul><li><a href="#">${he ? "צעדים ראשונים" : "Getting started"}</a></li><li><a href="#">${he ? "עורך" : "Editor"}</a></li></ul></nav>
<main id="main" tabindex="-1"><h1>${esc(title)}</h1>${html}</main>
<aside class="toc" aria-label="${L.toc}"><h2>${L.toc}</h2><ul>${toc.map((t) => `<li><a href="#${t.id}">${t.text}</a></li>`).join("")}</ul></aside></body></html>`;
}

async function check(pageUrls, open) {
  const { chromium } = req(req.resolve("playwright", { paths: [ROOT, "/opt/npm-tools/node_modules"] }));
  const axePath = [join(ROOT, "node_modules/axe-core/axe.min.js")].find(existsSync);
  const browser = await chromium.launch();
  const problems = [];
  for (const { rel, url } of pageUrls) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    await open(page, rel, url);
    await page.addScriptTag({ path: axePath });
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })).violations.filter((x) => x.impact === "serious" || x.impact === "critical").map((x) => `${x.id}(${x.nodes.length}: ${x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")})`));
    const geo = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
      const nav = box("nav") ?? box("[aria-label]");
      const main = box("main");
      const toc = box("aside.toc, starlight-toc, .right-sidebar");
      return { dir: document.documentElement.dir, lang: document.documentElement.lang, navX: nav?.x ?? null, mainX: main?.x ?? null, tocX: toc?.x ?? null };
    });
    const he = rel.startsWith("he/");
    const errs = [...v];
    if (he && geo.dir !== "rtl") errs.push(`dir is "${geo.dir}", not rtl`);
    if (he && geo.navX !== null && geo.mainX !== null && !(geo.navX > geo.mainX)) errs.push("sidebar is not on the right in RTL");
    if (he && geo.tocX !== null && geo.mainX !== null && !(geo.tocX < geo.mainX)) errs.push("table of contents is not on the left in RTL");
    if (!he && geo.navX !== null && geo.mainX !== null && !(geo.navX < geo.mainX)) errs.push("sidebar is not on the left in LTR");
    console.log(`${errs.length ? "✗" : "✓"} ${rel}${errs.length ? `  — ${errs.join("; ")}` : ""}`);
    if (errs.length) problems.push(rel);
    await page.close();
  }
  await browser.close();
  return problems;
}

async function main(argv) {
  const list = JSON.parse(readFileSync(join(ROOT, "docs/a11y-pages.json"), "utf8")).pages;
  const site = argv.includes("--site") ? resolve(ROOT, argv[argv.indexOf("--site") + 1]) : null;
  let problems;
  if (site) {
    const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
    const srv = createServer((q, r) => {
      let f = join(site, decodeURIComponent(new URL(q.url, "http://x").pathname));
      if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
      if (!f.startsWith(site) || !existsSync(f)) return r.writeHead(404).end();
      r.writeHead(200, { "content-type": T[extname(f)] ?? "application/octet-stream" }).end(readFileSync(f));
    });
    await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
    const base = `http://127.0.0.1:${srv.address().port}/`;
    problems = await check(list.map((rel) => ({ rel, url: base + rel.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "") + "/" })), (p, _rel, url) => p.goto(url));
    srv.close();
  } else {
    const rendered = new Map();
    for (const rel of list) rendered.set(rel, await renderPage(rel));
    problems = await check(list.map((rel) => ({ rel })), (p, rel) => p.setContent(rendered.get(rel)));
  }
  console.log(problems.length ? `✗ docs a11y: ${problems.length} of ${list.length} pages have problems` : `✓ docs a11y: ${list.length} pages, axe clean (serious/critical), Hebrew pages mirrored`);
  return problems.length ? 1 : 0;
}

if (import.meta.url.startsWith("file:") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => (process.exitCode = c));
