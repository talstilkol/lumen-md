#!/usr/bin/env node
/**
 * Plan W13.W17 — the writing agents' defaults follow the numbers. After the
 * Mac measurement day writes a card per agent and model
 * (eval/cards/writing/*.json: `agent`, `card.model.{name,digest}`, a primary
 * metric), this puts each heldout or public score into
 * models/writing-defaults.json (`measured[agent][model]`) with the model's
 * pinned digest. Dev cards (sets the authors wrote) never move a default.
 *
 *   node scripts/writing-defaults-update.mjs [--cards eval/cards/writing] [--write]
 *
 * Without --write it prints what would change and exits 0.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateCard } from "./lib/evalCard.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * @param {object} table models/writing-defaults.json
 * @param {Array<{ file: string, report: any }>} reports
 * @returns {{ table: object, applied: string[], skipped: string[] }}
 */
export function applyCards(table, reports) {
  const next = JSON.parse(JSON.stringify(table));
  const applied = [];
  const skipped = [];
  for (const { file, report } of reports) {
    const card = report?.card;
    const agent = report?.agent;
    const why = !agent || !next.agents[agent] ? "not a writing agent" : validateCard(card).length ? "incomplete card" : card.tag === "dev" ? "dev card: only heldout or public results move a default" : next.agents[agent].kind !== "llm" ? "a rule agent has no model to pick" : !DIGEST.test(card.model.digest) ? "the model's digest is not a sha256" : null;
    if (why) {
      skipped.push(`${file}: ${why}`);
      continue;
    }
    const metric = card.metrics[report.primary ?? Object.keys(card.metrics)[0]];
    (next.measured[agent] ??= {})[card.model.name] = metric.value;
    next.digests[card.model.name] = card.model.digest;
    applied.push(`${agent} / ${card.model.name}: ${metric.value} (${card.tag})`);
  }
  return { table: next, applied, skipped };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const root = resolve(new URL("..", import.meta.url).pathname);
  const dir = resolve(root, args.includes("--cards") ? args[args.indexOf("--cards") + 1] : "eval/cards/writing");
  const path = join(root, "models/writing-defaults.json");
  const reports = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => ({ file: f, report: JSON.parse(readFileSync(join(dir, f), "utf8")) })) : [];
  const r = applyCards(JSON.parse(readFileSync(path, "utf8")), reports);
  for (const a of r.applied) console.log(`✓ ${a}`);
  for (const s of r.skipped) console.log(`· ${s}`);
  if (args.includes("--write") && r.applied.length) writeFileSync(path, JSON.stringify(r.table, null, 2) + "\n");
  console.log(`writing defaults: ${r.applied.length} measured result(s)${args.includes("--write") ? " written" : " (dry run; --write to apply)"}`);
}
