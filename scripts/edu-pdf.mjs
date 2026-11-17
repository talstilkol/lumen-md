#!/usr/bin/env node
/**
 * The teacher's PDF (plan W11.P14): edu/teacher.he.md → edu/dist/lumen-teacher.he.pdf,
 * printed by headless Chromium (Playwright), so the Hebrew is laid out by a
 * real browser. Nothing is fetched: the page is built from the Markdown.
 *
 *   node scripts/edu-pdf.mjs [--out edu/dist/lumen-teacher.he.pdf]
 *   (CHROMIUM=/path/to/chrome to use a given browser)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { markdownToHtml } from "./lib/eduKit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(ROOT, "edu", "dist", "lumen-teacher.he.pdf");
const md = readFileSync(join(ROOT, "edu", "teacher.he.md"), "utf8");
const html = markdownToHtml(md, { lang: "he", title: "Lumen בכיתה" });

const { chromium } = await import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  const page = await browser.newPage();
  // No network: the page is self-contained.
  await page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
  await page.setContent(html, { waitUntil: "load" });
  const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, pdf);
  writeFileSync(out.replace(/\.pdf$/, ".html"), html);
  console.log(`edu-pdf: ${out} (${pdf.length} bytes)`);
} finally {
  await browser.close();
}
