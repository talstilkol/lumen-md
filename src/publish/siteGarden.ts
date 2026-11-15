/**
 * W12.S5 — digital-garden features on the published site (plan 4.18):
 * backlinks on every page, a small local graph (a static SVG, no script),
 * tags with a page per tag, hover/focus previews of internal links, and
 * the page's own `lang`/`dir` from its text.
 *
 * Everything is computed from the rendered pages after links were
 * rewritten, so an edge exists only where the reader can actually click.
 * Pure string work: no DOM, no network.
 */
import { escapeHtml } from "../lib/escapeHtml";
import { encodePath } from "./siteLinks";

export interface GardenPage {
  output: string;
  title: string;
}

export interface GardenWords {
  backlinks: string;
  noBacklinks: string;
  graph: string;
  tags: string;
  taggedWith: string;
}

export const GARDEN_EN: GardenWords = { backlinks: "Linked from", noBacklinks: "No page links here yet.", graph: "Nearby pages", tags: "Tags", taggedWith: "Pages tagged {tag}" };
export const GARDEN_HE: GardenWords = { backlinks: "דפים שמקשרים לכאן", noBacklinks: "אף דף עדיין לא מקשר לכאן.", graph: "דפים קרובים", tags: "תגיות", taggedWith: "דפים עם התגית {tag}" };

function relHref(fromOutput: string, toOutput: string): string {
  const from = fromOutput.split("/").slice(0, -1);
  const to = toOutput.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return encodePath([...Array(from.length - common).fill(".."), ...to.slice(common)].join("/"));
}

function resolve(dir: string, rel: string): string | null {
  const parts = dir ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

/** The site pages a page's body links to (relative `.html` hrefs that exist), in order, without itself. */
export function outgoingLinks(html: string, fromOutput: string, outputs: ReadonlySet<string>): string[] {
  const body = /<main\b[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
  const dir = fromOutput.split("/").slice(0, -1).join("/");
  const out = new Set<string>();
  for (const m of body.matchAll(/<a\b[^>]*\shref="([^"#?]+\.html)(?:[?#][^"]*)?"/gi)) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(m[1])) continue;
    let p: string;
    try {
      p = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    const target = resolve(dir, p);
    if (target && target !== fromOutput && outputs.has(target)) out.add(target);
  }
  return [...out];
}

/** Every page's backlinks, from every page's outgoing links. */
export function backlinkMap(links: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
  const back = new Map<string, string[]>();
  for (const [from, tos] of links) for (const to of tos) back.set(to, [...(back.get(to) ?? []), from]);
  return back;
}

/** Tags of a note: frontmatter `tags:` (list or inline) and `#tags` in the text (not headings, code or URLs). */
export function noteTags(md: string): string[] {
  const tags = new Set<string>();
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (fm) {
    const inline = /^tags:[ \t]*\[(.*)\][ \t]*$/m.exec(fm[1]) ?? /^tags:[ \t]*([^\n[]+)$/m.exec(fm[1]);
    if (inline) for (const t of inline[1].split(/[,\s]+/)) if (t.replace(/^#|["']/g, "")) tags.add(t.replace(/^#|["']/g, ""));
    const list = /^tags:\s*\r?\n((?:\s+-\s+.+\r?\n?)+)/m.exec(fm[1]);
    if (list) for (const l of list[1].split(/\r?\n/)) if (l.trim()) tags.add(l.replace(/^\s+-\s+/, "").replace(/^#|["']/g, "").trim());
  }
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/g, " ");
  for (const m of body.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)) if (!/^\d+$/.test(m[1])) tags.add(m[1]);
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/** The output path of a tag's page. */
export const tagOutput = (tag: string) => `tags/${tag.replace(/[\\/:*?"<>|]+/g, "-")}.html`;

/** The language of a page's own text: Hebrew or Arabic letters outnumbering Latin ones. */
export function textLang(text: string, fallback: string): { lang: string; dir: "ltr" | "rtl" } {
  const he = (text.match(/[֐-׿]/g) ?? []).length;
  const ar = (text.match(/[؀-ۿ]/g) ?? []).length;
  const la = (text.match(/[A-Za-z]/g) ?? []).length;
  if (he > la && he >= ar) return { lang: "he", dir: "rtl" };
  if (ar > la) return { lang: "ar", dir: "rtl" };
  if (la > 0) return { lang: "en", dir: "ltr" };
  return { lang: fallback, dir: /^(he|ar|fa|ur|yi)\b/.test(fallback) ? "rtl" : "ltr" };
}

/**
 * A local graph: this page in the middle, the pages it links to and the
 * pages linking here around it (up to `max`), as a static SVG of links.
 * The backlinks list above it is the text alternative.
 */
export function localGraphSvg(output: string, neighbours: readonly GardenPage[], self: GardenPage, words: GardenWords, max = 12): string {
  const shown = neighbours.slice(0, max);
  const W = 280;
  const H = 200;
  const cx = W / 2;
  const cy = H / 2;
  const r = 72;
  const label = (s: string) => escapeHtml(s.length > 18 ? `${s.slice(0, 17)}…` : s);
  const nodes = shown.map((p, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, shown.length) - Math.PI / 2;
    return { p, x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) };
  });
  const lines = nodes.map((n) => `<line x1="${cx}" y1="${cy}" x2="${n.x}" y2="${n.y}" />`).join("");
  const dots = nodes
    .map((n) => `<a href="${escapeHtml(relHref(output, n.p.output))}"><title>${escapeHtml(n.p.title)}</title><circle cx="${n.x}" cy="${n.y}" r="6" /><text x="${n.x}" y="${n.y + 18}" text-anchor="middle">${label(n.p.title)}</text></a>`)
    .join("");
  return (
    `<figure class="lumen-garden-graph"><figcaption>${escapeHtml(words.graph)}</figcaption>` +
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="${escapeHtml(words.graph)}">` +
    `<g class="edges">${lines}</g><circle class="self" cx="${cx}" cy="${cy}" r="8"><title>${escapeHtml(self.title)}</title></circle>${dots}</svg></figure>`
  );
}

/** The garden block under a page's text: tags, backlinks, local graph. */
export function gardenBlock(
  page: GardenPage,
  opts: { backlinks: readonly GardenPage[]; outgoing: readonly GardenPage[]; tags: readonly string[]; words: GardenWords },
): string {
  const { words } = opts;
  const tags = opts.tags.length
    ? `<nav class="lumen-garden-tags" aria-label="${escapeHtml(words.tags)}"><ul>${opts.tags
        .map((t) => `<li><a href="${escapeHtml(relHref(page.output, tagOutput(t)))}" rel="tag">#${escapeHtml(t)}</a></li>`)
        .join("")}</ul></nav>`
    : "";
  const back = opts.backlinks.length
    ? `<ul>${opts.backlinks.map((b) => `<li><a href="${escapeHtml(relHref(page.output, b.output))}">${escapeHtml(b.title)}</a></li>`).join("")}</ul>`
    : `<p>${escapeHtml(words.noBacklinks)}</p>`;
  const seen = new Set<string>();
  const near = [...opts.backlinks, ...opts.outgoing].filter((p) => !seen.has(p.output) && seen.add(p.output));
  return (
    `<aside class="lumen-garden" aria-label="${escapeHtml(words.backlinks)}">${tags}` +
    `<section class="lumen-garden-backlinks"><h2>${escapeHtml(words.backlinks)}</h2>${back}</section>` +
    (near.length ? localGraphSvg(page.output, near, page, words) : "") +
    `</aside>`
  );
}

export const GARDEN_CSS = [
  ".lumen-garden{margin-top:2.5rem;padding-top:1rem;border-top:1px solid hsl(var(--border));font-size:14px}",
  ".lumen-garden h2{font-size:15px;margin:0 0 .5rem}",
  ".lumen-garden-tags ul{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:0 0 1rem}",
  ".lumen-garden-tags a{padding:2px 8px;border:1px solid hsl(var(--border));border-radius:999px;text-decoration:none}",
  ".lumen-garden-graph{margin:1rem 0 0}.lumen-garden-graph figcaption{font-weight:600;margin-bottom:4px}",
  ".lumen-garden-graph line{stroke:hsl(var(--border));stroke-width:1.5}.lumen-garden-graph circle{fill:hsl(var(--accent))}",
  ".lumen-garden-graph .self{fill:hsl(var(--fg))}.lumen-garden-graph text{font-size:10px;fill:hsl(var(--fg))}",
  ".lumen-garden-graph a:focus-visible circle{stroke:hsl(var(--fg));stroke-width:3}",
  ".lumen-site-preview{position:absolute;z-index:20;max-width:320px;padding:8px 10px;font-size:13px;background:hsl(var(--bg));color:hsl(var(--fg));border:1px solid hsl(var(--border));border-radius:8px;box-shadow:0 6px 24px rgb(0 0 0/.12)}",
].join("\n");

/**
 * Hover and focus previews: an internal link shows the first words of the
 * page it points to, from the site's own search index (no extra request
 * beyond it). The tooltip is tied to the link with aria-describedby and
 * Escape hides it.
 */
export const PREVIEW_JS = `(() => {
  const root = document.querySelector('meta[name="lumen-site-root"]')?.getAttribute("content") || "";
  const here = new URL(".", location.href);
  let data = null, tip = null, owner = null;
  // privacy-ledger: runs on the published site, not in the app; reads the site's own search-index.json from the same host (as search.js does), nothing else.
  const load = () => data || (data = fetch(root + "search-index.json").then((r) => r.json()).then((d) => new Map(d.map((e) => [new URL(root + e.p.split("/").map(encodeURIComponent).join("/"), here).pathname, e]))));
  const hide = () => { if (tip) tip.remove(); if (owner) owner.removeAttribute("aria-describedby"); tip = owner = null; };
  const show = async (a) => {
    const href = a.getAttribute("href") || "";
    if (/^([a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(href) || !/\\.html(?:[?#]|$)/i.test(href)) return;
    const e = (await load()).get(new URL(href, location.href).pathname);
    if (!e || owner === a) return;
    hide();
    tip = document.createElement("div");
    tip.className = "lumen-site-preview"; tip.id = "lumen-site-preview"; tip.setAttribute("role", "tooltip"); tip.dir = "auto";
    const b = document.createElement("strong"); b.textContent = e.t;
    const p = document.createElement("div"); p.textContent = e.x.length > 240 ? e.x.slice(0, 239) + "…" : e.x;
    tip.append(b, p);
    const r = a.getBoundingClientRect();
    tip.style.top = (window.scrollY + r.bottom + 6) + "px";
    tip.style.left = Math.max(8, window.scrollX + r.left) + "px";
    document.body.append(tip);
    owner = a; a.setAttribute("aria-describedby", tip.id);
  };
  const main = document.querySelector("main");
  if (!main) return;
  for (const ev of ["mouseover", "focusin"]) main.addEventListener(ev, (e) => { const a = e.target.closest && e.target.closest("a[href]"); if (a) void show(a); });
  for (const ev of ["mouseout", "focusout"]) main.addEventListener(ev, (e) => { if (owner && !owner.contains(e.relatedTarget)) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
})();
`;

export const tagPageMarkdown = (tag: string, pages: readonly GardenPage[], fromOutput: string, words: GardenWords): string =>
  `# ${words.taggedWith.replace("{tag}", `#${tag}`)}\n\n` +
  pages
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p) => `- [${p.title.replace(/[[\]\\]/g, "\\$&")}](${relHref(fromOutput, p.output)})`)
    .join("\n") +
  "\n";
