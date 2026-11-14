#!/usr/bin/env node
/**
 * The review of every plugin and theme version, with a scorecard (plan
 * W11.S14): src/plugins/runtime/review.ts on each version in the registry,
 * or on one folder.
 *
 *   node scripts/plugins/review.mjs                       # every version → public/plugins/examples/scorecards.json
 *   node scripts/plugins/review.mjs --check               # exit 1 when scorecards.json is stale or a version fails
 *   node scripts/plugins/review.mjs --dir <version dir> [--previous <dir>] [--json]
 *                                                         # one version (a submission), scorecard on stdout
 *
 * A folder holds lumen-plugin.json, its main (and ui) entry, any *.css,
 * an optional package-lock.json and an optional source/ folder (the readable
 * source when main is a build). Dependencies are checked offline against
 * security/known-bad.json (the list `npm run audit:lock` uses); `npm audit`
 * needs the registry and runs on the Mac (`--npm-audit`).
 *
 * Exit 1 when a reviewed version fails: it is not listed, and a listed one is
 * delisted by its scorecard's `delistBy` (24 hours).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "../..");
if (!process.execArgv.includes("--import")) {
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(join(ROOT, "scripts/lib/ts-register.mjs")).href, SELF, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const { reviewPluginVersion } = await import(pathToFileURL(join(ROOT, "src/plugins/runtime/review.ts")).href);
const { inRange } = await import(pathToFileURL(join(ROOT, "scripts/audit-lock.mjs")).href);
const knownBad = JSON.parse(readFileSync(join(ROOT, "security/known-bad.json"), "utf8")).entries.filter((e) => e.file?.endsWith("package-lock.json") || e.file?.endsWith("package.json"));
/** Origins a stylesheet may load from. Empty: themes ship their fonts. */
const CSS_ALLOW = [];

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function readVersion(dir) {
  const manifestText = readFileSync(join(dir, "lumen-plugin.json"), "utf8");
  const m = JSON.parse(manifestText);
  const read = (p) => (p && existsSync(join(dir, p)) ? readFileSync(join(dir, p), "utf8") : undefined);
  const css = Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith(".css")).map((n) => [n, readFileSync(join(dir, n), "utf8")]));
  const srcDir = join(dir, "source");
  const source = existsSync(srcDir) ? readdirSync(srcDir).map((n) => readFileSync(join(srcDir, n), "utf8")).join("\n") : undefined;
  return { manifest: manifestText, main: read(m.main ?? "main.js") ?? "", ui: read(m.ui), css, source, lockfile: read("package-lock.json") };
}

async function review(dir, previousDir, extra = {}) {
  const v = readVersion(dir);
  const t0 = performance.now();
  const card = await reviewPluginVersion({ ...v, ...(previousDir ? { previousManifest: readFileSync(join(previousDir, "lumen-plugin.json"), "utf8") } : {}), knownBad, inRange, cssAllow: CSS_ALLOW, ...extra });
  return { card, ms: Math.round(performance.now() - t0) };
}

function npmAudit(dir) {
  if (!existsSync(join(dir, "package-lock.json"))) return null;
  const r = spawnSync("npm", ["audit", "--json", "--package-lock-only"], { cwd: dir, encoding: "utf8" });
  try {
    return JSON.parse(r.stdout).metadata?.vulnerabilities ?? null;
  } catch {
    return { error: (r.stderr || "npm audit failed").trim() };
  }
}

const line = (c, ms) => `${c.passed ? "  ok" : "FAIL"} ${c.id}@${c.version}  ${c.grade} ${c.score}  ${ms} ms  ${c.findings.map((f) => `${f.severity}:${f.rule}`).join(" ") || "no findings"}`;

if (opt("--dir")) {
  const dir = resolve(opt("--dir"));
  const { card, ms } = await review(dir, opt("--previous") ? resolve(opt("--previous")) : undefined);
  if (args.includes("--npm-audit")) card.npmAudit = npmAudit(dir);
  if (args.includes("--json")) console.log(JSON.stringify(card, null, 2));
  else {
    console.log(line(card, ms));
    for (const f of card.findings) console.log(`     ${f.severity} ${f.rule}: ${f.detail}`);
  }
  process.exit(card.passed ? 0 : 1);
}

const DIR = join(ROOT, "public/plugins/examples");
const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8"));
const cards = [];
for (const p of index.plugins) {
  let previous;
  for (const v of p.versions) {
    // The scorecards are a committed file: a fixed review time keeps them reproducible.
    const { card, ms } = await review(join(DIR, v.path), previous, { now: Date.parse("2026-01-01T00:00:00Z") });
    console.log(line(card, ms));
    cards.push({ ...card, path: v.path });
    previous = join(DIR, v.path);
  }
}
const out = JSON.stringify({ review: 1, cards }, null, 2) + "\n";
const file = join(DIR, "scorecards.json");
if (args.includes("--check")) {
  const stale = !existsSync(file) || readFileSync(file, "utf8") !== out;
  if (stale) console.log("scorecards.json is out of date: run node scripts/plugins/review.mjs");
  process.exit(stale || cards.some((c) => !c.passed) ? 1 : 0);
}
writeFileSync(file, out);
console.log(`${cards.length} versions reviewed → ${file}`);
process.exit(cards.some((c) => !c.passed) ? 1 : 0);
