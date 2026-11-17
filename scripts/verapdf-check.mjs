#!/usr/bin/env node
/**
 * Plan W13.F3 — PDF/UA-1 check of Lumen's accessible PDF export.
 *
 *   node scripts/verapdf-check.mjs [folder]            check the PDFs in the folder (default: the 10 Hebrew
 *                                                      golden notes, src/__tests__/fixtures/pdf-ua)
 *   node scripts/verapdf-check.mjs [folder] --print    first print each <note>.html to <note>.pdf
 *                                                               (Chromium, Page.printToPDF with generateTaggedPDF and
 *                                                               generateDocumentOutline, then src/print/pdfUa.ts)
 *   [--verapdf <path>] [--json]
 *
 * Two gates, both must pass:
 *  1. the first gate (src/print/pdfUa.ts inspectPdfUa): tagged, a structure tree, /Lang,
 *     /DisplayDocTitle, a title, pdfuaid:part 1, every Figure with /Alt, no heading level
 *     skipped, every table with TH — on every PDF;
 *  2. veraPDF (https://verapdf.org, not bundled: install it, e.g. on the Mac) with the PDF/UA-1
 *     profile: 0 failed rules on every PDF.
 *
 * Exit 0: both gates pass on every PDF. 1: a PDF fails. 2: usage, or no PDF in the folder (a
 * check of nothing is not a pass). 3: the first gate passes but veraPDF is not installed here,
 * so the PDF/UA-1 run is owed (the owner's Mac). Reads local files only; sends nothing.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
// The golden notes are test fixtures, not an eval/golden set (those are held-out AI eval sets with a
// secret test split; a fixed corpus of PDFs does not fit them). The plan's `eval/golden/pdf-ua` names them.
const DEFAULT = "src/__tests__/fixtures/pdf-ua";
const given = args.find((a) => !a.startsWith("--") && a !== opt("--verapdf"));
const dir = !given || given.replace(/\/+$/, "") === "eval/golden/pdf-ua" ? DEFAULT : given;
if (!existsSync(dir)) {
  console.error("usage: node scripts/verapdf-check.mjs <folder of PDFs> [--print] [--verapdf <path>] [--json]");
  process.exit(2);
}

const { tsImport } = await import("tsx/esm/api");
const ua = await tsImport("../src/print/pdfUa.ts", import.meta.url);

if (args.includes("--print")) {
  const pages = readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
  const { chromium } = await import("@playwright/test").catch(() => import("playwright"));
  const browser = await chromium.launch();
  try {
    for (const f of pages) {
      const page = await browser.newPage();
      // The print document is self-contained (styles inline, images as data:); nothing is fetched.
      await page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
      await page.setContent(readFileSync(join(dir, f), "utf8"), { waitUntil: "load" });
      const lang = await page.evaluate(() => document.documentElement.lang || "en");
      const cdp = await page.context().newCDPSession(page);
      const { data } = await cdp.send("Page.printToPDF", { generateTaggedPDF: true, generateDocumentOutline: true, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
      const tagged = new Uint8Array(Buffer.from(data, "base64"));
      // A fixed date keeps the golden PDFs byte-stable between runs.
      const done = ua.finishPdfUa(tagged, { lang: /^he$/i.test(lang) ? "he-IL" : lang, date: new Date("2026-01-01T00:00:00Z") });
      writeFileSync(join(dir, f.replace(/\.html$/, ".pdf")), done);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
if (!pdfs.length) {
  console.error(`verapdf-check: no PDF in ${dir}: nothing checked, which is not a pass.`);
  process.exit(2);
}

// Gate 1.
const rows = pdfs.map((f) => {
  const r = ua.inspectPdfUa(new Uint8Array(readFileSync(join(dir, f))));
  return { file: f, lang: r.lang, title: r.title, figures: r.figures, tables: r.tables, headings: r.structure.filter((s) => /^H\d$/.test(s)).length, problems: r.problems.map((p) => ua.PROBLEM_TEXT[p]) };
});
const firstOk = rows.every((r) => !r.problems.length);

// Gate 2: veraPDF, when installed.
const candidates = [opt("--verapdf"), process.env.VERAPDF, "verapdf", "/Applications/veraPDF/verapdf", `${process.env.HOME}/verapdf/verapdf`].filter(Boolean);
const verapdf = candidates.find((c) => spawnSync(c, ["--version"], { encoding: "utf8" }).status === 0);
let vera = null;
if (verapdf) {
  const run = spawnSync(verapdf, ["--flavour", "ua1", "--format", "json", ...pdfs.map((f) => resolve(dir, f))], { encoding: "utf8", maxBuffer: 256 << 20 });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.error(`verapdf-check: veraPDF did not return JSON (exit ${run.status}):\n${run.stderr.slice(0, 2000)}`);
    process.exit(1);
  }
  const jobs = report?.report?.jobs ?? [];
  vera = jobs.map((j) => {
    const v = j.validationResult?.[0] ?? j.validationResult ?? {};
    const failedRules = v.details?.failedRules ?? (v.details?.ruleSummaries ?? []).length;
    return { file: (j.itemDetails?.name ?? "").split(/[\\/]/).pop(), compliant: v.compliant === true, failedRules, rules: (v.details?.ruleSummaries ?? []).map((r) => `${r.clause}-${r.testNumber}: ${r.description}`).slice(0, 10) };
  });
}

const out = { folder: dir, pdfs: pdfs.length, firstGate: { pass: firstOk, rows }, verapdf: verapdf ? { binary: verapdf, pass: vera.length === pdfs.length && vera.every((v) => v.compliant), jobs: vera } : null };
if (args.includes("--json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`## PDF/UA-1: ${dir} (${pdfs.length} PDFs)\n`);
  console.log("| file | lang | headings | figures | tables | first gate | veraPDF PDF/UA-1 |\n|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const v = vera?.find((x) => x.file === r.file);
    console.log(`| ${r.file} | ${r.lang ?? "—"} | ${r.headings} | ${r.figures} | ${r.tables} | ${r.problems.length ? `❌ ${r.problems.join("; ")}` : "✅"} | ${v ? (v.compliant ? "✅ 0 failed rules" : `❌ ${v.failedRules} failed: ${v.rules.join("; ")}`) : "not run"} |`);
  }
  console.log("");
  if (!verapdf) console.log("veraPDF is not installed here: the first gate ran; the PDF/UA-1 profile run is owed (install veraPDF, or pass --verapdf <path>, on the Mac).");
}
if (!firstOk || (verapdf && !out.verapdf.pass)) process.exit(1);
process.exit(verapdf ? 0 : 3);
