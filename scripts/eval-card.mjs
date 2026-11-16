#!/usr/bin/env node
/**
 * Plan W11.I18 — `npm run eval:card`: every eval report has a complete card.
 *
 *   npm run eval:card                       every *.json under eval/results and eval/cards
 *   npm run eval:card -- <file|dir> …       these reports
 *   npm run eval:card -- --json             one line of JSON per report
 *   npm run eval:card -- --agent <id>       only the reports of one agent (`"agent": "<id>"` at the top level, W13.W12);
 *                                           exit 1 when it has none
 *
 * Exit 1 when any report has no card or its card is missing a field
 * (scripts/lib/evalCard.mjs lists them). Exit 0 with nothing to check.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cardOf, validateCard } from "./lib/evalCard.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_DIRS = ["eval/results", "eval/cards"];

/** @param {string} p */
function jsonFiles(p) {
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return [p];
  return readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsonFiles(join(p, e.name)) : e.name.endsWith(".json") ? [join(p, e.name)] : []));
}

/**
 * @param {string[]} paths
 * @param {{ root?: string }} [o]
 * @returns {{ file: string, tag?: string, problems: string[] }[]}
 */
export function checkReports(paths, { root = ROOT } = {}) {
  const targets = (paths.length ? paths : DEFAULT_DIRS).map((p) => resolve(root, p));
  return targets.flatMap(jsonFiles).map((f) => {
    const file = relative(root, f);
    let report;
    try {
      report = JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      return { file, problems: [`not JSON (${e.message})`] };
    }
    const card = cardOf(report);
    return { file, tag: card?.tag, problems: validateCard(card) };
  });
}

/** The agent a report belongs to (its top-level `agent`), or null. */
function agentOf(root, file) {
  try {
    const j = JSON.parse(readFileSync(resolve(root, file), "utf8"));
    return typeof j?.agent === "string" ? j.agent : null;
  } catch {
    return null;
  }
}

export function main(argv, { root = ROOT, log = console.log, err = console.error } = {}) {
  const json = argv.includes("--json");
  const ai = argv.indexOf("--agent");
  const agent = ai >= 0 ? argv[ai + 1] : null;
  if (ai >= 0 && (!agent || agent.startsWith("--"))) {
    err("eval:card: --agent needs an agent id");
    return 2;
  }
  const paths = argv.filter((a, i) => !a.startsWith("--") && !(ai >= 0 && i === ai + 1));
  let results = checkReports(paths, { root });
  if (agent) {
    results = results.filter((r) => agentOf(root, r.file) === agent);
    if (!results.length) {
      err(`eval:card: no report for the agent "${agent}"`);
      return 1;
    }
  }
  for (const r of results) {
    if (json) log(JSON.stringify(r));
    else if (r.problems.length) err(`✗ ${r.file}\n    ${r.problems.join("\n    ")}`);
    else log(`✓ ${r.file} (${r.tag})`);
  }
  const bad = results.filter((r) => r.problems.length).length;
  if (!json) log(results.length ? `eval:card: ${results.length - bad}/${results.length} reports carry a complete card` : "eval:card: no reports to check");
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
