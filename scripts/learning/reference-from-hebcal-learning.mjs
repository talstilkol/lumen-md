#!/usr/bin/env node
/**
 * Build the outside reference for the study cycles (plan W12.H4) on a
 * machine with network, OUTSIDE the app: hebcal-learning's output for every
 * day of 2020–2030, dates and names only.
 *
 * @hebcal/learning (BSD-2-Clause) depends on @hebcal/core (GPL-2.0), so
 * neither is installed in this repository. Install them in a scratch
 * directory and point this script at it:
 *
 *   mkdir /tmp/hl && cd /tmp/hl && npm init -y && npm i @hebcal/core @hebcal/learning
 *   node scripts/learning/reference-from-hebcal-learning.mjs --modules /tmp/hl/node_modules [--from 2020] [--to 2030] [--out <file>]
 *
 * Writes src/__tests__/fixtures/hebcal-learning/2020-2030.json in the shape
 * described in scripts/learning/reference-lib.mjs. Only what the API
 * documents is read: DafYomiEvent.daf (getName(), getBlatt()),
 * MishnaYomiEvent.mishnaYomi ([{k, v}]), DailyRambam1Event.reading
 * ({name, perek}), DailyRambam3Event.reading ([{name, perek}] or {name, perek}).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const modules = opt("modules", null);
if (!modules) {
  console.error("--modules <dir with @hebcal/core and @hebcal/learning> is required (they are not installed in this repository: GPL)");
  process.exit(2);
}
const from = Number(opt("from", 2020));
const to = Number(opt("to", 2030));
const load = (name) => import(pathToFileURL(join(resolve(modules), name, "dist/esm/index.js")).href).catch(() => import(pathToFileURL(join(resolve(modules), name)).href));
const core = await load("@hebcal/core");
await load("@hebcal/learning");
const { DailyLearning, HDate } = core;
const pkg = (name) => JSON.parse(readFileSync(join(resolve(modules), name, "package.json"), "utf8")).version;

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const out = {
  version: 1,
  source: "hebcal-learning output (DailyLearning.lookup), generated outside the app; dates, names and numbers only",
  tool: `@hebcal/learning ${pkg("@hebcal/learning")}, @hebcal/core ${pkg("@hebcal/core")}`,
  generated: new Date().toISOString().slice(0, 10),
  range: [`${from}-01-01`, `${to}-12-31`],
  dafYomi: [],
  mishnaYomi: [],
  rambam1: [],
  rambam3: [],
};
const pairs = (r) => (Array.isArray(r) ? r : [r]).map((x) => [x.name, Number(x.perek)]);
for (let d = new Date(from, 0, 1, 12); d.getFullYear() <= to; d.setDate(d.getDate() + 1)) {
  const hd = new HDate(d);
  const day = iso(d);
  const daf = DailyLearning.lookup("dafYomi", hd, true);
  if (daf?.daf) out.dafYomi.push([day, daf.daf.getName(), daf.daf.getBlatt()]);
  const m = DailyLearning.lookup("mishnaYomi", hd, true);
  if (m?.mishnaYomi) out.mishnaYomi.push([day, m.mishnaYomi.map((x) => [x.k, x.v])]);
  const r1 = DailyLearning.lookup("rambam1", hd, true);
  if (r1?.reading) out.rambam1.push([day, ...pairs(r1.reading)[0]]);
  const r3 = DailyLearning.lookup("rambam3", hd, true);
  if (r3?.reading) out.rambam3.push([day, pairs(r3.reading)]);
}
const file = opt("out", null) ? resolve(opt("out")) : join(root, `src/__tests__/fixtures/hebcal-learning/${from}-${to}.json`);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`wrote ${file}: daf ${out.dafYomi.length}, mishna ${out.mishnaYomi.length}, rambam1 ${out.rambam1.length}, rambam3 ${out.rambam3.length} days`);
