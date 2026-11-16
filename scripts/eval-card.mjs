#!/usr/bin/env node
/**
 * Plan W11.I18 — `npm run eval:card`: every eval report has a complete card.
 *
 *   npm run eval:card                       every *.json under eval/results and eval/cards
 *   npm run eval:card -- <file|dir> …       these reports
 *   npm run eval:card -- --json             one line of JSON per report
 *   npm run eval:card -- --agent <id>       the card of one writing agent (W13.W2):
 *                                           eval/cards/writing/<id>.json, or any report whose card.agent is <id>;
 *                                           exit 1 when the agent has no card
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

/**
 * The reports that carry one agent's card: its file under eval/cards/writing,
 * and every report in the default folders whose card names the agent.
 * @param {string} agent
 * @param {{ root?: string }} [o]
 */
export function agentReports(agent, { root = ROOT } = {}) {
  const own = join(root, "eval/cards/writing", `${agent}.json`);
  const named = DEFAULT_DIRS.flatMap((d) => jsonFiles(resolve(root, d))).filter((f) => {
    try {
      return JSON.parse(readFileSync(f, "utf8"))?.card?.agent === agent;
    } catch {
      return false;
    }
  });
  return [...new Set([...(existsSync(own) ? [own] : []), ...named])].map((f) => relative(root, f));
}

export function main(argv, { root = ROOT, log = console.log, err = console.error } = {}) {
  const json = argv.includes("--json");
  const ai = argv.indexOf("--agent");
  if (ai >= 0) {
    const agent = argv[ai + 1];
    if (!agent || agent.startsWith("--")) {
      err("eval:card: --agent needs an agent id");
      return 1;
    }
    const files = agentReports(agent, { root });
    if (!files.length) {
      err(`eval:card: no card for agent "${agent}" (expected eval/cards/writing/${agent}.json)`);
      return 1;
    }
    argv = [...argv.slice(0, ai), ...argv.slice(ai + 2), ...files];
  }
  const results = checkReports(argv.filter((a) => !a.startsWith("--")), { root });
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
