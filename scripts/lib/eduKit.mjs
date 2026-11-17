/**
 * The education kit (plan W11.P14): the offline pack's manifest rules and a
 * small Markdown → HTML for the teacher's PDF. Pure functions; the scripts
 * scripts/edu-offline-pack.mjs and scripts/edu-pdf.mjs do the files and the
 * browser.
 */

/** Problems with edu/offline-pack.json against models/registry.json. */
export function packProblems(pack, registry) {
  const out = [];
  if (pack?.format !== "lumen-edu-offline-pack/1") out.push("offline-pack.json: unknown format");
  const models = new Map((registry?.models ?? []).map((m) => [m.id, m]));
  const ids = new Set();
  for (const c of pack?.components ?? []) {
    if (ids.has(c.id)) out.push(`${c.id}: listed twice`);
    ids.add(c.id);
    if (!c.what?.he || !c.what?.en) out.push(`${c.id}: needs what.he and what.en`);
    if (!["installer", "repo", "models"].includes(c.from)) out.push(`${c.id}: from must be installer, repo or models`);
    for (const r of c.registry ?? []) {
      const m = models.get(r);
      if (!m) out.push(`${c.id}: ${r} is not in models/registry.json`);
      else if (m.class !== "allowed") out.push(`${c.id}: ${r} is ${m.class} in models/registry.json; only allowed models go on the drive`);
    }
    if (c.from !== "installer" && !(c.registry ?? []).length) out.push(`${c.id}: names no models/registry.json entry`);
  }
  if (!(pack?.components ?? []).some((c) => c.id === "installer" && c.required)) out.push("offline-pack.json: the installer must be required");
  return out;
}

/** HTML-escape. */
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code dir="ltr">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');

/** The Markdown the kit uses (front matter, headings, paragraphs, quotes, tables, lists) → an RTL HTML page. */
export function markdownToHtml(md, { lang = "he", title = "" } = {}) {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = body.split("\n");
  const html = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) {
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const [head, , ...rest] = rows;
      html.push(`<table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (l.startsWith(">")) {
      const q = [];
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""));
      i--;
      html.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
      continue;
    }
    if (/^[-*]\s/.test(l)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) items.push(lines[i++].replace(/^[-*]\s+/, ""));
      i--;
      html.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
      continue;
    }
    const p = [l];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\||>|[-*]\s)/.test(lines[i + 1])) p.push(lines[++i]);
    html.push(`<p>${inline(p.join(" "))}</p>`);
  }
  const dir = lang === "he" || lang === "ar" ? "rtl" : "ltr";
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4; margin: 16mm 14mm; }
body { font-family: "Noto Sans Hebrew", "Arial Hebrew", Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; }
h1 { font-size: 18pt; margin: 0 0 8pt; } h2 { font-size: 13pt; margin: 14pt 0 6pt; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; } th, td { border: 1px solid #999; padding: 4pt 5pt; vertical-align: top; text-align: start; }
th { background: #eee; } tr { break-inside: avoid; } code { font-size: 7.5pt; unicode-bidi: isolate; word-break: break-all; }
blockquote { margin: 8pt 0; padding: 6pt 10pt; border-inline-start: 3pt solid #b45309; background: #fff7ed; }
</style></head><body>${html.join("\n")}</body></html>`;
}

/** Every repository path the page cites (in `code`), for the test to check they exist. */
export function citedPaths(md) {
  return [...new Set([...md.matchAll(/`((?:docs|edu|store|src|scripts)\/[^`]+|TERMS\.md|LICENSE|PRIVACY\.md)`/g)].map((m) => m[1]))];
}
