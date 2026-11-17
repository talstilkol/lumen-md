#!/usr/bin/env node
/**
 * W13.W10 (Mac step): copy harper.js (Automattic, Apache-2.0) from
 * node_modules into public/vendor/harper/, so the Harper worker loads it
 * from the app's own origin — no CDN, no network at run time.
 *
 *   npm i -D harper.js@<pinned>   (on the Mac; the package index is not reachable from the cloud lanes)
 *   node scripts/writing/vendor-harper.mjs [--check]
 *
 * Writes public/vendor/harper/MANIFEST.json with the version, the licence
 * and a sha256 per file. Refuses a package whose licence is not Apache-2.0.
 * --check: exit 1 when the vendored files differ from the manifest.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PKG = join(ROOT, "node_modules/harper.js");
const OUT = join(ROOT, "public/vendor/harper");
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const files = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));

if (process.argv.includes("--check")) {
  const m = JSON.parse(readFileSync(join(OUT, "MANIFEST.json"), "utf8"));
  const bad = Object.entries(m.files).filter(([f, h]) => !existsSync(join(OUT, f)) || sha(join(OUT, f)) !== h);
  console.log(bad.length ? `vendor-harper: ${bad.length} file(s) differ: ${bad.map(([f]) => f).join(", ")}` : `vendor-harper: ${Object.keys(m.files).length} files match harper.js@${m.version}`);
  process.exit(bad.length ? 1 : 0);
}
if (!existsSync(PKG)) {
  console.error("vendor-harper: node_modules/harper.js is not installed (npm i -D harper.js on the Mac)");
  process.exit(2);
}
const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
if (pkg.license !== "Apache-2.0") {
  console.error(`vendor-harper: harper.js licence is "${pkg.license}", not Apache-2.0 — refused`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
cpSync(join(PKG, "dist"), OUT, { recursive: true });
for (const lic of ["LICENSE", "LICENSE.md", "NOTICE"]) if (existsSync(join(PKG, lic))) cpSync(join(PKG, lic), join(OUT, lic));
const manifest = {
  name: "harper.js",
  version: pkg.version,
  license: pkg.license,
  source: "https://github.com/Automattic/harper",
  files: Object.fromEntries(files(OUT).filter((f) => !f.endsWith("MANIFEST.json")).map((f) => [relative(OUT, f), sha(f)])),
};
writeFileSync(join(OUT, "MANIFEST.json"), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`vendor-harper: harper.js@${pkg.version} → public/vendor/harper (${Object.keys(manifest.files).length} files)`);
