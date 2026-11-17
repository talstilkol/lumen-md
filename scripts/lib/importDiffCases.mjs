/**
 * Plan W13.F1 — the golden table of `npm run import:diff`: every format for
 * which Obsidian Importer publishes its own test exports and its own output
 * for them (copied unchanged into src/__tests__/fixtures/obsidian-importer,
 * see SOURCES.md there). Each case is converted by lumen-md's importer and
 * compared with the importer's recorded output (scripts/lib/importDiff.mjs).
 *
 * The converter is passed in (`convert(source, files) → vault`), so the
 * script loads the TypeScript through tsx and the tests through vitest —
 * the same code either way.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { compareVaults, readVault } from "./importDiff.mjs";

export const FIXTURES = "src/__tests__/fixtures/obsidian-importer";
/** lumen-md's own golden exports (synthetic, Hebrew; see SOURCES.md there). */
export const GOLDEN = "src/__tests__/fixtures/import-golden";

/**
 * One case: lumen-md's `source` over the files of `input` (each under
 * `prefix`), against the oracle folder `oracle` (minus `exclude`: what the
 * importer's defaults leave out, such as trashed notes).
 */
export const CASES = [
  { id: "keep", format: "Google Keep", source: "keep", input: "keep", prefix: "Takeout/Keep/", only: /\.json$/, oracle: "keep-expected", exclude: ["Deleted note.md", "Archived note.md"] },
  { id: "roam-shapes", format: "Roam (JSON)", source: "roam", input: "roam", only: /^shapes\.json$/, oracle: "roam-expected/shapes" },
  { id: "roam-help", format: "Roam (JSON)", source: "roam", input: "roam", only: /^help-graph-excerpt\.json$/, oracle: "roam-expected/help-graph-excerpt" },
  { id: "roam-theme", format: "Roam (JSON)", source: "roam", input: "roam", only: /^small-test-graph\.json$/, oracle: "roam-expected/small-test-graph" },
  { id: "textbundle", format: "TextBundle / TextPack", source: "textbundle", input: "textbundle", oracle: "textbundle-expected" },
  // Obsidian Importer has no Craft converter: its help sends Craft through the Markdown import, which
  // copies the files as they are. So the oracle of Craft is the export itself (our golden, synthetic).
  { id: "craft", format: "Craft (Markdown)", source: "craft", root: GOLDEN, input: "craft", oracle: "craft", oracleIs: "the export as it is (Obsidian's Markdown import)" },
];

/** A folder's files, path relative to it → bytes. */
export function readFiles(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const n of readdirSync(dir).sort()) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(root, p).split("\\").join("/"), new Uint8Array(readFileSync(p)));
    }
  };
  walk(root);
  return out;
}

/** The export of a case, as the wizard would get it. */
export function caseInput(c, root = FIXTURES) {
  const files = new Map();
  for (const [p, data] of readFiles(join(root, c.input))) if (!c.only || c.only.test(p)) files.set(`${c.prefix ?? ""}${p}`, data);
  return files;
}

/** The oracle's vault of a case. */
export function caseOracle(c, root = FIXTURES) {
  const v = readVault(join(root, c.oracle));
  for (const x of c.exclude ?? []) v.delete(x);
  return v;
}

/**
 * Run every case. `convert(source, files)` returns lumen-md's converted vault
 * ({ notes, attachments }). Fails (pass: false) when there is no case at all,
 * or a case has no input or no oracle: a table with nothing in it proves nothing.
 */
export async function runGolden(convert, { root = FIXTURES, cases = CASES } = {}) {
  const results = [];
  for (const c of cases) {
    const base = c.root ?? root;
    const input = existsSync(join(base, c.input)) ? caseInput(c, base) : new Map();
    const oracle = existsSync(join(base, c.oracle)) ? caseOracle(c, base) : new Map();
    if (!input.size || !oracle.size) {
      results.push({ case: c, pass: false, empty: true, rows: [] });
      continue;
    }
    const v = await convert(c.source, input);
    const r = compareVaults(new Map([...v.notes, ...v.attachments]), oracle);
    results.push({ case: c, ...r });
  }
  return { results, pass: results.length > 0 && results.every((r) => r.pass) };
}

/** The golden run as one Markdown table: a row per case, a column per metric. */
export function goldenMarkdown(g) {
  const metrics = ["notes", "attachments", "links", "headings", "tasks", "hebrew", "bidi"];
  const cell = (r, m) => {
    const x = r.rows.find((y) => y.metric === m);
    return x ? `${x.lumen} / ${x.oracle}${x.status === "fail" ? " ❌" : ""}` : "—";
  };
  return [
    `## import:diff — lumen-md / Obsidian Importer, on the importer's own test exports: ${g.pass ? "PASS" : "FAIL"}`,
    "",
    `| case | format | ${metrics.join(" | ")} | |`,
    `|---|---|${metrics.map(() => "---").join("|")}|---|`,
    ...g.results.map((r) => `| ${r.case.id} | ${r.case.format} | ${metrics.map((m) => cell(r, m)).join(" | ")} | ${r.empty ? "❌ no input or no oracle" : r.pass ? "✅" : "❌"} |`),
    "",
    "Each cell is lumen-md / oracle. lumen-md must reach the oracle on every metric (scripts/lib/importDiff.mjs).",
    "",
  ].join("\n");
}
