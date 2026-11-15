#!/usr/bin/env node
/**
 * Build the outside table for Shabbat times (plan W12.H8) on a machine with
 * network: candle lighting and havdalah for five cities through one year,
 * from Hebcal's public REST API (www.hebcal.com/hebcal, cfg=json), with the
 * same coordinates and settings as src/daily/shabbatTimes.ts (each city's
 * candle-lighting custom, havdalah at 8.5°). Only the dates and clock times
 * are kept: data, no code of theirs.
 *
 *   node scripts/zmanim/reference-shabbat-table.mjs [--year 2026] [--cities jerusalem,tel-aviv,haifa,new-york,london] [--in <dir of saved answers>] [--out <file>]
 *
 * Writes src/__tests__/fixtures/shabbat-times/<year>.json (shape in
 * reference-lib.mjs). --in reads saved answers (<city>.json) instead of fetching.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const year = Number(opt("year", 2026));
const ids = opt("cities", "jerusalem,tel-aviv,haifa,new-york,london").split(",");
const saved = opt("in", null);

// The cities as the app has them (read from the source, so the two never drift).
const src = readFileSync(join(root, "src/daily/shabbatTimes.ts"), "utf8");
const city = (id) => {
  const m = new RegExp(`\\{ id: "${id}",[^}]*lat: ([-\\d.]+), lon: ([-\\d.]+), tz: "([^"]+)", candles: (\\d+)`).exec(src);
  if (!m) throw new Error(`no city ${id} in shabbatTimes.ts`);
  return { id, lat: m[1], lon: m[2], tz: m[3], candles: Number(m[4]) };
};

const out = { version: 1, source: "Hebcal REST API (www.hebcal.com/hebcal, cfg=json, geo=pos): dates and clock times only", retrieved: new Date().toISOString().slice(0, 10), settings: { candles: {}, havdalah: "8.5°" }, rows: [] };
for (const id of ids) {
  const c = city(id);
  out.settings.candles[id] = c.candles;
  let json;
  if (saved) json = JSON.parse(readFileSync(join(saved, `${id}.json`), "utf8"));
  else {
    const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&year=${year}&month=x&c=on&geo=pos&latitude=${c.lat}&longitude=${c.lon}&tzid=${encodeURIComponent(c.tz)}&b=${c.candles}&M=on&maj=off&min=off&mod=off&nx=off&ss=off&mf=off&s=off`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    json = await res.json();
  }
  for (const it of json.items ?? []) {
    if (it.category !== "candles" && it.category !== "havdalah") continue;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(it.date);
    if (m) out.rows.push([id, m[1], it.category, m[2]]);
  }
}
const file = opt("out", null) ? resolve(opt("out")) : join(root, `src/__tests__/fixtures/shabbat-times/${year}.json`);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`wrote ${file}: ${out.rows.length} rows for ${ids.join(", ")}`);
