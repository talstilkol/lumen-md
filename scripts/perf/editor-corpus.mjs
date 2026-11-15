#!/usr/bin/env node
/**
 * W11.Q5 (research R5.6): the two real long texts the keypress → paint gate
 * (e2e/inp-budget.spec.ts) types into, instead of generated Markdown:
 *
 *   - Moby-Dick; or, The Whale, Project Gutenberg eBook #2701 (public domain),
 *     the de-facto ProseMirror stress document (about 1.2 MB);
 *   - 2 MB of Hebrew from Project Ben-Yehuda's public_domain_dump (public
 *     domain): one author's works in catalogue order, cut at a paragraph end
 *     once the text passes 2 MiB.
 *
 *   npm run perf:editor-corpus -- --benyehuda <public_domain_dump checkout> [--record-pins]
 *
 * Writes reports/perf/corpus/moby-dick.md and reports/perf/corpus/benyehuda-2mb.md
 * (git-ignored) and prints their sha256. The Gutenberg file is downloaded
 * once into reports/perf/corpus/ and checked against the sha256 pinned in
 * editor-corpus.json; the first run records the pin when --record-pins is
 * given (the owner, on the Mac; the cloud sandbox cannot reach gutenberg.org).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PINS_FILE = join(HERE, "editor-corpus.json");
export const OUT_DIR = join(HERE, "..", "..", "reports", "perf", "corpus");
export const TWO_MIB = 2 * 1024 * 1024;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/**
 * The book between Project Gutenberg's START and END markers (the licence
 * header and footer are not the text). Line endings become \n.
 */
export function stripGutenberg(text) {
  const t = text.replace(/\r\n?/g, "\n");
  const start = /^\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*\s*$/im.exec(t);
  const end = /^\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*\s*$/im.exec(t);
  if (!start || !end || end.index < start.index) throw new Error("editor-corpus: no Project Gutenberg START/END markers");
  return t.slice(start.index + start[0].length, end.index).trim() + "\n";
}

/** Moby-Dick as a Markdown note: the CHAPTER lines become headings, the rest is untouched. */
export function mobyDickNote(book) {
  const body = book.replace(/^(CHAPTER \d+\.[^\n]*|ETYMOLOGY\.|EXTRACTS\.[^\n]*|Epilogue)$/gm, "## $1");
  return `# Moby-Dick; or, The Whale\n\nHerman Melville (1851). Project Gutenberg eBook #2701, public domain.\n\n${body}`;
}

const utf8 = (s) => Buffer.byteLength(s, "utf8");

/**
 * About `target` bytes of one author's works, in catalogue order, each under
 * its title as a heading, cut at the first paragraph end past `target`.
 * `works`: [{ id, title, authors, text }]. The author with the most text goes
 * first; when no one author has enough, the next author's works follow.
 */
export function benYehudaNote(works, target = TWO_MIB) {
  const byAuthor = new Map();
  for (const w of works) byAuthor.set(w.authors, [...(byAuthor.get(w.authors) ?? []), w]);
  const authors = [...byAuthor.entries()].sort((a, b) => b[1].reduce((n, w) => n + utf8(w.text), 0) - a[1].reduce((n, w) => n + utf8(w.text), 0) || (a[0] < b[0] ? -1 : 1));
  let out = "# בן-יהודה: טקסט ארוך לבדיקת הקלדה\n\nפרויקט בן-יהודה, public_domain_dump (נחלת הכלל).\n\n";
  const ids = [];
  for (const [author, ws] of authors) {
    out += `## ${author}\n\n`;
    for (const w of ws) {
      out += `### ${w.title}\n\n${w.text.replace(/\r\n?/g, "\n").trim()}\n\n`;
      ids.push(w.id);
      if (utf8(out) >= target) {
        const cut = out.indexOf("\n\n", Buffer.from(out, "utf8").subarray(0, target).toString("utf8").length);
        return { text: cut > 0 ? out.slice(0, cut + 1) : out, ids, short: false };
      }
    }
  }
  return { text: out, ids, short: true };
}

/** The works of a Ben-Yehuda checkout (pseudocatalogue.csv + txt_stripped/). */
export function readBenYehuda(dir) {
  const csv = readFileSync(join(dir, "pseudocatalogue.csv"), "utf8").split(/\r?\n/);
  const head = splitCsv(csv[0]);
  const col = (n) => head.indexOf(n);
  const works = [];
  for (const line of csv.slice(1)) {
    if (!line) continue;
    const r = splitCsv(line);
    const file = join(dir, "txt_stripped", `${r[col("path")].replace(/^\//, "")}.txt`);
    if (!existsSync(file) || !statSync(file).size) continue;
    works.push({ id: r[col("ID")], title: r[col("title")], authors: r[col("authors")], text: readFileSync(file, "utf8") });
  }
  return works;
}

function splitCsv(line) {
  const out = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cell);
      cell = "";
    } else cell += c;
  }
  out.push(cell);
  return out;
}

/** Check (or, with record, write) the pin of one source. */
export function checkPin(pins, id, content, record = false) {
  const src = pins.sources.find((s) => s.id === id);
  if (!src) throw new Error(`editor-corpus: no source "${id}"`);
  const got = sha256(content);
  if (!src.sha256) {
    if (!record) throw new Error(`editor-corpus: ${id} has no pinned sha256 yet; run once with --record-pins (owner) and commit ${PINS_FILE}`);
    src.sha256 = got;
    return { pins, got, recorded: true };
  }
  if (src.sha256 !== got) throw new Error(`editor-corpus: ${id} sha256 ${got} is not the pinned ${src.sha256}`);
  return { pins, got, recorded: false };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const record = argv.includes("--record-pins");
  const pins = JSON.parse(readFileSync(PINS_FILE, "utf8"));
  mkdirSync(OUT_DIR, { recursive: true });
  const moby = pins.sources.find((s) => s.id === "moby-dick");
  const raw = join(OUT_DIR, moby.file);
  if (!existsSync(raw)) {
    const res = await fetch(moby.url);
    if (!res.ok) throw new Error(`editor-corpus: ${moby.url} answered ${res.status}`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  }
  const rawText = readFileSync(raw, "utf8");
  const r1 = checkPin(pins, "moby-dick", rawText, record);
  const mobyNote = mobyDickNote(stripGutenberg(rawText));
  writeFileSync(join(OUT_DIR, "moby-dick.md"), mobyNote);
  const dir = opt("benyehuda");
  if (!dir) throw new Error("editor-corpus: --benyehuda <public_domain_dump checkout> (git clone https://github.com/projectbenyehuda/public_domain_dump)");
  const by = benYehudaNote(readBenYehuda(dir));
  if (by.short) throw new Error(`editor-corpus: the checkout has only ${utf8(by.text)} bytes of text; need ${TWO_MIB}`);
  writeFileSync(join(OUT_DIR, "benyehuda-2mb.md"), by.text);
  if (r1.recorded) writeFileSync(PINS_FILE, `${JSON.stringify(pins, null, 2)}\n`);
  const manifest = {
    "moby-dick.md": { bytes: utf8(mobyNote), sha256: sha256(mobyNote), source: moby.url, sourceSha256: r1.got },
    "benyehuda-2mb.md": { bytes: utf8(by.text), sha256: sha256(by.text), works: by.ids },
  };
  writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
