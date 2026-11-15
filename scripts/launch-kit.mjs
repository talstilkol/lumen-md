#!/usr/bin/env node
/**
 * The M3 launch kit's check (plan W11.L3): launch/m3/*.md against
 * launch/m3/claims.json. Every claim has a receipt that still says it, no
 * text calls the cryptography audited, and each text fits its site.
 *
 *   node scripts/launch-kit.mjs           check (exit 1 on a problem)
 *   node scripts/launch-kit.mjs --write   refresh each file's generated Sources list, then check
 *   node scripts/launch-kit.mjs --plain product-hunt.md "First comment"   print a section as it is pasted (no markers)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KIT_FILES, kitProblems, plain, withSources } from "./lib/launchKit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "launch", "m3");
const ledger = JSON.parse(readFileSync(join(DIR, "claims.json"), "utf8"));
const files = Object.fromEntries(KIT_FILES.filter((f) => existsSync(join(DIR, f))).map((f) => [f, readFileSync(join(DIR, f), "utf8")]));

const pi = process.argv.indexOf("--plain");
if (pi > 0) {
  const [file, heading] = process.argv.slice(pi + 1);
  const t = files[file] ? plain(files[file], heading) : null;
  if (t === null) {
    console.error(`no section "${heading}" in ${file}`);
    process.exit(2);
  }
  console.log(t);
  process.exit(0);
}

if (process.argv.includes("--write")) {
  for (const [f, md] of Object.entries(files)) {
    const next = withSources(md, ledger.claims);
    if (next !== md) writeFileSync(join(DIR, f), next);
    files[f] = next;
  }
}

const readRepo = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);
const problems = kitProblems(files, ledger, readRepo);
for (const p of problems) console.log(`✗ ${p}`);
const n = Object.keys(ledger.claims).length;
console.log(problems.length ? `launch kit: ${problems.length} problems` : `launch kit: ok (${Object.keys(files).length} files, ${n} claims, each with a receipt)`);
process.exit(problems.length ? 1 : 0);
