#!/usr/bin/env node
/**
 * W11.Q1 (research R5.5): a large vault built from real text, for the
 * large-vault benchmark (W11.Q2) and W2.22. It replaces vault-100k.ts's
 * 20-word synthetic notes for every claim about real-world size.
 *
 * Sources (none of them is committed; each is downloaded by this script and
 * checked against the sha256 pinned in corpus-sources.json):
 *   - Hebrew Wikipedia, pages-articles dump (CC BY-SA 4.0)    → about 2/3 of the notes
 *   - an English Wikipedia pages-articles part (CC BY-SA 4.0)  → the rest
 *   - Project Ben-Yehuda public_domain_dump (public domain)    → 200 long texts and
 *     5 notes of 1–2 MB (Obsidian's known 2 MB failure, R5 §1.1)
 *
 * What a note keeps: [[wiki links]] (as [[Target|label]], with the target
 * spelt as the target note's file name, so links resolve inside the vault),
 * categories as `tags`, the fields of the article's infobox as YAML
 * properties, headings, lists, bold/italic and external links. Templates,
 * tables, references, files and interlanguage links are dropped.
 *
 *   node scripts/perf/corpus-vault.mjs --notes 10000 --out /tmp/vault-10k \
 *     --hewiki <hewiki-…-pages-articles.xml[.bz2]> --enwiki <enwiki-…xml[.bz2]> \
 *     --benyehuda <public_domain_dump checkout>
 *   node scripts/perf/corpus-vault.mjs --fetch --cache ~/.cache/lumen-corpus --notes 100000 --out …
 *   node scripts/perf/corpus-vault.mjs --record-pins --fetch --cache …   # first run only (owner)
 *
 * `--docs <dir>` (instead of the dumps) builds a small vault from a folder of
 * real Markdown (this repo's docs); its origin is "derived-from-docs", not
 * "real", and the manifest says so. It exists so the harness can run in the
 * cloud, where the dumps cannot be downloaded.
 *
 * Output: <out>/he/*.md, <out>/en/*.md, <out>/benyehuda/*.md,
 * <out>/corpus-manifest.json (origin, sources with sha256 and attribution,
 * counts, links) and <out>/queries.json (50 queries taken from real article
 * titles, each with the note it must find). The same inputs give the same
 * bytes: there is no randomness.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const GENERATOR_VERSION = 1;
const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCES_FILE = join(HERE, "corpus-sources.json");

// ---------------------------------------------------------------- dump reading

const XML_ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export function xmlUnescape(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** One <page> element's fields (MediaWiki export schema 0.10/0.11). */
export function parsePage(xml) {
  const title = /<title>([\s\S]*?)<\/title>/.exec(xml);
  const ns = /<ns>(-?\d+)<\/ns>/.exec(xml);
  const text = /<text\b[^>]*?(?:\/>|>([\s\S]*?)<\/text>)/.exec(xml);
  return {
    title: title ? xmlUnescape(title[1]) : "",
    ns: ns ? Number(ns[1]) : 0,
    redirect: /<redirect\b/.test(xml),
    text: text && text[1] ? xmlUnescape(text[1]) : "",
  };
}

/**
 * The pages of a dump, from an async iterable of text chunks, one at a time
 * (a 1 GB dump is never held in memory). Stop early by breaking the loop.
 */
export async function* readPages(chunks) {
  let buf = "";
  for await (const chunk of chunks) {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (;;) {
      const start = buf.indexOf("<page>");
      if (start < 0) {
        buf = buf.slice(-8); // keep a partial "<page" tag
        break;
      }
      const end = buf.indexOf("</page>", start);
      if (end < 0) {
        buf = buf.slice(start);
        break;
      }
      yield parsePage(buf.slice(start, end + 7));
      buf = buf.slice(end + 7);
    }
  }
}

/** A dump file as text chunks; `.bz2` through `bzip2 -dc` (the dumps are bzip2). */
export function openDump(path) {
  if (!path.endsWith(".bz2")) return { chunks: createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 }), close() {} };
  const p = spawn("bzip2", ["-dc", path], { stdio: ["ignore", "pipe", "inherit"] });
  p.stdout.setEncoding("utf8");
  return {
    chunks: p.stdout,
    close() {
      p.stdout.destroy();
      p.kill();
    },
  };
}

// ---------------------------------------------------------- wikitext → markdown

/** Namespace prefixes whose links are not article links (he and en, with aliases). */
const FILE_NS = /^(file|image|media|קובץ|תמונה|מדיה)\s*:/i;
const CATEGORY_NS = /^(category|קטגוריה)\s*:/i;
const OTHER_NS = /^(wikipedia|wp|help|template|portal|user|talk|special|draft|module|ויקיפדיה|עזרה|תבנית|פורטל|משתמש|שיחה|מיוחד|טיוטה|יחידה|wikt|wiktionary|ויקימילון|s|q|n|b|v|commons|meta|mw)\s*:/i;
const INTERLANG = /^:?[a-z]{2,3}(-[a-z]+)?\s*:/;

/** A title as a note file name: what links must be spelt as, so they resolve. */
export function noteName(title, lang) {
  let t = title.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (lang === "en" && t) t = t[0].toUpperCase() + t.slice(1); // enwiki: the first letter is case-insensitive
  return t.replace(/[\\/:*?"<>|#^[\]]/g, "_").slice(0, 180);
}

/** Remove balanced `open … close` blocks, innermost first (templates, tables). */
function stripBalanced(s, open, close, keep) {
  for (let guard = 0; guard < 64; guard++) {
    let changed = false;
    s = s.replace(new RegExp(`${esc(open)}((?:(?!${esc(open)})(?!${esc(close)})[\\s\\S])*)${esc(close)}`, "g"), (_m, inner) => {
      changed = true;
      return keep ? keep(inner) : "";
    });
    if (!changed) break;
  }
  return s;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Top-level `{{…}}` templates of the text, with their start offsets. */
function topTemplates(s) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === "{" && s[i + 1] === "{") {
      if (depth === 0) start = i;
      depth++;
      i++;
    } else if (s[i] === "}" && s[i + 1] === "}" && depth > 0) {
      depth--;
      i++;
      if (depth === 0) out.push(s.slice(start, i + 1));
    }
  }
  return out;
}

/** Split a template body on top-level `|` (not inside [[…]] or {{…}}). */
function splitParams(body) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      cur += two;
      i++;
    } else if ((two === "}}" || two === "]]") && depth > 0) {
      depth--;
      cur += two;
      i++;
    } else if (body[i] === "|" && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += body[i];
  }
  parts.push(cur);
  return parts;
}

/** The value of an infobox field as plain text: links to their label, no markup. */
function plainValue(v) {
  let s = v.replace(/<ref\b[^>]*\/>/gi, "").replace(/<ref\b[\s\S]*?<\/ref>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  s = stripBalanced(s, "{{", "}}");
  s = s.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, (_m, _t, label) => label);
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1").replace(/'{2,}/g, "").replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, "");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The infobox: the first top-level template with at least three named fields
 * (hewiki infoboxes have Hebrew names, so the name alone does not tell).
 */
export function infobox(text) {
  for (const t of topTemplates(text)) {
    const params = splitParams(t.slice(2, -2));
    const named = [];
    for (const p of params.slice(1)) {
      const eq = p.indexOf("=");
      if (eq <= 0) continue;
      const key = p.slice(0, eq).trim();
      const value = plainValue(p.slice(eq + 1));
      if (key && value && !/[\n{}[\]]/.test(key)) named.push([key, value]);
    }
    if (named.length >= 3) return { template: params[0].trim(), fields: named.slice(0, 24) };
  }
  return null;
}

/** A YAML key: plain when safe, quoted otherwise. */
function yamlKey(k) {
  return /^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(k) && !/ $/.test(k) ? k : JSON.stringify(k);
}

/** A tag from a category name (no spaces in tags). */
export function categoryTag(name) {
  return name.split("|")[0].trim().replace(/\s+/g, "_").replace(/[#,[\]{}]/g, "");
}

/**
 * One article's wikitext as a Markdown note. `resolve(title)` gives the note
 * name a link target is written as.
 */
export function wikitextToMarkdown(title, wikitext, lang, resolve = (t) => noteName(t, lang)) {
  const box = infobox(wikitext);
  const tags = [];
  let s = wikitext.replace(/\r\n?/g, "\n");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<ref\b[^>]*\/>/gi, "").replace(/<ref\b[\s\S]*?<\/ref>/gi, "");
  s = s.replace(/<(gallery|math|score|timeline|syntaxhighlight|source|imagemap|templatedata)\b[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/__[A-Zא-ת]+__/g, "");
  s = stripBalanced(s, "{{", "}}");
  s = stripBalanced(s, "{|", "|}");
  // Links: categories → tags; files and other namespaces dropped; articles kept.
  s = stripFileLinks(s);
  s = s.replace(/\[\[([^\]]*)\]\]/g, (_m, body) => {
    const bar = body.indexOf("|");
    const target = (bar >= 0 ? body.slice(0, bar) : body).trim();
    const label = bar >= 0 ? body.slice(bar + 1).trim() : "";
    if (CATEGORY_NS.test(target)) {
      const t = categoryTag(target.replace(CATEGORY_NS, ""));
      if (t && !tags.includes(t)) tags.push(t);
      return "";
    }
    if (target.startsWith(":") && CATEGORY_NS.test(target.slice(1))) return label || target.slice(1).replace(CATEGORY_NS, "");
    if (OTHER_NS.test(target) || INTERLANG.test(target)) return label;
    if (!target) return label;
    const hash = target.indexOf("#");
    const page = hash >= 0 ? target.slice(0, hash) : target;
    const section = hash >= 0 ? target.slice(hash + 1).trim() : "";
    if (!page) return label || section; // a same-page section link
    const name = resolve(page);
    const shown = label || (section ? "" : page.trim() !== name ? page.trim() : "");
    return `[[${name}${section ? `#${section.replace(/[[\]|]/g, "")}` : ""}${shown ? `|${shown.replace(/[[\]|]/g, "")}` : ""}]]`;
  });
  s = s.replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, "[$2]($1)").replace(/\[(https?:\/\/[^\s\]]+)\]/g, "<$1>");
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(span|div|small|big|center|font|sup|sub|u|s|abbr|cite|blockquote|poem|code|nowiki|onlyinclude|includeonly|noinclude|p)\b[^>]*>/gi, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—");
  const lines = [];
  // List and heading markers are read before emphasis turns into `*`.
  const emphasis = (t) => t.replace(/'''''([^'\n]+?)'''''/g, "***$1***").replace(/'''([^'\n]+?)'''/g, "**$1**").replace(/''([^'\n]+?)''/g, "*$1*");
  for (const raw of s.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const h = /^(={1,6})\s*(.+?)\s*\1$/.exec(line);
    if (h) {
      lines.push("", `${"#".repeat(Math.min(6, h[1].length))} ${emphasis(h[2])}`, "");
      continue;
    }
    const li = /^([*#:;]+)\s*(.*)$/.exec(line);
    if (li) {
      const depth = li[1].length - 1;
      const kind = li[1][li[1].length - 1];
      const body = emphasis(li[2]);
      if (!body) continue;
      if (kind === "*") lines.push(`${"  ".repeat(depth)}- ${body}`);
      else if (kind === "#") lines.push(`${"   ".repeat(depth)}1. ${body}`);
      else if (kind === ";") lines.push(`**${body.replace(/\s*:\s*/, "**: ")}${body.includes(":") ? "" : "**"}`);
      else lines.push(`> ${body}`);
      continue;
    }
    if (/^-{4,}$/.test(line)) {
      lines.push("", "---", "");
      continue;
    }
    lines.push(emphasis(line.replace(/^\s+/, "")));
  }
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const fm = ["---", `title: ${JSON.stringify(title)}`, `lang: ${lang}`];
  if (tags.length) fm.push("tags:", ...tags.map((t) => `  - ${JSON.stringify(t)}`));
  if (box) {
    fm.push(`infobox: ${JSON.stringify(box.template)}`);
    const seen = new Set(["title", "lang", "tags", "infobox"]);
    for (const [k, v] of box.fields) {
      if (seen.has(k.toLowerCase())) continue;
      seen.add(k.toLowerCase());
      fm.push(`${yamlKey(k)}: ${JSON.stringify(v)}`);
    }
  }
  fm.push("---");
  return { markdown: `${fm.join("\n")}\n\n# ${title}\n\n${body}\n`, tags, infobox: box, body };
}

/** [[File:…|…[[nested]]…]] spans, removed whole (their captions hold nested links). */
function stripFileLinks(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const at = s.indexOf("[[", i);
    if (at < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, at);
    const head = s.slice(at + 2, at + 40);
    if (!FILE_NS.test(head)) {
      out += "[[";
      i = at + 2;
      continue;
    }
    let depth = 0;
    let j = at;
    for (; j < s.length - 1; j++) {
      if (s[j] === "[" && s[j + 1] === "[") {
        depth++;
        j++;
      } else if (s[j] === "]" && s[j + 1] === "]") {
        depth--;
        j++;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

// ------------------------------------------------------------------ Ben-Yehuda

/** The dump's catalogue (pseudocatalogue.csv): id, path, title, authors (RFC 4180 quoting). */
export function parseCatalogueCsv(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (q) {
      if (c === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  const [head, ...rest] = rows;
  const col = (n) => head.indexOf(n);
  return rest
    .filter((r) => r.length >= head.length - 1 && r[col("ID")])
    .map((r) => ({ id: r[col("ID")], path: r[col("path")], title: r[col("title")], authors: r[col("authors")], genre: r[col("genre")] }));
}

/** The works of a Ben-Yehuda checkout that have a text file, with their sizes. */
export function benYehudaWorks(dir) {
  const cat = parseCatalogueCsv(readFileSync(join(dir, "pseudocatalogue.csv"), "utf8"));
  const out = [];
  for (const w of cat) {
    const file = join(dir, "txt_stripped", `${w.path.replace(/^\//, "")}.txt`);
    if (!existsSync(file)) continue;
    out.push({ ...w, file, bytes: statSync(file).size });
  }
  return out;
}

/**
 * 200 long texts (the largest works, ties by id) and 5 notes of 1–2 MB: a
 * work that size on its own, else one author's works joined in catalogue
 * order until the note passes 1 MB (each part under its own heading). When
 * the checkout has too little text, fewer are made and `shortfall` says how
 * many are missing: nothing is padded.
 */
export function pickBenYehuda(works, { long = 200, huge = 5, hugeMin = 1_000_000, hugeMax = 2_000_000 } = {}) {
  const bySize = [...works].sort((a, b) => b.bytes - a.bytes || Number(a.id) - Number(b.id));
  const hugeNotes = [];
  const used = new Set();
  for (const w of bySize) {
    if (hugeNotes.length >= huge) break;
    if (w.bytes >= hugeMin && w.bytes <= hugeMax) {
      hugeNotes.push({ title: w.title, authors: w.authors, parts: [w] });
      used.add(w.id);
    }
  }
  if (hugeNotes.length < huge) {
    const byAuthor = new Map();
    for (const w of works) if (!used.has(w.id) && w.bytes < hugeMin) byAuthor.set(w.authors, [...(byAuthor.get(w.authors) ?? []), w]);
    const authors = [...byAuthor.entries()].map(([a, ws]) => [a, ws, ws.reduce((n, w) => n + w.bytes, 0)]).sort((x, y) => y[2] - x[2] || (x[0] < y[0] ? -1 : 1));
    for (const [author, ws, total] of authors) {
      if (hugeNotes.length >= huge || total < hugeMin) break;
      const parts = [];
      let size = 0;
      for (const w of ws) {
        if (size >= hugeMin) break;
        if (size + w.bytes > hugeMax) continue;
        parts.push(w);
        size += w.bytes;
      }
      if (size < hugeMin) continue;
      for (const w of parts) used.add(w.id);
      hugeNotes.push({ title: `${author} — כתבים`, authors: author, parts });
    }
  }
  const longNotes = bySize.filter((w) => !used.has(w.id)).slice(0, long);
  return { long: longNotes, huge: hugeNotes, shortfall: { long: long - longNotes.length, huge: huge - hugeNotes.length } };
}

function benYehudaNote(title, authors, parts, readText) {
  const fm = ["---", `title: ${JSON.stringify(title)}`, "lang: he", `authors: ${JSON.stringify(authors)}`, `source: ${JSON.stringify("Project Ben-Yehuda (public domain)")}`, `benyehuda_ids: ${JSON.stringify(parts.map((p) => p.id))}`, "tags:", '  - "בן-יהודה"'];
  fm.push("---");
  const body = parts.length === 1 ? readText(parts[0]).trim() : parts.map((p) => `## ${p.title}\n\n${readText(p).trim()}`).join("\n\n");
  return `${fm.join("\n")}\n\n# ${title}\n\n${body}\n`;
}

// ---------------------------------------------------------------- pins, fetch

export function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("end", () => res(h.digest("hex")))
      .on("error", rej);
  });
}

export function loadSources(file = SOURCES_FILE) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Check a downloaded file against its pin. A missing pin is refused unless
 * `record` is set (the owner's first run), which writes the pin back.
 */
export async function checkPin(id, path, { file = SOURCES_FILE, record = false } = {}) {
  const sources = loadSources(file);
  const src = sources.sources.find((s) => s.id === id);
  if (!src) throw new Error(`corpus-vault: no source "${id}" in ${file}`);
  const got = await sha256File(path);
  if (!src.sha256) {
    if (!record) throw new Error(`corpus-vault: ${id} has no pinned sha256 yet. Run once with --record-pins (owner), commit corpus-sources.json, then rerun.`);
    src.sha256 = got;
    src.pinnedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(file, `${JSON.stringify(sources, null, 2)}\n`);
    return got;
  }
  if (src.sha256 !== got) throw new Error(`corpus-vault: ${id} sha256 is ${got}, pinned ${src.sha256}. Refusing a changed dump.`);
  return got;
}

async function download(url, to) {
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to)) return to;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`corpus-vault: ${url} answered ${res.status}`);
  const tmp = `${to}.part`;
  const out = createWriteStream(tmp);
  for await (const chunk of res.body) if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  renameSync(tmp, to);
  return to;
}

/** Download every source into `cache` (once), check the pins; returns local paths. */
export async function fetchSources(cache, { record = false, file = SOURCES_FILE } = {}) {
  const { sources } = loadSources(file);
  const paths = {};
  for (const s of sources) {
    const local = join(cache, s.file);
    await download(s.url, local);
    await checkPin(s.id, local, { file, record });
    paths[s.id] = local;
  }
  const by = join(cache, "benyehuda");
  if (paths.benyehuda && !existsSync(join(by, "pseudocatalogue.csv"))) {
    mkdirSync(by, { recursive: true });
    await new Promise((res, rej) => spawn("tar", ["-xzf", paths.benyehuda, "-C", by, "--strip-components=1"], { stdio: "inherit" }).on("exit", (c) => (c === 0 ? res() : rej(new Error(`tar exited ${c}`)))));
  }
  return { hewiki: paths.hewiki, enwiki: paths.enwiki, benyehuda: paths.benyehuda ? by : undefined };
}

// ---------------------------------------------------------------- the vault

/** Notes per language for a vault of `n` notes: about 2/3 Hebrew, Ben-Yehuda counted as Hebrew. */
export function split(n, byNotes) {
  const he = Math.round((n * 2) / 3);
  return { heWiki: Math.max(0, he - byNotes), en: n - he, by: Math.min(byNotes, he) };
}

const MIN_BODY_CHARS = 400; // stubs (a sentence and an infobox) are skipped

async function takeArticles(dumpPath, lang, want, resolveTitle) {
  const out = [];
  if (!dumpPath || want <= 0) return out;
  const d = typeof dumpPath === "string" ? openDump(dumpPath) : dumpPath;
  try {
    for await (const p of readPages(d.chunks)) {
      if (p.ns !== 0 || p.redirect || !p.text || /^#(redirect|הפניה)/i.test(p.text.trim())) continue;
      const note = wikitextToMarkdown(p.title, p.text, lang, resolveTitle);
      if (note.body.length < MIN_BODY_CHARS) continue;
      out.push({ title: p.title, name: noteName(p.title, lang), lang, ...note });
      if (out.length >= want) break;
    }
  } finally {
    d.close?.();
  }
  return out;
}

const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/** Every `[[target]]` of a note body. */
export function linkTargets(md) {
  return [...md.matchAll(LINK)].map((m) => m[1].trim());
}

/** 50 queries from real titles: every k-th Hebrew and English article (2/3 Hebrew), each with the note it must find. */
export function pickQueries(notes, count = 50) {
  const pick = (list, k) => {
    const n = Math.min(k, list.length);
    if (n <= 0) return [];
    const step = list.length / n;
    return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
  };
  const he = notes.filter((n) => n.lang === "he" && n.kind === "wiki");
  const en = notes.filter((n) => n.lang === "en" && n.kind === "wiki");
  const heK = Math.min(he.length, Math.round((count * 2) / 3));
  const out = [...pick(he, heK), ...pick(en, count - heK)];
  return out.map((n) => ({ q: n.title, lang: n.lang, expect: n.path }));
}

/**
 * Build the vault. `inputs`: { hewiki, enwiki, benyehuda, docs } (paths, or
 * { chunks } objects for dumps). Writes the notes, the manifest and the
 * queries; returns the manifest.
 */
export async function buildVault(inputs, { notes: N = 10_000, out, long = 200, huge = 5, sources = null } = {}) {
  if (!out) throw new Error("corpus-vault: --out is required");
  // A second vault written over the first would be measured as one.
  if (existsSync(out) && readdirSync(out).length) throw new Error(`corpus-vault: ${out} is not empty`);
  const all = [];
  let shortfall = { long: 0, huge: 0 };
  let by = { long: [], huge: [] };
  if (inputs.benyehuda) {
    const works = benYehudaWorks(inputs.benyehuda);
    by = pickBenYehuda(works, { long, huge });
    shortfall = by.shortfall;
  }
  const byCount = by.long.length + by.huge.length;
  if (inputs.docs) {
    for (const n of docsNotes(inputs.docs, N - byCount)) all.push(n);
  } else {
    const want = split(N, byCount);
    const he = await takeArticles(inputs.hewiki, "he", want.heWiki, (t) => noteName(t, "he"));
    const en = await takeArticles(inputs.enwiki, "en", want.en, (t) => noteName(t, "en"));
    for (const n of [...he, ...en]) all.push({ kind: "wiki", lang: n.lang, title: n.title, path: `${n.lang}/${n.name}.md`, markdown: n.markdown });
  }
  const readText = (w) => readFileSync(w.file, "utf8");
  for (const w of by.long) all.push({ kind: "benyehuda", lang: "he", title: w.title, path: `benyehuda/${noteName(`${w.title} (${w.id})`, "he")}.md`, markdown: benYehudaNote(w.title, w.authors, [w], readText) });
  for (const h of by.huge) all.push({ kind: "benyehuda-huge", lang: "he", title: h.title, path: `benyehuda/${noteName(h.title, "he")}.md`, markdown: benYehudaNote(h.title, h.authors, h.parts, readText) });

  const names = new Set(all.map((n) => n.path.replace(/^.*\//, "").replace(/\.md$/, "")));
  let links = 0;
  let resolved = 0;
  let bytes = 0;
  const hash = createHash("sha256");
  for (const n of all) {
    const file = join(out, n.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, n.markdown);
    bytes += Buffer.byteLength(n.markdown);
    hash.update(`${n.path}\0${n.markdown}\0`);
    for (const t of linkTargets(n.markdown)) {
      links++;
      if (names.has(t)) resolved++;
    }
  }
  const real = !inputs.docs && (inputs.hewiki || inputs.enwiki);
  const manifest = {
    schema: 1,
    generator: `scripts/perf/corpus-vault.mjs v${GENERATOR_VERSION}`,
    origin: inputs.docs ? "derived-from-docs" : real || inputs.benyehuda ? "real" : "synthetic",
    requested: N,
    notes: {
      total: all.length,
      he: all.filter((n) => n.lang === "he").length,
      en: all.filter((n) => n.lang === "en").length,
      benyehudaLong: by.long.length,
      benyehudaHuge: by.huge.length,
      hugeBytes: by.huge.map((h) => Buffer.byteLength(all.find((n) => n.title === h.title && n.kind === "benyehuda-huge").markdown)),
    },
    shortfall,
    bytes,
    links: { total: links, resolved },
    sha256: hash.digest("hex"),
    sources: sources ?? describeInputs(inputs),
  };
  writeFileSync(join(out, "corpus-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(out, "queries.json"), `${JSON.stringify(pickQueries(all), null, 2)}\n`);
  return manifest;
}

function describeInputs(inputs) {
  const out = [];
  let pins = { sources: [] };
  try {
    pins = loadSources();
  } catch {
    // why: the pins file is optional for ad-hoc local runs; the manifest then names the paths only
  }
  for (const id of ["hewiki", "enwiki", "benyehuda"]) {
    if (!inputs[id]) continue;
    const pin = pins.sources.find((s) => s.id === id);
    out.push({ id, input: typeof inputs[id] === "string" ? inputs[id] : "(stream)", url: pin?.url ?? null, sha256: pin?.sha256 ?? null, license: pin?.license ?? null, attribution: pin?.attribution ?? null });
  }
  if (inputs.docs) out.push({ id: "docs", input: inputs.docs, license: "the repository's own licence", attribution: "lumen-md documentation" });
  return out;
}

/** Real Markdown from a folder (the repo's docs), Hebrew first, for the cloud run. */
export function docsNotes(dir, want) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.mdx?$/.test(e.name)) files.push(p);
    }
  };
  walk(dir);
  const isHe = (p) => /(^|\/)he\//.test(relative(dir, p));
  const ordered = [...files.filter(isHe), ...files.filter((p) => !isHe(p))].slice(0, want);
  return ordered.map((p) => {
    const rel = relative(dir, p);
    const lang = isHe(p) ? "he" : "en";
    const md = readFileSync(p, "utf8");
    const title = /^title:\s*(.+)$/m.exec(md)?.[1]?.replace(/^["']|["']$/g, "") ?? rel;
    return { kind: "wiki", lang, title, path: `${lang}/${rel.replace(/\//g, "__").replace(/\.mdx$/, ".md")}`, markdown: md };
  });
}

// ---------------------------------------------------------------------- CLI

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) o[k] = true;
    else {
      o[k] = v;
      i++;
    }
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const notes = Number(o.notes ?? 10_000);
  let inputs = { hewiki: o.hewiki, enwiki: o.enwiki, benyehuda: o.benyehuda, docs: o.docs };
  if (o.fetch) inputs = { ...inputs, ...(await fetchSources(o.cache ?? ".cache/corpus", { record: !!o["record-pins"] })) };
  else
    for (const id of ["hewiki", "enwiki"])
      if (inputs[id] && !o["no-pin-check"]) await checkPin(id, inputs[id], { record: !!o["record-pins"] });
  if (!inputs.docs && !inputs.hewiki) throw new Error("corpus-vault: give --hewiki (and --enwiki, --benyehuda), or --fetch, or --docs");
  const manifest = await buildVault(inputs, { notes, out: o.out, long: Number(o.long ?? 200), huge: Number(o.huge ?? 5) });
  console.log(JSON.stringify({ out: o.out, origin: manifest.origin, notes: manifest.notes, shortfall: manifest.shortfall, links: manifest.links, bytes: manifest.bytes }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
