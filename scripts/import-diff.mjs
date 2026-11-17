#!/usr/bin/env node
/**
 * npm run import:diff (plan W11.P2): one export, imported by lumen-md and by
 * Obsidian Importer, compared metric by metric (scripts/lib/importDiff.mjs).
 *
 *   npm run import:diff -- --lumen <folder> --oracle <folder> [--explain explain.json] [--json] [--out report.md]
 *
 *   --lumen    the folder lumen-md's import wrote (Imported/<name>, or that folder of an exported vault)
 *   --oracle   the folder Obsidian Importer wrote for the same export, with its default settings
 *   --explain  {"<metric>": "why lumen-md has less here"}; covers a shortfall of ≤ 1% only
 *
 *   npm run import:diff [-- --json] [--out report.md]
 *              no folders: the golden table (plan W13.F1) — every format for which Obsidian
 *              Importer publishes test exports and its own output for them
 *              (scripts/lib/importDiffCases.mjs), converted by lumen-md here and compared
 *
 * Exit 1 when the gate fails. Reads the two folders only; sends nothing.
 * Hidden folders (.obsidian, .trash) are not part of either vault.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compareVaults, diffMarkdown, readVault } from "./lib/importDiff.mjs";

const args = process.argv.slice(2);
const opt = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const lumen = opt("--lumen");
const oracle = opt("--oracle");
if (!lumen && !oracle) {
  // The golden table: lumen-md's converters, loaded through tsx, over the importer's fixtures.
  // Some converters read HTML (Keep's rich text): a DOM for them, from the dev dependencies (jsdom, as the tests use).
  if (typeof globalThis.DOMParser === "undefined") {
    const { JSDOM } = await import("jsdom");
    globalThis.DOMParser = new JSDOM("").window.DOMParser;
  }
  const { tsImport } = await import("tsx/esm/api");
  const { runGolden, goldenMarkdown } = await import("./lib/importDiffCases.mjs");
  const conv = await tsImport("../src/storage/import/convert.ts", import.meta.url);
  const g = await runGolden(async (source, files) => conv.convertExport(source, (await conv.openExport(files)).opened, "Imported/golden"));
  const out = args.includes("--json") ? JSON.stringify(g, (k, v) => (v instanceof RegExp ? String(v) : v), 2) + "\n" : goldenMarkdown(g);
  if (opt("--out")) writeFileSync(opt("--out"), out);
  process.stdout.write(out);
  process.exit(g.pass ? 0 : 1);
}
if (!lumen || !oracle) {
  console.error("usage: npm run import:diff -- --lumen <folder> --oracle <folder> [--explain explain.json] [--json] [--out report.md]");
  process.exit(2);
}
const explain = opt("--explain") ? JSON.parse(readFileSync(opt("--explain"), "utf8")) : {};
const r = compareVaults(readVault(lumen), readVault(oracle), explain);
const out = args.includes("--json") ? JSON.stringify(r, null, 2) + "\n" : diffMarkdown(r);
if (opt("--out")) writeFileSync(opt("--out"), out);
process.stdout.write(out);
process.exit(r.pass ? 0 : 1);
