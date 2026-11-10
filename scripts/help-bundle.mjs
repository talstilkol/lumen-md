#!/usr/bin/env node
/**
 * The docs, packed into the app (plan W3.7): every page of
 * docs/src/content/docs, English and Hebrew, as one JSON file per language
 * under src/help/generated/. The help panel loads it lazily (it is not in
 * the startup bundle) and searches it on the device, so help works offline.
 *
 * Each page keeps its Markdown body (rendered in the panel by the app's own
 * renderer) and, for search, its sections: heading, the anchor the renderer
 * gives that heading, and plain text.
 *
 *   node scripts/help-bundle.mjs           # write
 *   node scripts/help-bundle.mjs --check   # fail if the bundle is out of date with the docs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs/src/content/docs");
export const OUT = { en: "src/help/generated/help.en.json", he: "src/help/generated/help.he.json" };
/**
 * Each bundle becomes its own lazy chunk, which scripts/bundle-budget.mjs
 * holds to the "lazy plugin chunk" rule: 100 KB gzipped. Fail here first,
 * with room to spare, so a growing docs tree is caught before the build.
 * Measured at W3.7: en 63.6 KB, he 69.8 KB.
 */
export const CHUNK_BUDGET_KB = 100;
export const CHUNK_WARN_KB = 85;

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.mdx?$/.test(n)) out.push(p);
  }
  return out;
}

/** The anchor rehype-slug (github-slugger) gives a heading. */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~’]/g, "")
    .replace(/ /g, "-");
}

/** Markdown to plain text for the search index: no code, links as their text, no markup. */
export function plainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/^:::\w*.*$/gm, " ")
    .replace(/^\s*[|>*+-]\s?|[*_~]{1,3}|\|/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One page: slug, title, description, Markdown body, sections. */
export function readPage(file) {
  const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  const fm = m?.[1] ?? "";
  const field = (k) => (new RegExp(`^${k}:\\s*(.*)$`, "m").exec(fm)?.[1] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
  // MDX: drop imports and component tags; keep the Markdown.
  const body = src
    .slice(m ? m[0].length : 0)
    .replace(/^import\s.+$/gm, "")
    .replace(/<\/?[A-Z][\w.]*[^>]*>/g, "")
    .trim();
  const slug = relative(DOCS, file).replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "").split("\\").join("/");
  const sections = [];
  let current = { heading: field("title"), anchor: "", lines: [] };
  let fence = false;
  for (const line of body.split("\n")) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && /^(#{2,4})\s+(.+?)\s*#*$/.exec(line);
    if (h) {
      sections.push(current);
      current = { heading: h[2].replace(/[*_`]/g, ""), anchor: slugify(h[2].replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")), lines: [] };
    } else current.lines.push(line);
  }
  sections.push(current);
  return {
    slug,
    title: field("title"),
    description: field("description"),
    md: body,
    sections: sections.map((s) => ({ heading: s.heading, anchor: s.anchor, text: plainText(s.lines.join("\n")) })).filter((s) => s.text || s.anchor),
  };
}

const pagesOf = (lang) =>
  walk(DOCS)
    .filter((f) => {
      const rel = relative(DOCS, f).split("\\").join("/");
      return lang === "he" ? rel.startsWith("he/") : !rel.startsWith("he/");
    })
    .map(readPage)
    .map((p) => ({ ...p, slug: lang === "he" ? p.slug.replace(/^he\/?/, "") : p.slug }));

/**
 * Each section gets a `key`: the English anchor of the same section, so a
 * "?" button names one section for both languages. The Hebrew page is the
 * English one translated, section for section; when the counts differ the
 * key is the page's own anchor.
 */
export function bundle(lang) {
  const pages = pagesOf(lang);
  const en = lang === "en" ? pages : pagesOf("en");
  for (const p of pages) {
    const twin = en.find((x) => x.slug === p.slug);
    const parallel = twin && twin.sections.length === p.sections.length;
    p.sections = p.sections.map((s, i) => ({ ...s, key: parallel ? twin.sections[i].anchor : s.anchor }));
  }
  return { version: 1, lang, pages };
}

function main() {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [lang, rel] of Object.entries(OUT)) {
    const want = `${JSON.stringify(bundle(lang))}\n`;
    // What Vite emits for a large JSON import: JSON.parse of one string literal.
    const kb = gzipSync(`export default JSON.parse(${JSON.stringify(want.trim())})`).length / 1024;
    if (kb > CHUNK_BUDGET_KB) {
      console.error(`✖ ${rel}: ~${kb.toFixed(1)} KB gzipped, over the ${CHUNK_BUDGET_KB} KB lazy-chunk budget: split the bundle (per section, or a separate search index)`);
      stale++;
    } else if (kb > CHUNK_WARN_KB) console.error(`⚠ ${rel}: ~${kb.toFixed(1)} KB gzipped, near the ${CHUNK_BUDGET_KB} KB lazy-chunk budget`);
    else if (check) console.error(`  ${rel}: ~${kb.toFixed(1)} KB gzipped / ${CHUNK_BUDGET_KB} KB`);
    const path = join(ROOT, rel);
    const have = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (have === want) continue;
    if (check) {
      console.error(`✖ ${rel} is out of date with the docs: run node scripts/help-bundle.mjs`);
      stale++;
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, want);
      console.error(`wrote ${rel} (${(want.length / 1024).toFixed(0)} KB)`);
    }
  }
  if (stale) process.exit(1);
  if (check) console.error("✓ help bundle: the in-app docs match docs/src/content/docs");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
