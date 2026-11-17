import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { datasetNote } from "../src/__tests__/fixtures/datagov/note";

/**
 * Plan W7.6 acceptance 3, the PDF half, end to end: the note with a
 * data.gov.il block and a CBS block goes through the app's "Export PDF" path
 * (window.__lumen.buildPrintHtml, as e2e/print-golden.spec.ts), is printed
 * to PDF by Chromium (the engine behind "Save as PDF"), and the PDF's text
 * layer, read back with pdftotext, holds every part of both attribution
 * lines: publisher, dataset title, retrieval date, data link and (CBS) the
 * licence's "as is" clause. The unit half is
 * src/__tests__/datagovExportPdf.test.ts.
 *
 * Needs poppler (pdftotext); without it the spec fails rather than skips,
 * because the PDF text is the acceptance. page.pdf() is Playwright's
 * Chromium only: on Firefox and WebKit the spec checks the printed document
 * (the HTML the print dialog would print) and says so in an annotation.
 */

/** pdftotext marks direction runs with embedding characters and wraps lines. */
const plain = (s: string) => s.replace(/[‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lumen-tour-done", "1"));
  await page.goto("/");
  await page.waitForFunction(() => typeof (window as unknown as { __lumen?: { buildPrintHtml?: unknown } }).__lumen?.buildPrintHtml === "function", null, { timeout: 20_000 });
});

test("a data.gov.il and a CBS block keep their attribution lines in the PDF", async ({ page, context, browserName }) => {
  const { a, b, md } = await datasetNote();
  const html = await page.evaluate(([m]) => (window as unknown as { __lumen: { buildPrintHtml: (m: string, n: string) => Promise<string> } }).__lumen.buildPrintHtml(m, "נתונים"), [md] as const);
  const parts = [
    "data.gov.il",
    a.block.title,
    "נשלף 14.11.2026",
    a.block.id,
    'הלשכה המרכזית לסטטיסטיקה (הלמ"ס)',
    b.block.title,
    "14.11.2026",
    "as is",
    "apis.cbs.gov.il",
  ].filter(Boolean);
  const printed = plain(html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  for (const p of parts) expect(printed, `"${p}" in the printed document`).toContain(p);
  if (browserName !== "chromium") {
    test.info().annotations.push({ type: "pdf", description: `page.pdf() is Chromium's: on ${browserName} the printed document was checked, not a PDF` });
    return;
  }
  const printPage = await context.newPage();
  await printPage.goto(new URL("/", page.url()).href);
  await printPage.setContent(html, { waitUntil: "load" });
  await printPage.evaluate(() => document.fonts.ready);
  await printPage.emulateMedia({ media: "print" });
  const pdf = await printPage.pdf({ preferCSSPageSize: true, printBackground: true });
  const file = join(mkdtempSync(join(tmpdir(), "lumen-datagov-")), "datagov.pdf");
  writeFileSync(file, pdf);
  const text = plain(execFileSync("pdftotext", [file, "-"]).toString());
  for (const p of parts) expect(text, `"${p}" in the PDF's text`).toContain(p);
  // Every font the attribution prints in is embedded (it is legal text: it must render the same anywhere).
  const fonts = execFileSync("pdffonts", [file]).toString().split("\n").slice(2).filter(Boolean);
  expect(fonts.filter((l) => / (yes|no) +(yes|no) +(yes|no) +\d+ +\d+\s*$/.exec(l)?.[1] !== "yes")).toEqual([]);
  await printPage.close();
});
