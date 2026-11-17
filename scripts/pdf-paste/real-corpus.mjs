#!/usr/bin/env node
/**
 * Plan W5.5 on real PDFs: a corpus loader and scorer for Hebrew pasted
 * from PDFs (court rulings, articles, forms). The PDFs stay on the owner's
 * machine (their copyright is not ours); only the scores are kept.
 *
 *   node scripts/pdf-paste/real-corpus.mjs build --pdfs <folder> --out <corpus.json> [--max 100] [--seed W5.5]
 *   node scripts/pdf-paste/real-corpus.mjs score --corpus <corpus.json> [--review-out review.csv] [--truth review.csv] [--out scores.json]
 *
 * build reads every PDF under the folder with pdf.js (pdfjs-dist, as
 * scripts/gen-pdf-paste-corpus.mjs does) and keeps Hebrew lines (≥ 12
 * Hebrew letters), at most --max (seeded, spread over the files):
 *   visual   the line in the order its glyphs were drawn (pdf.js's per-item
 *            reordering undone) — what a reader that does not reorder copies;
 *   logical  the line as read: pdf.js's own text of each item, the items
 *            ordered right to left for a Hebrew line (by x), left to right
 *            otherwise.
 *   source   { file: sha256 of the PDF, page } — never the file's name or path.
 *
 * score runs the app's detector and fix (src/paste/pdfHebrew.ts,
 * suggestPdfHebrewFix) on each line: a line whose visual and logical differ
 * must come back as its logical text (target ≥ 95 %); a logical line is a
 * control and must get no offer (target 0 changes). Exit 1 below target.
 *
 * `logical` is read from the page's geometry, and geometry alone misplaces
 * neutrals (brackets, ⌘, list numbers) between runs: on 14 LibreOffice PDFs
 * of Lumen's Hebrew docs it matched the source text on 50 lines of 100. So
 * the reference is a person's: --review-out writes review.csv (id, visual,
 * the app's fix, the geometric guess, and `correct`, prefilled with the
 * guess); the owner corrects `correct` where it is wrong, and --truth
 * review.csv scores against it.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HEB = /[א-ת]/g;
export const MIN_HEBREW = 12;
export const TARGET = { fixed: 0.95, controlsChanged: 0 };

const hebCount = (s) => (s.match(HEB) ?? []).length;
const latinCount = (s) => (s.match(/[A-Za-z]/g) ?? []).length;

/**
 * One page's pdf.js text items → lines { visual, logical }. An item is
 * { str, dir, hasEOL, transform: [a, b, c, d, x, y], width }. Items are
 * placed by x: `visual` reads them left to right (an RTL item's letters
 * reversed: the order the glyphs sit on the page), `logical` reads a
 * Hebrew line's items right to left as pdf.js gives each one. A gap wider
 * than 0.15 em between two items is a space (PDFs rarely draw spaces).
 */
export function pageLines(items) {
  const out = [];
  let cur = [];
  const join = (its) => {
    let s = "";
    for (let i = 0; i < its.length; i++) {
      const it = its[i];
      if (i) {
        const prev = its[i - 1];
        const a = prev.transform?.[4] ?? 0;
        const b = it.transform?.[4] ?? 0;
        const gap = b >= a ? b - (a + (prev.width ?? 0)) : a - (b + (it.width ?? 0));
        const em = Math.abs(it.transform?.[0] ?? 10) || 10;
        if (gap > 0.15 * em && !/\s$/.test(s) && !/^\s/.test(it.text)) s += " ";
      }
      s += it.text;
    }
    return s.replace(/\s+/g, " ").trim();
  };
  const flush = () => {
    const its = cur.filter((it) => typeof it.str === "string" && it.str !== "");
    cur = [];
    if (!its.length) return;
    const x = (it) => it.transform?.[4] ?? 0;
    const all = its.map((it) => it.str).join("");
    const rtl = hebCount(all) > latinCount(all);
    const ltr = [...its].sort((a, b) => x(a) - x(b));
    const visual = join(ltr.map((it) => ({ ...it, text: it.dir === "rtl" ? Array.from(it.str).reverse().join("") : it.str })));
    const logical = join((rtl ? [...ltr].reverse() : ltr).map((it) => ({ ...it, text: it.str })));
    if (visual) out.push({ visual, logical });
  };
  for (const it of items) {
    if (!("str" in it)) continue;
    cur.push(it);
    if (it.hasEOL) flush();
  }
  flush();
  return out;
}

const rank = (seed, k) => createHash("sha256").update(`${seed}\u0000${k}`).digest("hex");

/** Keep Hebrew lines, at most `max`, round-robin over the files in a seeded order. */
export function selectLines(perFile, max = 100, seed = "W5.5") {
  const pools = perFile.map((f) => f.lines.filter((l) => hebCount(l.logical) >= MIN_HEBREW).sort((a, b) => rank(seed, `${f.sha}:${a.page}:${a.logical}`).localeCompare(rank(seed, `${f.sha}:${b.page}:${b.logical}`))).map((l) => ({ ...l, file: f.sha })));
  const out = [];
  for (let round = 0; out.length < max && pools.some((p) => p.length > round); round++) for (const p of pools) if (p[round] && out.length < max) out.push(p[round]);
  return out.map((l, i) => ({ id: `real-${String(i + 1).padStart(3, "0")}`, visual: l.visual, logical: l.logical, source: { file: l.file, page: l.page } }));
}

const norm = (s) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/** Scores with `suggest(text) → { fixed } | null` (the app's suggestPdfHebrewFix). `truth`: id → the person-checked line. */
export function scoreCorpus(items, suggest, truth = null) {
  let reversed = 0;
  let fixed = 0;
  let controls = 0;
  let changed = 0;
  const misses = [];
  for (const raw of items) {
    const it = truth?.has(raw.id) ? { ...raw, logical: truth.get(raw.id) } : raw;
    controls++;
    if (suggest(it.logical)) changed++;
    if (norm(it.visual) === norm(it.logical)) continue;
    reversed++;
    const out = suggest(it.visual)?.fixed ?? it.visual;
    if (norm(out) === norm(it.logical)) fixed++;
    else misses.push(it.id);
  }
  const share = reversed ? fixed / reversed : 1;
  return { lines: items.length, reference: truth ? "person-checked" : "geometric guess", reversed, fixed, fixedShare: Math.round(share * 10000) / 10000, controls, controlsChanged: changed, pass: share >= TARGET.fixed && changed <= TARGET.controlsChanged, misses };
}

export const REVIEW_COLUMNS = ["id", "visual", "fixed", "guess", "correct"];

/** The review sheet rows: what the person checks. */
export function reviewRows(items, suggest) {
  return items.map((it) => ({ id: it.id, visual: it.visual, fixed: suggest(it.visual)?.fixed ?? it.visual, guess: it.logical, correct: it.logical }));
}

function pdfFiles(dir) {
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...pdfFiles(p));
    else if (/\.pdf$/i.test(n)) out.push(p);
  }
  return out;
}

async function readPdf(path) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = readFileSync(path);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const { items } = await (await doc.getPage(p)).getTextContent();
    for (const l of pageLines(items)) lines.push({ ...l, page: p });
  }
  return { sha: createHash("sha256").update(data).digest("hex"), lines };
}

if (process.argv[1]?.endsWith("pdf-paste/real-corpus.mjs")) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  if (cmd === "build") {
    const dir = opt("--pdfs") ?? (console.error("--pdfs <folder> is required"), process.exit(2));
    const files = pdfFiles(dir);
    const perFile = [];
    for (const f of files) perFile.push(await readPdf(f));
    const items = selectLines(perFile, Number(opt("--max", 100)), opt("--seed", "W5.5"));
    writeFileSync(opt("--out", "corpus-real.json"), JSON.stringify({ about: "W5.5: lines of real Hebrew PDFs (local only, never committed)", pdfs: files.length, items }, null, 1) + "\n");
    console.log(`${items.length} Hebrew lines from ${files.length} PDFs → ${opt("--out", "corpus-real.json")}`);
  } else if (cmd === "score") {
    const { tsImport } = await import("tsx/esm/api");
    const { suggestPdfHebrewFix } = await tsImport("../../src/paste/pdfHebrew.ts", import.meta.url);
    const { items } = JSON.parse(readFileSync(opt("--corpus"), "utf8"));
    const { csvCell, parseCsv } = await import("../caption/rating-sheet.mjs");
    let truth = null;
    if (opt("--truth")) {
      const [head, ...rows] = parseCsv(readFileSync(opt("--truth"), "utf8"));
      const id = head.indexOf("id");
      const correct = head.indexOf("correct");
      truth = new Map(rows.map((r) => [r[id], r[correct]]));
    }
    if (opt("--review-out")) writeFileSync(opt("--review-out"), "\uFEFF" + [REVIEW_COLUMNS.join(","), ...reviewRows(items, suggestPdfHebrewFix).map((r) => REVIEW_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n");
    const r = scoreCorpus(items, suggestPdfHebrewFix, truth);
    if (opt("--out")) writeFileSync(opt("--out"), JSON.stringify(r, null, 2) + "\n");
    console.log(JSON.stringify({ ...r, misses: r.misses.length }, null, 2));
    process.exit(r.pass ? 0 : 1);
  } else {
    console.error("usage: real-corpus.mjs build --pdfs <folder> --out <file> [--max N] | score --corpus <file> [--out <file>]");
    process.exit(2);
  }
}
