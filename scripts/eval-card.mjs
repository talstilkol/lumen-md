#!/usr/bin/env node
/**
 * Plan W11.I18 — `npm run eval:card`: every eval report has a complete card.
 *
 *   npm run eval:card                       every *.json under eval/results and eval/cards
 *   npm run eval:card -- <file|dir> …       these reports
 *   npm run eval:card -- --json             one line of JSON per report
 *   npm run eval:card -- --agent <id>       the writing agent's card (eval/cards/writing/<id>.json), W13.W2
 *   npm run eval:card -- --suite writing    list every writing eval set (each folder of eval/writing) and
 *                                           what is wrong with its card; exit 0 (a report, not a gate)
 *   npm run eval:card -- --suite writing --check
 *                                           the gate: every folder of eval/writing is an eval set (a
 *                                           manifest; plain fixtures live in eval/fixtures/writing) with a
 *                                           complete, current card: its dataset version is the set's
 *                                           manifest, and the set has ≥ 150 items in Hebrew and in English
 *                                           an agent without an eval set (eval/writing/<id>): its card in
 *                                           eval/cards/writing/<id>.json, or any report whose card.agent or
 *                                           top-level agent is <id> (W13.W6–W12); exit 2 without an id
 *
 *   npm run eval:card -- --suite writing --check --measured
 *                                           W13.W17 (the Mac measurement day): also every agent of the
 *                                           suite has at least one heldout or public report on a real,
 *                                           digest-pinned model; none at all fails ("0 reports" is red)
 *
 * Exit 1 when any report has no card or its card is missing a field
 * (scripts/lib/evalCard.mjs lists them), or when a writing card's
 * dataset.name is not a path in the repository (a trailing "(…)" note
 * aside). Exit 0 with nothing to check. `--check` goes with `--suite`.
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
    const problems = validateCard(card);
    if (file.startsWith("eval/cards/writing/") && typeof card?.dataset?.name === "string" && !datasetOnDisk(root, card.dataset.name)) problems.push(`card.dataset.name ${card.dataset.name}: no such file or folder in the repository`);
    return { file, tag: card?.tag, problems };
  });
}

/** Review 13 M3: a writing card's dataset is a path in the repository ("path (a note)" allowed). */
export function datasetOnDisk(root, name) {
  const path = name.replace(/\s+\([^)]*\)\s*$/, "").trim();
  return path !== "" && !path.startsWith("/") && !path.split("/").includes("..") && existsSync(join(root, path));
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
  if (!existsSync(join(root, "eval/writing", agent, "manifest.json"))) return { ...r, problems: [...r.problems, existsSync(join(root, "eval/writing", agent)) ? `eval/writing/${agent} has no manifest.json (an eval set needs one; plain fixtures go in eval/fixtures/writing)` : `no eval set eval/writing/${agent}`] };
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

/** Every folder of eval/writing: each is an eval set and must carry a manifest (review 13 M3; plain fixtures live in eval/fixtures/writing). */
export function writingAgentsWithSets(root = ROOT) {
  const dir = join(root, "eval/writing");
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
}

/** W13.W17: the agent's measured reports — a complete heldout or public card on a model pinned by sha256 digest. */
export function measuredReports(agent, { root = ROOT } = {}) {
  return agentReports(agent, { root }).filter((f) => {
    try {
      const card = cardOf(JSON.parse(readFileSync(join(root, f), "utf8")));
      return !validateCard(card).length && (card.tag === "heldout" || card.tag === "public") && /^sha256:[0-9a-f]{64}$/.test(card.model?.digest ?? "");
    } catch {
      return false;
    }
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
      const j = JSON.parse(readFileSync(f, "utf8"));
      return j?.card?.agent === agent || j?.agent === agent;
    } catch {
      return false;
    }
  });
  return [...new Set([...(existsSync(own) ? [own] : []), ...named])].map((f) => relative(root, f));
}

export function main(argv, { root = ROOT, log = console.log, err = console.error } = {}) {
  const json = argv.includes("--json");
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const ai = argv.indexOf("--agent");
  const agent = at("--agent");
  const suite = at("--suite");
  if (ai >= 0 && (!agent || agent.startsWith("--"))) {
    err("eval:card: --agent needs an agent id");
    return 2;
  }
  if (suite !== undefined && suite !== "writing") {
    err(`eval:card: unknown suite ${suite} (known: writing)`);
    return 1;
  }
  const check = argv.includes("--check");
  if (check && suite === undefined) {
    err("eval:card: --check gates a suite: use --suite writing --check");
    return 2;
  }
  // An agent with an eval set (W13.W2) is held to its set; one without (W13.W6–W10) to its card alone.
  if (suite === "writing" || (agent !== undefined && existsSync(join(root, "eval/writing", agent, "manifest.json")))) {
    const agents = agent !== undefined ? [agent] : writingAgentsWithSets(root);
    const measured = argv.includes("--measured");
    const results = agents.map((a) => {
      const r = checkWritingAgent(a, { root });
      // Audit r4 A2.12: W13.W17's gate is red until the Mac's real-model reports exist — never vacuously green.
      if (measured && !measuredReports(a, { root }).length) return { ...r, problems: [...r.problems, `no measured report: a heldout or public card on a digest-pinned model (W13.W17, the Mac measurement day)`] };
      return r;
    });
    for (const r of results) {
      if (json) log(JSON.stringify(r));
      else if (r.problems.length) err(`✗ ${r.file}\n    ${r.problems.join("\n    ")}`);
      else log(`✓ ${r.file} (${r.tag}) — card complete`);
    }
    const bad = results.filter((r) => r.problems.length).length;
    if (!json) log(`eval:card: ${results.length - bad}/${results.length} writing agents carry a complete, current card${suite === "writing" && !check ? " (report only: add --check to gate)" : ""}`);
    if (suite === "writing" && !check) return 0;
    if (measured && !results.length) err("eval:card: --measured with no writing agents to measure: 0 reports is not a pass");
    return bad || !results.length ? 1 : 0;
  }
  if (agent !== undefined) {
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
