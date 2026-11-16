#!/usr/bin/env node
/**
 * Plan W7.6 acceptance 1, live: the 10 common datasets of the recorded
 * fixture (src/__tests__/fixtures/datagov/datasets.json: 8 data.gov.il
 * titles, 2 CBS series) fetched from the real services through the app's
 * own code (sources/datagov/core.ts), saved as CSV snapshots in memory, and
 * the attribution line checked part by part, as datagovSources.test.ts does
 * on the fixture.
 *
 *   node --experimental-transform-types --no-warnings --import ./scripts/lib/ts-register.mjs \
 *     scripts/sources/datagov-live10.mjs [--out eval/results/datagov-live10.json]
 *
 * data.gov.il items are found by their title (CKAN package_search), since
 * the fixture's resource ids are placeholders; the first hit with a
 * datastore resource is imported (100 rows). CBS items use the series id.
 * It sends nothing but those titles and ids.
 *
 * Exit 0: 10/10 fetched with a complete attribution. 1: fewer. 3: no item
 * could reach the services at all (the network, not the code).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { searchDatasets } from "../../src/sources/datagov/api.ts";
import { importResource, importSeries } from "../../src/sources/datagov/core.ts";
import { attribution, CBS_TERMS } from "../../src/sources/datagov/snapshot.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const outAt = argv.indexOf("--out");
const out = resolve(root, outAt >= 0 ? argv[outAt + 1] : "eval/results/datagov-live10.json");
const FIX = JSON.parse(readFileSync(join(root, "src/__tests__/fixtures/datagov/datasets.json"), "utf8"));

const memory = () => {
  const files = new Map();
  return { files, read: async (p) => files.get(p) ?? null, write: async (p, c) => void files.set(p, c) };
};
const dmy = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d}.${m}.${y}`;
};
const retrieved = new Date().toISOString().slice(0, 10);

const rows = [];
for (const d of FIX.datasets) {
  const title = d.package_show?.result?.title ?? null;
  const row = { source: d.source, query: title ?? d.series, ok: false, network: false, attributed: false, rows: 0, title: null, error: null };
  try {
    let r;
    if (d.source === "cbs") {
      r = await importSeries(d.series, { fetch, store: memory(), retrieved });
    } else {
      const hits = await searchDatasets(title, fetch);
      const hit = hits.find((h) => h.resources.some((x) => x.datastore));
      if (!hit) throw new Error(`no hit with a datastore resource for "${title}" (${hits.length} hits)`);
      r = await importResource(hit, hit.resources.find((x) => x.datastore).id, { fetch, store: memory(), retrieved, limit: 100 });
    }
    row.network = true;
    row.rows = r.rows;
    row.title = r.block.title;
    const line = attribution(r.block);
    const parts =
      d.source === "cbs"
        ? ['הלשכה המרכזית לסטטיסטיקה (הלמ"ס)', r.block.title, `(${dmy(retrieved)})`, "ניתן לצפייה באתר:", "as is", CBS_TERMS]
        : ["data.gov.il", `"${r.block.title}"`, `נשלף ${dmy(retrieved)}`, `https://data.gov.il/dataset/${r.block.dataset}/resource/${r.block.id}`, ...(r.block.updated ? [`עודכן ${dmy(r.block.updated)}`] : [])];
    row.missing = parts.filter((p) => !line.includes(p));
    row.attributed = row.missing.length === 0 && r.markdown.includes(line);
    row.ok = r.rows > 0 && row.attributed;
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e);
    // A failure after the service answered (e.g. no datastore hit) still counts as reached.
    row.network = row.network || /no hit with a datastore/.test(row.error);
  }
  rows.push(row);
  console.error(`${row.ok ? "✓" : "✗"} ${row.source} ${row.query} — ${row.ok ? `${row.rows} rows, attributed` : (row.error ?? `missing: ${row.missing?.join(" | ")}`)}`);
}
const ok = rows.filter((r) => r.ok).length;
const reached = rows.filter((r) => r.network).length;
const report = { task: "W7.6", date: new Date().toISOString(), total: rows.length, ok, reached, pass: rows.length === 10 && ok === 10, env: reached === 0, rows };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ task: report.task, total: report.total, ok, reached, pass: report.pass, env: report.env, out }));
process.exit(report.pass ? 0 : reached === 0 ? 3 : 1);
