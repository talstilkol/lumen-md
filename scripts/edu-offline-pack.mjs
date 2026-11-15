#!/usr/bin/env node
/**
 * The offline package for schools and yeshivot (plan W11.P14), from local
 * files only: nothing is downloaded. It copies what edu/offline-pack.json
 * lists onto a folder (a drive), checks every model's licence class in
 * models/registry.json, and writes SHA256SUMS and the Hebrew instructions.
 *
 *   node scripts/edu-offline-pack.mjs --installer <Lumen.msix|.msi|-setup.exe> --out <drive folder> [--models <folder with the model dirs>]
 *
 * Exit 1 when a required part is missing or a model may not go on the drive.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { packProblems } from "./lib/eduKit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const installer = arg("--installer");
const out = arg("--out");
const modelsDir = arg("--models");
if (!out) {
  console.error("usage: node scripts/edu-offline-pack.mjs --installer <file> --out <folder> [--models <folder>]");
  process.exit(2);
}

const pack = JSON.parse(readFileSync(join(ROOT, "edu", "offline-pack.json"), "utf8"));
const registry = JSON.parse(readFileSync(join(ROOT, "models", "registry.json"), "utf8"));
const problems = packProblems(pack, registry);
const files = [];
const copy = (from, to) => {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  copyFileSync(from, join(out, to));
  files.push(to);
};
const walk = (d) => readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]));

for (const c of pack.components) {
  if (c.from === "installer") {
    if (!installer || !existsSync(installer)) {
      if (c.required) problems.push(`${c.id}: --installer is missing or not found`);
      continue;
    }
    if (!c.accept.some((re) => new RegExp(re, "i").test(installer))) problems.push(`${c.id}: ${basename(installer)} is not an .msix, .msi or -setup.exe`);
    else copy(installer, join("Lumen", basename(installer)));
  } else if (c.from === "repo") {
    for (const p of c.paths) {
      if (existsSync(join(ROOT, p))) copy(join(ROOT, p), join("models", c.id, basename(p)));
      else if (c.required) problems.push(`${c.id}: ${p} is missing`);
    }
  } else if (c.from === "models") {
    const dir = modelsDir ? join(modelsDir, c.dir) : null;
    if (dir && existsSync(dir)) for (const f of walk(dir)) copy(f, join("models", c.id, relative(dir, f)));
    else if (c.required) problems.push(`${c.id}: ${c.dir} is not under --models`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

const sums = files.sort().map((f) => `${createHash("sha256").update(readFileSync(join(out, f))).digest("hex")}  ${f.split("\\").join("/")}`);
writeFileSync(join(out, "SHA256SUMS"), sums.join("\n") + "\n");
const he = [
  "‏Lumen — חבילה לא מקוונת",
  "",
  "1. מתקינים את Lumen מהתיקייה Lumen (קובץ ה-MSIX, ה-MSI או ה-setup.exe).",
  "2. החיפוש בעברית וזיהוי הטקסט (OCR) עובדים בלי רשת. קבצי השפה נמצאים בתוך האפליקציה, ועותק שלהם בתיקייה models.",
  `3. ${pack.tts.he}`,
  "4. בודקים את הקבצים: כל שורה ב-SHA256SUMS היא טביעת SHA-256 של קובץ בחבילה.",
  "",
  "רכיבים:",
  ...pack.components.map((c) => `- ${c.what.he}${files.some((f) => f.startsWith(join("models", c.id)) || (c.from === "installer" && f.startsWith("Lumen"))) ? "" : " — לא נכלל"}`),
  "",
].join("\n");
writeFileSync(join(out, "קרא-אותי.txt"), "\uFEFF" + he);
console.log(`offline pack: ${files.length} files in ${out}, SHA256SUMS written`);
