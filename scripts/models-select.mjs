#!/usr/bin/env node
/**
 * Plan W11.I12 — `npm run models:select`: the default model per RAM tier
 * from measured eval cards (scripts/lib/modelSelect.mjs), written with the
 * reason and the numbers to models/default-selection.json, which the app
 * reads (src/ai/defaultSelection.ts).
 *
 *   npm run models:select                     cards under eval/cards (committed)
 *   npm run models:select -- --from eval/results   also a Mac run's reports
 *   npm run models:select -- --check          exit 1 when the committed file differs
 *
 * The previous selection is the incumbent of each tier, so a default only
 * changes when a measured candidate passes the rule against it.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CURRENT_DEFAULTS, MAX_NIKUD_DROP, MIN_ALEPH_GAIN, measurements, selectDefaults, TIERS, WEIGHTS } from "./lib/modelSelect.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = "models/default-selection.json";

const jsonFiles = (p) => (!existsSync(p) ? [] : statSync(p).isFile() ? [p] : readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsonFiles(join(p, e.name)) : e.name.endsWith(".json") ? [join(p, e.name)] : [])));

export function build({ root = ROOT, from = [] } = {}) {
  const inputs = ["eval/cards", ...from].flatMap((d) => jsonFiles(resolve(root, d))).flatMap((f) => {
    try {
      return [{ file: relative(root, f), report: JSON.parse(readFileSync(f, "utf8")) }];
    } catch {
      return [];
    }
  });
  const prev = existsSync(join(root, OUT)) ? JSON.parse(readFileSync(join(root, OUT), "utf8")) : null;
  const incumbents = Object.fromEntries(TIERS.map((t) => [t, prev?.tiers?.[t]?.model ?? CURRENT_DEFAULTS[t] ?? null]));
  const m = measurements(inputs);
  return {
    schema: 1,
    plan: "W11.I12",
    rule: `composite = ${WEIGHTS.heq} HeQ F1 + ${WEIGHTS.aleph} AlephBench macro + ${WEIGHTS.bfcl} BFCL v4 (simple+multiple)/2 + ${WEIGHTS.speed} min(tok/s/30, 1); a tier's default is replaced only by a higher composite with ≥ +${MIN_ALEPH_GAIN * 100} AlephBench macro points and ≤ ${MAX_NIKUD_DROP * 100} nikud points lost; peak RAM must fit the tier; quality from public or heldout cards only`,
    sources: m.sources,
    ignored: m.ignored,
    tiers: selectDefaults(m.byModel, { incumbents }),
  };
}

function main(argv) {
  const from = argv.flatMap((a, i) => (a === "--from" && argv[i + 1] ? [argv[i + 1]] : []));
  const want = `${JSON.stringify(build({ from }), null, 2)}\n`;
  const path = join(ROOT, OUT);
  const have = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (argv.includes("--check")) {
    if (have !== want) {
      console.error(`models:select: ${OUT} is out of date — run npm run models:select`);
      return 1;
    }
    console.log(`models:select: ${OUT} matches the cards`);
    return 0;
  }
  if (have !== want) writeFileSync(path, want);
  const sel = JSON.parse(want);
  for (const t of TIERS) console.log(`${t} GB: ${sel.tiers[t].model ?? "—"} — ${sel.tiers[t].reason}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
