#!/usr/bin/env node
/**
 * Plan W13.A5 — the data behind each agent's model card in the app, taken
 * only from committed eval reports (eval/results/**, eval/cards/**) whose
 * card is complete (`npm run eval:card`'s rules, scripts/lib/evalCard.mjs).
 *
 *   node scripts/model-cards.mjs           write src/agents/modelCards.generated.json
 *   node scripts/model-cards.mjs --check   exit 1 when that file is out of date
 *
 * Per agent (a report's `agent`, its card's `agent`, or the file name under
 * eval/cards/writing/): the model the eval ran, the dataset with its
 * licence and tag (dev / heldout / public), n, every metric with its 95%
 * interval, and the date the report was committed (git), never a date
 * written by hand. A report without a complete card adds nothing, so the app
 * shows "not measured" rather than a number without its card.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cardOf, validateCard } from "./lib/evalCard.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = "src/agents/modelCards.generated.json";
const DIRS = ["eval/cards", "eval/results"];

const files = (d) => (!existsSync(d) ? [] : readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith(".json") ? [join(d, e.name)] : [])));

function committedOn(file, root) {
  try {
    return execFileSync("git", ["log", "-1", "--format=%cs", "--", relative(root, file)], { cwd: root, encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** The agent a report is about, or null (a suite-wide report). */
export function agentOf(report, file) {
  const card = cardOf(report);
  const id = typeof report?.agent === "string" ? report.agent : typeof card?.agent === "string" ? card.agent : /[/\\]cards[/\\]writing[/\\]/.test(file) ? basename(file, ".json") : null;
  return id && /^[a-z][\w-]{0,63}$/i.test(id) ? id : null;
}

export function buildCards({ root = ROOT, dirs = DIRS, dateOf = (f) => committedOn(f, root) } = {}) {
  const agents = {};
  for (const f of dirs.flatMap((d) => files(resolve(root, d))).sort()) {
    let report;
    try {
      report = JSON.parse(readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    const agent = agentOf(report, f);
    const card = cardOf(report);
    if (!agent || !card || validateCard(card).length) continue;
    const metrics = Object.entries(card.metrics).map(([name, m]) => ({ name, value: m.value, ci95: m.ci95, ...(m.judge ? { judge: m.judge } : {}) }));
    (agents[agent] ??= []).push({
      source: relative(root, f).split("\\").join("/"),
      measuredOn: dateOf(f),
      tag: card.tag,
      model: card.model.name,
      dataset: { name: card.dataset.name, version: card.dataset.version, license: card.dataset.license, ...(card.dataset.origin ? { origin: card.dataset.origin } : {}) },
      n: card.n,
      metrics,
    });
  }
  return { format: "lumen-model-cards/1", generatedFrom: DIRS, agents };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = JSON.stringify(buildCards(), null, 2) + "\n";
  const out = join(ROOT, OUT);
  if (process.argv.includes("--check")) {
    const cur = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (cur !== text) {
      console.error(`${OUT} is out of date: run node scripts/model-cards.mjs`);
      process.exit(1);
    }
    console.log(`${OUT} is current`);
  } else {
    writeFileSync(out, text);
    console.log(`wrote ${OUT}`);
  }
  void statSync;
}
