#!/usr/bin/env node
/**
 * Build the outside reference for the Hebrew calendar (plan W2.10, W10.E76),
 * on a machine with network: Hebcal's public REST API, 2010–2030, Israel and
 * the diaspora, holidays + Rosh Chodesh + weekly portions. Only dates and our
 * ids are kept (scripts/calendar/reference-lib.mjs maps the titles).
 *
 *   node scripts/calendar/reference-from-hebcal.mjs [--from 2010] [--to 2030] [--in <dir of saved API answers>] [--out <file>]
 *
 * Writes src/__tests__/fixtures/hebcal-reference/2010-2030.json, and prints
 * the titles it could not map (they are left out, never guessed). --in reads
 * saved answers (<year>-<il|diaspora>.json) instead of fetching.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromHebcal } from "./reference-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const from = Number(opt("from", 2010));
const to = Number(opt("to", 2030));
const saved = opt("in", null);
const src = readFileSync(join(root, "src/daily/hebrewCalendar.ts"), "utf8");
const parashaIds = [...(/export const PARASHOT = \[([\s\S]*?)\] as const/.exec(src)?.[1] ?? "").matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);

async function year(y, israel) {
  const name = `${y}-${israel ? "il" : "diaspora"}.json`;
  if (saved) return JSON.parse(readFileSync(join(saved, name), "utf8"));
  const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&year=${y}&month=x&maj=on&min=on&mod=on&nx=on&ss=on&mf=on&s=on&i=${israel ? "on" : "off"}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const out = { source: "Hebcal REST API (www.hebcal.com/hebcal, cfg=json): dates only, mapped to Lumen's ids", retrieved: new Date().toISOString().slice(0, 10), range: [`${from}-01-01`, `${to}-12-31`] };
const unmapped = new Set();
for (const israel of [true, false]) {
  const all = { holidays: [], readings: [] };
  for (let y = from; y <= to; y++) {
    const r = fromHebcal((await year(y, israel)).items ?? [], { israel, parashaIds });
    all.holidays.push(...r.holidays);
    all.readings.push(...r.readings);
    for (const t of r.unmapped) unmapped.add(t);
  }
  out[israel ? "israel" : "diaspora"] = all;
}
const file = opt("out", null) ? resolve(opt("out")) : join(root, `src/__tests__/fixtures/hebcal-reference/${from}-${to}.json`);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`wrote ${file}: Israel ${out.israel.holidays.length} days and ${out.israel.readings.length} readings, diaspora ${out.diaspora.holidays.length} and ${out.diaspora.readings.length}`);
if (unmapped.size) console.log(`not mapped (left out): ${[...unmapped].sort().join("; ")}`);
if (!existsSync(file)) process.exit(1);
