#!/usr/bin/env node
/**
 * The RTL check of every theme in the gallery (plan W12.S6), on top of the
 * W11.S14 review: each theme is reviewed as a CSS-only version
 * (src/plugins/runtime/review.ts: licence, no remote CSS), then checked for
 * physical left/right CSS and WCAG 2.2 contrast in light and dark
 * (src/theme/rtlCheck.ts). The cards go to public/themes/examples/scorecards.json.
 *
 *   node scripts/themes/rtl-check.mjs            # write scorecards.json
 *   node scripts/themes/rtl-check.mjs --check    # exit 1 when it is stale or a theme fails
 *   node scripts/themes/rtl-check.mjs --css <file> [--json]   # one stylesheet (a submission)
 *   node scripts/themes/rtl-check.mjs --screens <results.json> # merge a browser run's screenshots (Mac)
 *
 * The "tested in RTL" badge needs the 8 screens in RTL and LTR as well,
 * which only a browser run gives; without one, `screens` is "owed".
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "../..");
if (!process.execArgv.includes("--import")) {
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(join(ROOT, "scripts/lib/ts-register.mjs")).href, SELF, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const { reviewPluginVersion } = await import(pathToFileURL(join(ROOT, "src/plugins/runtime/review.ts")).href);
const { rtlThemeCard, themeTokens, withRtl } = await import(pathToFileURL(join(ROOT, "src/theme/rtlCheck.ts")).href);

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const app = themeTokens(readFileSync(join(ROOT, "src/index.css"), "utf8"));
const NOW = Date.parse("2026-01-01T00:00:00Z");

async function card(theme, css, screens) {
  const manifest = { schema: 1, id: theme.id, name: theme.name, version: theme.version, description: theme.description, author: theme.author, license: theme.license, main: "theme.js", capabilities: [] };
  const base = await reviewPluginVersion({ manifest, main: "", css: { "theme.css": css }, now: NOW });
  return withRtl(base, rtlThemeCard({ id: theme.id, version: theme.version, css, app, screens }));
}

const line = (c) => `${c.rtlTested ? "RTL ✓" : "     "} ${c.passed ? "  ok" : "FAIL"} ${c.id}@${c.version}  physical:${c.rtl.checks.physical} contrast:${c.rtl.checks.contrast} screens:${c.rtl.checks.screens}`;

if (opt("--css")) {
  const css = readFileSync(resolve(opt("--css")), "utf8");
  const c = await card({ id: "lumen.theme.submission", name: "submission", version: "0.0.0", license: "MIT", author: "submitter", description: "A theme submitted for review." }, css);
  if (args.includes("--json")) console.log(JSON.stringify(c, null, 2));
  else {
    console.log(line(c));
    for (const f of c.findings) console.log(`     ${f.severity} ${f.rule}: ${f.detail}`);
  }
  process.exit(c.rtl.checks.physical === "pass" && c.rtl.checks.contrast === "pass" && c.passed ? 0 : 1);
}

const DIR = join(ROOT, "public/themes/examples");
const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8"));
const screensRun = opt("--screens") ? JSON.parse(readFileSync(resolve(opt("--screens")), "utf8")) : {};
const cards = [];
for (const t of index.themes) {
  const c = await card(t, readFileSync(join(DIR, t.path, "theme.css"), "utf8"), screensRun[t.id]);
  console.log(line(c));
  cards.push({ ...c, path: t.path });
}
const out = JSON.stringify({ review: 1, rtl: 1, cards }, null, 2) + "\n";
const file = join(DIR, "scorecards.json");
const failing = cards.some((c) => !c.passed || c.rtl.checks.physical === "fail" || c.rtl.checks.contrast === "fail");
if (args.includes("--check")) {
  const stale = !existsSync(file) || (!opt("--screens") && readFileSync(file, "utf8") !== out);
  if (stale) console.log("public/themes/examples/scorecards.json is out of date: run node scripts/themes/rtl-check.mjs");
  process.exit(stale || failing ? 1 : 0);
}
writeFileSync(file, out);
console.log(`${cards.length} themes checked → ${file}`);
process.exit(failing ? 1 : 0);
