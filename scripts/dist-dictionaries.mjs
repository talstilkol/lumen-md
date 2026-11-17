#!/usr/bin/env node
/**
 * Plan W7.9 acceptance 3: no spelling dictionary inside a build. The Yiddish
 * list (hunspell-yi, GPL-3.0) and Hspell (AGPL-3.0) are user downloads only;
 * this checks that neither, nor any other Hunspell word list, was bundled.
 *
 *   node scripts/dist-dictionaries.mjs --dir dist
 *
 * A file is refused when it is
 *   - named as a dictionary (.dic, .aff, .oxt, .bdic, .hunspell),
 *   - byte-for-byte a pinned user-download file (src/ai/yiddishSpell.ts pins),
 *   - or a text file (js, json, txt, html, css, map, …) that holds a Hunspell
 *     word list or affix table under another name, as a file or as a string
 *     inside a chunk (newline or "\n" separated).
 *
 * Exit 1 on a finding, 2 when there is nothing to check (no folder, no
 * files, or no index.html: a build that wasn't made is not a clean build).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DICT_EXT = new Set([".dic", ".aff", ".oxt", ".bdic", ".hunspell"]);
const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".json", ".txt", ".html", ".htm", ".css", ".map", ".md", ".csv", ".tsv", ".xml", ".svg", ".webmanifest", ""]);
const MAX_TEXT = 32 * 1024 * 1024;

/** The SHA-256 pins of the user-download dictionaries, read from the source that checks them. */
export function forbiddenPins(root = ROOT) {
  const pins = new Set();
  for (const f of ["src/ai/yiddishSpell.ts", "src/ai/hebrewSpell.ts", "src/ai/hebrewSpellService.ts"]) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, "utf8").matchAll(/sha256:\s*"([0-9a-f]{64})"/g)) pins.add(m[1]);
  }
  return pins;
}

/**
 * Does this text hold a Hunspell list? A .dic is a count, then one entry a
 * line (`word` or `word/FLAGS`); an .aff has rule headers like `SFX A Y 3`.
 * Lines may be real newlines or the two characters `\n` inside a string.
 */
export function hunspellInText(text) {
  for (const sep of ["\n", "\\n"]) {
    const lines = text.split(sep);
    if (lines.length < 6) continue;
    // A .dic: its first line is the entry count, then one entry a line (`word` or `word/FLAGS`, any script).
    const entry = /^[\p{L}\p{M}'’\u05F3\u05F4-]{1,40}(?:\/[\w,]+)?$/u;
    let best = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/(?:^|["'`])\d{3,7}$/.test(lines[i].trim())) continue;
      let run = 0;
      while (i + 1 + run < lines.length && entry.test(lines[i + 1 + run].trim())) run++;
      if (run > best) best = run;
      i += run;
    }
    if (best >= 500) return { kind: "dic", detail: `a count line and ${best} entries` };
    // An .aff: a rule header (`SFX N Y 2`) followed by its rule lines (`SFX N 0 ען .`).
    const headers = lines.filter((l) => /^(?:SFX|PFX)\s+\S+\s+[YN]\s+\d+$/.test(l.trim())).length;
    const rules = lines.filter((l) => /^(?:SFX|PFX)\s+\S+\s+\S+\s+\S+(?:\s+\S+)?$/.test(l.trim()) && !/^(?:SFX|PFX)\s+\S+\s+[YN]\s+\d+$/.test(l.trim())).length;
    if (headers >= 1 && rules >= 2) return { kind: "aff", detail: `${headers} affix rule headers, ${rules} rules` };
  }
  return null;
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

/** @returns {{ files: number, findings: { file: string, why: string }[], error?: string }} */
export function scanDist(dir, root = ROOT) {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return { files: 0, findings: [], error: `no build folder at ${dir}` };
  const pins = forbiddenPins(root);
  const findings = [];
  let files = 0;
  let index = false;
  for (const f of walk(dir)) {
    files++;
    const rel = relative(dir, f);
    if (rel === "index.html") index = true;
    const ext = extname(f).toLowerCase();
    if (DICT_EXT.has(ext)) findings.push({ file: rel, why: `a dictionary file (${ext})` });
    const buf = readFileSync(f);
    if (pins.has(createHash("sha256").update(buf).digest("hex"))) findings.push({ file: rel, why: "byte-for-byte a pinned user-download dictionary" });
    if (TEXT_EXT.has(ext) && buf.length <= MAX_TEXT && !DICT_EXT.has(ext)) {
      const hit = hunspellInText(buf.toString("utf8"));
      if (hit) findings.push({ file: rel, why: `holds a Hunspell ${hit.kind === "dic" ? "word list" : "affix table"} (${hit.detail})` });
    }
  }
  if (files === 0) return { files, findings, error: `the build folder ${dir} is empty` };
  if (!index) return { files, findings, error: `no index.html in ${dir}: not a build` };
  return { files, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const dir = argv.includes("--dir") ? resolve(argv[argv.indexOf("--dir") + 1] ?? "") : undefined;
  if (!dir) {
    console.error("usage: node scripts/dist-dictionaries.mjs --dir dist");
    process.exit(2);
  }
  const r = scanDist(dir);
  if (r.error) {
    console.error(`dist-dictionaries: ${r.error}`);
    process.exit(2);
  }
  for (const f of r.findings) console.error(`dist-dictionaries: ${f.file}: ${f.why}`);
  console.log(`dist-dictionaries: ${r.files} files, ${r.findings.length} dictionaries`);
  process.exit(r.findings.length ? 1 : 0);
}
