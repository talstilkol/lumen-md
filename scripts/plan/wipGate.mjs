#!/usr/bin/env node
/**
 * Plan W6.39 — the work-in-progress rule blocks, not only warns.
 *
 * `wipWarnings` (build.mjs) lists every wave that is over its limit while the
 * next wave has started. Until now that was a warning: a new task of the next
 * wave could start and nothing stopped it. This module turns it into a gate
 * with a ratchet, the same shape as the max-lines baseline (W6.25):
 *
 *   - plan/wip-frozen.json lists the tasks that had already started in such a
 *     wave on the day the rule began to block (the debt it inherited);
 *   - `npm run plan:check` fails, with no flag, when any other task of a wave
 *     whose previous wave is over the limit has a status — a task starts, or a
 *     new task is inserted already started (a placeholder "⏳ גל N — לא התחיל"
 *     is not started, so planning ahead stays allowed);
 *   - the list only shrinks: an entry that no longer needs the exemption (its
 *     previous wave got verified, or the task left the plan) fails the check
 *     until it is removed (`node scripts/plan/wipGate.mjs --prune`). Nothing
 *     here ever adds an id; `--prune` only deletes.
 *
 * Review 12, M2: work that was merged into the train while its wave was
 * frozen is recorded in plan/merged-while-frozen.json (append-only,
 * scripts/plan/mergedWhileFrozen.mjs). The gate accepts exactly those ids
 * too; they are never "stale" here, since that list only grows.
 *
 * The gate always uses the plan's own limit (plan.schedule.wipLimit, else
 * WIP_LIMIT): `--wip-limit` changes the warnings, never what is blocked.
 * `--wip-strict` still fails on any warning at all (the end state the DoD asks for).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WIP_FROZEN_FILE = "plan/wip-frozen.json";

/** The exempt ids of a frozen file (or none: a missing or malformed file exempts nothing). */
export function frozenIds(frozen) {
  const ids = frozen && Array.isArray(frozen.started) ? frozen.started : [];
  return new Set(ids.filter((id) => typeof id === "string"));
}

/**
 * @param {Array<{ wave: number, next: number, started: string[] }>} warnings wipWarnings(plan) at the plan's own limit
 * @param {any} frozen the parsed plan/wip-frozen.json, or null
 * @param {Set<string>} [merged] the ids in plan/merged-while-frozen.json
 * @returns {{ blocked: Array<{ id: string, wave: number, next: number }>, stale: string[] }}
 */
export function wipGate(warnings, frozen, merged = new Set()) {
  const allowed = frozenIds(frozen);
  const blocked = [];
  const live = new Set();
  for (const w of warnings) {
    for (const id of w.started) {
      live.add(id);
      if (!allowed.has(id) && !merged.has(id)) blocked.push({ id, wave: w.wave, next: w.next });
    }
  }
  const stale = [...allowed].filter((id) => !live.has(id)).sort();
  return { blocked, stale };
}

/** The terminal lines for a gate result (empty when it passes). */
export function formatGate({ blocked, stale }) {
  const lines = [];
  for (const b of blocked) lines.push(`plan: WIP gate (W6.39) — ${b.id} of wave ${b.next} started while wave ${b.wave} is over its work-in-progress limit. Verify wave ${b.wave} first, or set ${b.id} back to "⏳ גל ${b.next} — לא התחיל".`);
  if (stale.length) lines.push(`plan: WIP gate (W6.39) — ${stale.length} id(s) in ${WIP_FROZEN_FILE} no longer need the exemption (the list only shrinks): ${stale.slice(0, 12).join(", ")}${stale.length > 12 ? " …" : ""}. Run \`node scripts/plan/wipGate.mjs --prune\` and commit it.`);
  return lines;
}

export function readFrozen(root) {
  const p = join(root, WIP_FROZEN_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** The frozen file without its stale ids. Never adds one. */
export function pruned(frozen, stale) {
  const drop = new Set(stale);
  return { ...frozen, started: (frozen?.started ?? []).filter((id) => !drop.has(id)) };
}

async function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const { wipWarnings } = await import("./build.mjs");
  const { mergedIds, readMerged } = await import("./mergedWhileFrozen.mjs");
  const plan = JSON.parse(readFileSync(join(root, "plan/plan.json"), "utf8"));
  const frozen = readFrozen(root);
  const merged = mergedIds(readMerged(root));
  const res = wipGate(wipWarnings(plan, { merged }), frozen, merged);
  if (argv.includes("--prune")) {
    if (!frozen) throw new Error(`${WIP_FROZEN_FILE} is missing or not JSON; --prune only removes ids`);
    writeFileSync(join(root, WIP_FROZEN_FILE), JSON.stringify(pruned(frozen, res.stale), null, 2) + "\n");
    console.log(`wipGate: removed ${res.stale.length} id(s) from ${WIP_FROZEN_FILE}`);
    res.stale = [];
  }
  for (const l of formatGate(res)) console.error(l);
  return res.blocked.length || res.stale.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(String(e.message ?? e));
      process.exit(1);
    },
  );
}
