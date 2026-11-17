#!/usr/bin/env node
/**
 * W12.S6, offline: the 8 theme screens as a SPECIMEN — static markup in the
 * app's own classes (.cm-editor, .prose-lumen, .callout, a Bases-like grid,
 * a settings dialog) styled by the app's compiled stylesheet plus each
 * gallery theme — rendered in headless Chromium in RTL and LTR, light and
 * dark, then judged by src/plugins/runtime/rtlScreens.ts (mirror, overflow,
 * axe serious/critical).
 *
 * It is NOT the running app: it checks what a theme's CSS does to the app's
 * classes, and it is the check a submitted theme can get anywhere. The
 * badge's screens come from the app itself (e2e/themes-rtl-screens.spec.ts,
 * which writes the same results.json shape); this script never writes the
 * scorecards.
 *
 *   node scripts/themes/rtl-screens-specimen.mjs --css <compiled app.css> --out <dir> [--theme <file.css> ...] [--axe <axe.min.js>]
 *
 * Writes <dir>/results.json ({ themeId: { screen: { rtl, ltr } } }),
 * <dir>/report.json (the reasons) and one PNG per theme, screen and direction.
 * Exit 1 when a gallery theme fails a screen.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { PROBE, SCREENS } from "./rtl-probe.mjs";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "../..");
if (!process.execArgv.includes("--import")) {
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(join(ROOT, "scripts/lib/ts-register.mjs")).href, SELF, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
const { judgeScreen, mirrorMisses } = await import(pathToFileURL(join(ROOT, "src/plugins/runtime/rtlScreens.ts")).href);

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const many = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const appCss = readFileSync(resolve(opt("--css") ?? "app.css"), "utf8");
const out = resolve(opt("--out") ?? "test-results/themes-rtl-specimen");
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
const axePath = opt("--axe") ?? (() => { try { return require.resolve("axe-core/axe.min.js"); } catch { return null; } })();
const AXE = axePath && existsSync(axePath) ? readFileSync(axePath, "utf8") : null;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const GALLERY = join(ROOT, "public/themes/examples");
const index = JSON.parse(readFileSync(join(GALLERY, "index.json"), "utf8"));
const themes = [
  { id: "(no theme)", css: "" },
  ...index.themes.map((t) => ({ id: t.id, css: readFileSync(join(GALLERY, t.path, "theme.css"), "utf8"), gallery: true })),
  ...many("--theme").map((f) => ({ id: basename(f), css: readFileSync(resolve(f), "utf8") })),
];

const he = (dir) => dir === "rtl";
/**
 * The specimen body: the 8 screens, each in a section with a data-rtl-screen.
 * The words are the same in both directions (a Hebrew note in an English UI
 * is the LTR case): only `dir` changes, so every box can be compared with its
 * mirror image.
 */
function body(dir) {
  const t = (h) => h;
  return `
<section data-rtl-screen="editor"><div class="cm-editor" style="display:flex;border:1px solid hsl(var(--border));min-height:120px">
  <div class="cm-gutters" style="padding-inline:8px;color:hsl(var(--fg-muted))"><div>1</div><div>2</div><div>3</div></div>
  <div class="cm-content" style="flex:1;padding-inline:8px" dir="auto">
    <div class="cm-line"># ${t("כותרת המסמך", "Document title")}</div>
    <div class="cm-line">${t("שורה בעברית עם", "A line with")} **${t("הדגשה", "bold")}**</div>
    <div class="cm-line">- ${t("פריט ברשימה", "a list item")}</div>
  </div></div></section>
<section data-rtl-screen="content"><article class="prose-lumen" dir="${dir}">
  <h1>${t("בדיקת ערכת נושא", "Theme check")}</h1>
  <p>${t("פסקה בעברית עם מילה באנגלית (theme) ומספר 2026.", "A paragraph with a Hebrew word (עברית) and a number 2026.")}</p>
  <blockquote><p>${t("ציטוט קצר.", "A short quote.")}</p></blockquote>
  <h2>${t("רשימות", "Lists")}</h2>
  <ul><li>${t("פריט ראשון", "First item")}</li><li>${t("פריט שני", "Second item")}<ul><li>${t("מקונן", "Nested")}</li></ul></li></ul>
  <ol><li>${t("אחד", "One")}</li><li>${t("שניים", "Two")}</li></ol>
  <h2>${t("טבלה", "Table")}</h2>
  <table><thead><tr><th>${t("שם", "Name")}</th><th>${t("עיר", "City")}</th><th style="text-align:end">${t("ציון", "Score")}</th></tr></thead>
  <tbody><tr><td>${t("דנה", "Dana")}</td><td>${t("חיפה", "Haifa")}</td><td style="text-align:end">91</td></tr><tr><td>${t("יוסי", "Yossi")}</td><td>${t("אילת", "Eilat")}</td><td style="text-align:end">78</td></tr></tbody></table>
  <div class="callout callout-note"><div class="callout-title">${t("הערה", "Note")}</div><div class="callout-content"><p>${t("תוכן ההערה, בשתי שורות כדי שיהיה לה גובה.", "The note's content, two lines so it has height.")}</p></div></div>
  <div class="callout callout-warning"><div class="callout-title">${t("אזהרה", "Warning")}</div><div class="callout-content"><p>${t("זהירות.", "Careful.")}</p></div></div>
  <p>${t("הפקודה", "The command")} <code>npm run build</code> ${t("בונה את האתר, ו-", "builds the site, and ")}<code>git status</code> ${t("מראה שינויים.", "shows changes.")}</p>
  <pre dir="ltr"><code>const שלום = "world";\nconsole.log(שלום);</code></pre>
</article></section>
<section data-rtl-screen="bases"><div role="table" aria-label="${t("בסיס", "Base")}" style="display:grid;grid-template-columns:repeat(3,1fr);border:1px solid hsl(var(--border))">
  <div role="row" style="display:contents"><span role="columnheader">${t("כותרת", "Title")}</span><span role="columnheader">${t("סטטוס", "Status")}</span><span role="columnheader">${t("תאריך", "Date")}</span></div>
  <div role="row" style="display:contents"><span role="cell">${t("פתק א", "Note A")}</span><span role="cell">${t("טיוטה", "Draft")}</span><span role="cell">2026-11-17</span></div>
</div></section>
<section data-rtl-screen="settings"><div role="dialog" aria-label="${t("הגדרות", "Settings")}" style="border:1px solid hsl(var(--border));padding:12px;max-width:420px">
  <h2>${t("הגדרות", "Settings")}</h2>
  <fieldset><legend>${t("מראה", "Appearance")}</legend>
    <label>${t("גודל גופן", "Font size")} <input type="number" value="16"></label>
    <label>${t("ערכה", "Theme")} <select><option>${t("בהירה", "Light")}</option></select></label>
  </fieldset></div></section>`;
}

const ROOTS = {
  editor: "[data-rtl-screen=editor] .cm-editor",
  preview: "[data-rtl-screen=content] .prose-lumen",
  table: "[data-rtl-screen=content] .prose-lumen",
  lists: "[data-rtl-screen=content] .prose-lumen",
  callouts: "[data-rtl-screen=content] .prose-lumen",
  "code-in-hebrew": "[data-rtl-screen=content] .prose-lumen",
  bases: "[data-rtl-screen=bases] [role=table]",
  settings: "[data-rtl-screen=settings] [role=dialog]",
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 1, bypassCSP: true });
await page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
const html = (dir, scheme, css) =>
  `<!doctype html><html lang="${he(dir) ? "he" : "en"}" dir="${dir}" class="${scheme === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><title>specimen</title><style>${appCss}</style><style>body{padding:16px;margin:0;background:hsl(var(--bg));color:hsl(var(--fg))} section{margin-block:16px} [data-rtl-screen=editor]{position:relative;height:150px;overflow:hidden}</style><style id="theme">${css}</style></head><body><main>${body(dir)}</main></body></html>`;

async function measure(dir, scheme, css, shotPrefix) {
  await page.setContent(html(dir, scheme, css), { waitUntil: "load" });
  const res = {};
  for (const [screen, root] of Object.entries(ROOTS)) {
    const r = await page.evaluate(`(${PROBE})(${JSON.stringify({ root, only: SCREENS[screen].only })})`);
    res[screen] = r;
  }
  const axe = {};
  if (AXE) {
    await page.evaluate(AXE);
    for (const [screen, root] of Object.entries(ROOTS))
      axe[screen] = await page.evaluate(
        async ([r, only]) =>
          (await window.axe.run({ include: only.split(",").map((o) => [`${r} ${o}`]) }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .flatMap((v) => v.nodes.map((n) => `${v.id}:${n.target.join(" ")}`)),
        [root, SCREENS[screen].only],
      );
  }
  if (shotPrefix) await page.screenshot({ path: `${shotPrefix}-${dir}-${scheme}.png`, fullPage: true });
  return { res, axe };
}

const results = {};
const report = {};
const baseline = {};
let failed = 0;
for (const th of themes) {
  const safe = th.id.replace(/[^\w.@-]+/g, "_");
  results[th.id] = {};
  report[th.id] = {};
  for (const scheme of ["light", "dark"]) {
    const rtl = await measure("rtl", scheme, th.css, join(out, safe));
    const ltr = await measure("ltr", scheme, th.css, join(out, safe));
    for (const screen of Object.keys(ROOTS)) {
      const key = `${screen}/${scheme}`;
      const axeOf = (r, d) => (r.axe[screen] ?? []).filter((a) => !th.css || !baseline[key]?.axe[d].has(a));
      const m = { viewport: rtl.res[screen].viewport, overflowX: { rtl: rtl.res[screen].overflowX, ltr: ltr.res[screen].overflowX }, rtl: rtl.res[screen].boxes, ltr: ltr.res[screen].boxes, axe: { rtl: axeOf(rtl, "rtl"), ltr: axeOf(ltr, "ltr") } };
      // The app with no theme is the reference: what it already does is not held against a theme.
      if (!th.css) baseline[key] = { misses: new Set(mirrorMisses(m).map((x) => x.key)), axe: { rtl: new Set(rtl.axe[screen] ?? []), ltr: new Set(ltr.axe[screen] ?? []) } };
      const v = judgeScreen(m, undefined, th.css ? baseline[key].misses : undefined);
      const prev = results[th.id][screen];
      const worst = (a, b) => (a === "fail" || b === "fail" ? "fail" : a === "owed" || b === "owed" ? "owed" : "pass");
      results[th.id][screen] = { rtl: worst(prev?.rtl ?? "pass", v.rtl), ltr: worst(prev?.ltr ?? "pass", v.ltr) };
      if (v.reasons.length) (report[th.id][`${screen}/${scheme}`] = v.reasons);
      if (th.gallery && (v.rtl === "fail" || v.ltr === "fail")) failed++;
    }
  }
  const line = Object.entries(results[th.id]).map(([s, v]) => `${s}:${v.rtl}/${v.ltr}`).join(" ");
  console.log(`${th.id.padEnd(32)} ${line}`);
}
await browser.close();
delete results["(no theme)"];
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 1) + "\n");
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1) + "\n");
console.log(`specimen (not the running app) → ${out}`);
process.exit(failed ? 1 : 0);
