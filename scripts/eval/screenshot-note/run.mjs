#!/usr/bin/env node
/**
 * Screenshot to note, measured (plan W7.16).
 *
 *   node scripts/eval/screenshot-note/run.mjs make <dir>
 *       Renders the 50 fixtures (cases.mjs) to <dir>/<id>.png in Chromium
 *       (Playwright), with the repo's Assistant font (OFL).
 *   node scripts/eval/screenshot-note/run.mjs measure <dir> [--engine ollama|tesseract-cli] [--model qwen3-vl:2b] [--json out.json]
 *       Runs each screenshot through the engine and the app's own clean-up and
 *       guard (src/ai/screenshotNote.ts toNoteMarkdown), then reports CER per
 *       language (src/ai/ocrCer.ts on the text a reader sees), tables right,
 *       seconds per screenshot, and requests that left this machine.
 *       ollama: the real model (owner step: a Mac M1 with `ollama pull qwen3-vl:2b`).
 *       tesseract-cli: the fallback path's engine (Tesseract 5 on the app's models).
 *       There is no "gold" engine (W10.B11): scoring the gold against itself
 *       gives CER 0% and says nothing about recognition. A run is refused
 *       (exit 1, no report) when the engine did not run on every screenshot
 *       or every output equals its gold (measure.mjs refuseSelfMeasurement).
 *
 * Measured (W10.B11, 2026-11-15, this harness, Tesseract 5.3.4 on the app's
 * heb+eng models): CER he 17.84%, en 8.61%, tables right 0/18. The vision
 * model (ollama) is measured on the owner's Mac.
 *
 * Targets (plan): CER ≤ 5%, tables right ≥ 80%, ≤ 6 s per screenshot on an M1, 0 network requests.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { cases, page } from "./cases.mjs";
import { measureCases, refuseSelfMeasurement, summarize } from "./measure.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const flag = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? dflt : process.argv[i + 1];
};

async function make(dir) {
  const require = createRequire(join(ROOT, "package.json"));
  const { chromium } = require("playwright");
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 800, height: 600 } });
  const p = await ctx.newPage();
  await p.route("**/*", (route) => route.abort());
  const font = pathToFileURL(join(ROOT, "public/fonts/reading/assistant.woff2")).href;
  for (const c of cases()) {
    await p.setContent(page(c, font), { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.locator(".win").screenshot({ path: join(dir, `${c.id}.png`) });
  }
  await browser.close();
  writeFileSync(join(dir, "cases.json"), JSON.stringify(cases().map(({ id, lang, kind, gold }) => ({ id, lang, kind, gold })), null, 1) + "\n");
  console.log(`screenshot-note: ${cases().length} screenshots in ${dir}`);
}

function tesseractCli() {
  const tess = mkdtempSync(join(tmpdir(), "shot-tessdata-"));
  for (const l of ["heb", "eng"]) writeFileSync(join(tess, `${l}.traineddata`), gunzipSync(readFileSync(join(ROOT, `public/tesseract/lang/${l}.traineddata.gz`))));
  return async (file) => {
    const r = spawnSync("tesseract", [file, "stdout", "-l", "heb+eng", "--tessdata-dir", tess, "--oem", "1", "--psm", "6"], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr.slice(0, 200));
    return r.stdout;
  };
}

function ollama(model, prompt) {
  const base = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(base)) throw new Error(`OLLAMA_HOST must be this machine (0 network requests): ${base}`);
  return async (file, lang) => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: prompt(lang), images: [readFileSync(file).toString("base64")] }], options: { temperature: 0 } }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    return (await res.json()).message?.content ?? "";
  };
}

const ENGINES = ["ollama", "tesseract-cli"];

async function measure(dir) {
  const engine = flag("--engine", "ollama");
  if (!ENGINES.includes(engine)) {
    console.error(`screenshot-note: --engine ${engine} is not an engine (${ENGINES.join(", ")}). ${engine === "gold" ? "Scoring the gold against itself measures nothing (W10.B11)." : ""}`.trim());
    process.exit(2);
  }
  const { tsImport } = await import("tsx/esm/api");
  const S = await tsImport("../../../src/ai/screenshotNote.ts", import.meta.url);
  const C = await tsImport("../../../src/ai/ocrCer.ts", import.meta.url);
  const items = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
  const model = flag("--model", S.SCREENSHOT_MODEL);
  const run = engine === "tesseract-cli" ? tesseractCli() : ollama(model, S.screenshotPrompt);
  const result = await measureCases(items, run, { S, C, fileOf: (it) => join(dir, `${it.id}.png`) });
  const problems = refuseSelfMeasurement(items, result);
  if (problems.length) {
    for (const p of problems) console.error(`screenshot-note: REFUSED — ${p}`);
    process.exit(1);
  }
  const report = summarize(result, { engine, model: engine === "ollama" ? model : null });
  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  console.log(`screenshot-note (${engine}${report.model ? " " + report.model : ""}): CER he ${pct(report.perLang.he.cer)}, en ${pct(report.perLang.en.cer)} (target ≤ 5%); tables right ${report.tables.right}/${report.tables.of} (target ≥ 80%); code fenced ${report.codeBlocks.fenced}/${report.codeBlocks.of}; ${report.secondsMean.toFixed(2)} s mean, ${report.secondsMax.toFixed(2)} s max (target ≤ 6 s on an M1); engine ran ${report.engineCalls}/${report.n}, ${report.identicalToGold} outputs identical to gold`);
  const out = flag("--json");
  if (out) writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
}

const [cmd, dir] = process.argv.slice(2);
if (cmd === "make" && dir) await make(dir);
else if (cmd === "measure" && dir) await measure(dir);
else {
  console.error("usage: run.mjs make <dir> | measure <dir> [--engine ollama|tesseract-cli]");
  process.exit(2);
}
