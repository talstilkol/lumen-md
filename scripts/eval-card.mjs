#!/usr/bin/env node
/**
 * Plan W11.I18 — `npm run eval:card`: every eval report has a complete card.
 *
 *   npm run eval:card                       every *.json under eval/results and eval/cards
 *   npm run eval:card -- <file|dir> …       these reports
 *   npm run eval:card -- --json             one line of JSON per report
 *   npm run eval:card -- --agent <id>       the writing agent's card (eval/cards/writing/<id>.json), W13.W2
 *   npm run eval:card -- --suite writing --check
 *                                           every writing eval set (eval/writing/<agent>) has a complete,
 *                                           current card: its dataset version is the set's manifest, and the
 *                                           set has ≥ 150 items in Hebrew and in English
 *
 * Exit 1 when any report has no card or its card is missing a field
 * (scripts/lib/evalCard.mjs lists them). Exit 0 with nothing to check.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
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

/** W13.W2: the dataset version a writing card must carry — the manifest's version and its files' digests. */
export function writingSetVersion(root, agent) {
  const m = JSON.parse(readFileSync(join(root, "eval/writing", agent, "manifest.json"), "utf8"));
  return { m, version: `${m.version}+${createHash("sha256").update(m.files["he.jsonl"].sha256 + m.files["en.jsonl"].sha256).digest("hex").slice(0, 12)}` };
}

/** The card of one writing agent, with what is wrong with it (complete, current, ≥ 150 items a language). */
export function checkWritingAgent(agent, { root = ROOT } = {}) {
  const file = join("eval/cards/writing", `${agent}.json`);
  const [r] = existsSync(join(root, file)) ? checkReports([file], { root }) : [{ file, problems: ["no card (run its eval with LUMEN_WRITE_CARDS=1)"] }];
  if (!existsSync(join(root, "eval/writing", agent, "manifest.json"))) return { ...r, problems: [...r.problems, `no eval set eval/writing/${agent}`] };
  const { m, version } = writingSetVersion(root, agent);
  const problems = [...r.problems];
  for (const lang of ["he", "en"]) {
    const f = m.files?.[`${lang}.jsonl`];
    const lines = existsSync(join(root, "eval/writing", agent, `${lang}.jsonl`)) ? readFileSync(join(root, "eval/writing", agent, `${lang}.jsonl`), "utf8").trim().split("\n").length : 0;
    if (!f || lines < 150) problems.push(`eval/writing/${agent}/${lang}.jsonl: ${lines} items (≥ 150 needed)`);
    else if (createHash("sha256").update(readFileSync(join(root, "eval/writing", agent, `${lang}.jsonl`), "utf8")).digest("hex") !== f.sha256) problems.push(`eval/writing/${agent}/${lang}.jsonl does not match its manifest`);
  }
  if (!r.problems.length) {
    const card = cardOf(JSON.parse(readFileSync(join(root, file), "utf8")));
    if (card.dataset.version !== version) problems.push(`card.dataset.version ${card.dataset.version} is stale (the set is ${version}): re-run the eval`);
  }
  return { ...r, problems };
}

/** Every writing agent with an eval set. */
export function writingAgentsWithSets(root = ROOT) {
  const dir = join(root, "eval/writing");
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
}

export function main(argv, { root = ROOT, log = console.log, err = console.error } = {}) {
  const json = argv.includes("--json");
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const agent = at("--agent");
  const suite = at("--suite");
  if (suite !== undefined && suite !== "writing") {
    err(`eval:card: unknown suite ${suite} (known: writing)`);
    return 1;
  }
  if (agent !== undefined || suite === "writing") {
    const agents = agent !== undefined ? [agent] : writingAgentsWithSets(root);
    const results = agents.map((a) => checkWritingAgent(a, { root }));
    for (const r of results) {
      if (json) log(JSON.stringify(r));
      else if (r.problems.length) err(`✗ ${r.file}\n    ${r.problems.join("\n    ")}`);
      else log(`✓ ${r.file} (${r.tag}) — card complete`);
    }
    const bad = results.filter((r) => r.problems.length).length;
    if (!json) log(`eval:card: ${results.length - bad}/${results.length} writing agents carry a complete, current card`);
    return bad || !results.length ? 1 : 0;
  }
  const skip = new Set(["--json", "--check"]);
  const results = checkReports(argv.filter((a) => !a.startsWith("--") && !skip.has(a)), { root });
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
