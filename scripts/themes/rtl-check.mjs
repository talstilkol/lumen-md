#!/usr/bin/env node
/**
 * The RTL check of every theme in the gallery (plan W12.S6), on top of the
 * W11.S14 review (#701's design, src/plugins/runtime/review.ts): each theme
 * is reviewed as a CSS-only version (licence, public source, no remote CSS),
 * then checked for physical left/right CSS and WCAG 2.2 contrast in light and
 * dark (src/plugins/runtime/rtlCheck.ts). Like the plugins' scorecards
 * (scripts/review-plugins.mjs), one file per version goes to
 * public/themes/examples/scorecards/<id>@<version>.json.
 *
 *   node scripts/themes/rtl-check.mjs            # write the scorecards
 *   node scripts/themes/rtl-check.mjs --check    # exit 1 when one is missing or stale, or a theme fails
 *   node scripts/themes/rtl-check.mjs --css <file> [--repository <https url>] [--json]   # one stylesheet (a submission)
 *   node scripts/themes/rtl-check.mjs --screens <results.json> # merge a browser run's screenshots (Mac)
 *   node scripts/themes/rtl-check.mjs --measures <measures.json> # judge e2e/themes-rtl-screens.spec.ts's run and merge it
 *
 * The "tested in RTL" badge needs the 8 screens in RTL and LTR as well,
 * which only a browser run gives; without one, `screens` is "owed".
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "../..");
if (!process.execArgv.includes("--import")) {
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(join(ROOT, "scripts/lib/ts-register.mjs")).href, SELF, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const { reviewPluginVersion } = await import(pathToFileURL(join(ROOT, "src/plugins/runtime/review.ts")).href);
const { rtlThemeCard, themeTokens, withRtl } = await import(pathToFileURL(join(ROOT, "src/plugins/runtime/rtlCheck.ts")).href);

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const app = themeTokens(readFileSync(join(ROOT, "src/index.css"), "utf8"));
/** A scorecard without what changes on every run (as scripts/review-plugins.mjs compares them). */
const stable = (c) => JSON.stringify({ ...c, reviewedAt: undefined, durationMs: undefined });

async function card(theme, css, { screens, inRepo }) {
  const manifest = { schema: 1, id: theme.id, name: theme.name, version: theme.version, description: theme.description, author: theme.author, license: theme.license, main: "theme.js", capabilities: [], ...(theme.repository ? { repository: theme.repository } : {}) };
  const base = await reviewPluginVersion({ manifest, main: "", css, inRepo });
  return withRtl(base, rtlThemeCard({ id: theme.id, version: theme.version, css, app, screens }));
}

const line = (c) => `${c.rtlTested ? "RTL ✓" : "     "} ${c.passed ? "  ok" : "FAIL"} ${c.id}@${c.version}  ${c.grade} ${c.score}  physical:${c.rtl.checks.physical} contrast:${c.rtl.checks.contrast} screens:${c.rtl.checks.screens}`;

if (opt("--css")) {
  const css = readFileSync(resolve(opt("--css")), "utf8");
  const c = await card({ id: "lumen.theme.submission", name: "submission", version: "0.0.0", license: opt("--license") ?? "MIT", author: "submitter", description: "A theme submitted for review.", repository: opt("--repository") }, css, { inRepo: false });
  if (args.includes("--json")) console.log(JSON.stringify(c, null, 2));
  else {
    console.log(line(c));
    for (const f of c.findings) console.log(`     ${f.severity} ${f.rule}: ${f.detail}`);
  }
  process.exit(c.rtl.checks.physical === "pass" && c.rtl.checks.contrast === "pass" && c.passed ? 0 : 1);
}

const DIR = join(ROOT, "public/themes/examples");
const OUT = join(DIR, "scorecards");
const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8"));
let screensRun = opt("--screens") ? JSON.parse(readFileSync(resolve(opt("--screens")), "utf8")) : {};
if (opt("--measures")) {
  // e2e/themes-rtl-screens.spec.ts: { themeId | "(no theme)": { he: { screen: probe }, en: { … } } } → verdicts (src/plugins/runtime/rtlScreens.ts).
  const { screensForCard } = await import(pathToFileURL(join(ROOT, "src/plugins/runtime/rtlScreens.ts")).href);
  const raw = JSON.parse(readFileSync(resolve(opt("--measures")), "utf8"));
  const toMeasures = (run) =>
    Object.fromEntries(
      Object.keys(run?.he ?? {})
        .filter((s) => run.en?.[s])
        .map((s) => [s, { viewport: run.he[s].viewport, overflowX: { rtl: run.he[s].overflowX, ltr: run.en[s].overflowX }, rtl: run.he[s].boxes, ltr: run.en[s].boxes, axe: { rtl: run.he[s].axe ?? [], ltr: run.en[s].axe ?? [] } }]),
    );
  const base = toMeasures(raw["(no theme)"]);
  screensRun = Object.fromEntries(Object.entries(raw).filter(([id]) => id !== "(no theme)").map(([id, run]) => [id, screensForCard(toMeasures(run), base)]));
}
const cards = [];
for (const t of index.themes) {
  const c = await card(t, readFileSync(join(DIR, t.path, "theme.css"), "utf8"), { screens: screensRun[t.id], inRepo: true });
  console.log(line(c));
  cards.push({ ...c, path: t.path });
}
const file = (c) => join(OUT, `${c.id}@${c.version}.json`);
const failing = cards.filter((c) => !c.passed || c.rtl.checks.physical === "fail" || c.rtl.checks.contrast === "fail");
if (args.includes("--check")) {
  const stale = opt("--screens") || opt("--measures") ? [] : cards.filter((c) => !existsSync(file(c)) || stable(JSON.parse(readFileSync(file(c), "utf8"))) !== stable(c));
  for (const c of stale) console.log(`stale or missing: ${file(c)} (run node scripts/themes/rtl-check.mjs)`);
  process.exit(stale.length || failing.length ? 1 : 0);
}
mkdirSync(OUT, { recursive: true });
for (const c of cards) writeFileSync(file(c), JSON.stringify(c, null, 2) + "\n");
console.log(`${cards.length} themes checked → ${OUT}`);
process.exit(failing.length ? 1 : 0);
