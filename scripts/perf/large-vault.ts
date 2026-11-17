/**
 * W11.Q2 (research R5.5): the large-vault benchmark, on a vault made by
 * corpus-vault.mjs (W11.Q1). Seven metrics, a JSON line, and the report
 * docs/perf/large-vault.md with the machine's details:
 *
 *   1. cold open   read every note from disk, index it and answer a first query, in a fresh process
 *                  (run `sudo purge` on macOS first for a cold file cache; the report says whether it was)
 *   2. warm open   the same again in the same process (file cache warm)
 *   3. search      p50 and p95 over the vault's 50 queries (queries.json: real titles),
 *                  and how many found the note they name
 *   4. save→index  re-index one edited note until the next query finds the edit
 *   5. backlinks   p50 and p95 over the 50 query notes
 *   6. idle CPU    process CPU over an idle window after load (default 60 s), as % of one core,
 *                  and the longest event-loop stall in that window (Obsidian's 280 ms / 2 s bug class)
 *   7. peak RSS    process.resourceUsage().maxRSS
 *   8. streaming   W13.V3: a query that matches thousands of notes, streamed a page at a time
 *                  (src/storage/searchStream.ts): first page p95 and all of up to 5,000 results p95
 *
 *   npm run perf:large-vault -- --vault /tmp/vault-100k [--idle 60] [--cold-cache yes|no] [--report docs/perf/large-vault.md] [--targets]
 *
 * What it measures is lumen-md's index core (src/storage/vaultIndexCore.ts,
 * the code the vault worker runs) in Node, not the app's window. The app's
 * open-to-interactive and the Obsidian 1.15.1 numbers are taken by hand on
 * the same machine and folder: docs/perf/large-vault-obsidian.md.
 *
 * `--targets` makes the exit code non-zero when a 100k target of W11.Q2 is
 * missed (warm ≤ 2 s, cold ≤ 8 s, search p95 ≤ 200 ms, save→index ≤ 50 ms,
 * idle CPU ≤ 2 %, no stall over 50 ms when idle). The targets are fixed here;
 * a run never changes them.
 */
import { cpus, totalmem, platform, release, arch } from "node:os";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { VaultIndex } from "../../src/storage/vaultIndexCore";
import { streamSearch } from "../../src/storage/searchStream";

export const TARGETS = Object.freeze({ warmOpenMs: 2000, coldOpenMs: 8000, searchP95Ms: 200, saveToIndexMs: 50, idleCpuPct: 2, idleMaxStallMs: 50, streamFirstP95Ms: 50, streamAllP95Ms: 1000 });

export interface Query {
  q: string;
  lang: string;
  expect: string;
}

export interface Result {
  vault: string;
  notes: number;
  bytes: number;
  origin: string;
  coldCache: "yes" | "no" | "unknown";
  coldOpenMs: number;
  warmOpenMs: number;
  search: { queries: number; p50Ms: number; p95Ms: number; found: number };
  saveToIndexMs: number;
  saveFound: boolean;
  backlinks: { p50Ms: number; p95Ms: number; hits: number };
  idle: { seconds: number; cpuPct: number; maxStallMs: number };
  peakRssMB: number;
  /** W13.V3: the broad query, how many it matched (up to 5,000), first page and all, p95 over 20 runs. */
  stream?: { query: string; results: number; firstP95Ms: number; allP95Ms: number };
  machine: { platform: string; release: string; arch: string; cpu: string; cores: number; memGB: number; node: string };
  date: string;
  targets: typeof TARGETS;
  missed: string[];
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Every .md under the vault, as paths relative to it. */
export function listNotes(vault: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(relative(vault, p));
    }
  };
  walk(vault);
  return out.sort();
}

const OPEN_PROBE = "the";

/** Read and index the whole vault; returns the index, the time and the bytes read. */
export function openVault(vault: string, files = listNotes(vault)): { idx: VaultIndex; ms: number; bytes: number } {
  const t = performance.now();
  const idx = new VaultIndex();
  let bytes = 0;
  for (const path of files) {
    const content = readFileSync(join(vault, path), "utf8");
    bytes += content.length;
    idx.upsert({ path, name: path.slice(path.lastIndexOf("/") + 1), content, modified: 0 });
  }
  // The index builds its search structures lazily: the open is not over
  // until the first query can be answered, so that query is part of it.
  idx.search(OPEN_PROBE, { limit: 1 });
  return { idx, ms: performance.now() - t, bytes };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function measure(vault: string, opts: { idleSeconds?: number; coldCache?: "yes" | "no" | "unknown" } = {}): Promise<Result> {
  const idleSeconds = opts.idleSeconds ?? 60;
  const files = listNotes(vault);
  const manifestPath = join(vault, "corpus-manifest.json");
  const origin = existsSync(manifestPath) ? String(JSON.parse(readFileSync(manifestPath, "utf8")).origin ?? "unknown") : "unknown";
  const queries: Query[] = existsSync(join(vault, "queries.json")) ? JSON.parse(readFileSync(join(vault, "queries.json"), "utf8")) : [];

  const cold = openVault(vault, files);
  const warm = openVault(vault, files);
  const idx = warm.idx;
  cold.idx.clear();

  const times: number[] = [];
  let found = 0;
  for (const q of queries) {
    const t = performance.now();
    const hits = idx.search(q.q, { limit: 20 });
    times.push(performance.now() - t);
    if (hits.some((h) => h.path === q.expect)) found++;
  }

  const target = queries[0]?.expect ?? files[0];
  const before = readFileSync(join(vault, target), "utf8");
  const marker = `benchmarksavedmarker${Date.now()}`;
  const t0 = performance.now();
  idx.upsert({ path: target, name: target.slice(target.lastIndexOf("/") + 1), content: `${before}\n${marker}\n`, modified: Date.now() });
  const saveFound = idx.search(marker).some((h) => h.path === target);
  const saveToIndexMs = performance.now() - t0;
  idx.upsert({ path: target, name: target.slice(target.lastIndexOf("/") + 1), content: before, modified: Date.now() });

  const bl: number[] = [];
  let blHits = 0;
  for (const q of queries.length ? queries : files.slice(0, 50).map((f) => ({ expect: f }) as Query)) {
    const t = performance.now();
    blHits += idx.backlinks(q.expect).length;
    bl.push(performance.now() - t);
  }

  const stream = await measureStream(idx);

  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const cpu0 = process.cpuUsage();
  const w0 = performance.now();
  await new Promise((r) => setTimeout(r, idleSeconds * 1000));
  const cpu = process.cpuUsage(cpu0);
  const wall = performance.now() - w0;
  h.disable();
  const cpuPct = ((cpu.user + cpu.system) / 1000 / wall) * 100;
  const maxStallMs = Math.max(0, h.max / 1e6 - 10);

  const c = cpus();
  const res: Result = {
    vault,
    notes: files.length,
    bytes: warm.bytes,
    origin,
    coldCache: opts.coldCache ?? "unknown",
    coldOpenMs: Math.round(cold.ms),
    warmOpenMs: Math.round(warm.ms),
    search: { queries: queries.length, p50Ms: r1(percentile(times, 50)), p95Ms: r1(percentile(times, 95)), found },
    saveToIndexMs: r1(saveToIndexMs),
    saveFound,
    backlinks: { p50Ms: r1(percentile(bl, 50)), p95Ms: r1(percentile(bl, 95)), hits: blHits },
    idle: { seconds: idleSeconds, cpuPct: Math.round(cpuPct * 100) / 100, maxStallMs: r1(maxStallMs) },
    peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    stream,
    machine: { platform: platform(), release: release(), arch: arch(), cpu: c[0]?.model ?? "?", cores: c.length, memGB: Math.round(totalmem() / 2 ** 30), node: process.version },
    date: new Date().toISOString(),
    targets: TARGETS,
    missed: [],
  };
  res.missed = missedTargets(res);
  return res;
}

/** The word that matches the most notes, of a few common ones in each language. */
const BROAD = ["the", "and", "של", "את", "על", "a"];

/** W13.V3: the streamed search of a broad query, as the search dialog runs it. */
export async function measureStream(idx: VaultIndex, runs = 20): Promise<Result["stream"]> {
  let query = BROAD[0];
  let most = -1;
  for (const q of BROAD) {
    const n = idx.search(q, { limit: 5000 }).length;
    if (n > most) [query, most] = [q, n];
  }
  const page = async (q: string, o: { limit: number; offset: number }) => idx.search(q, o);
  const first: number[] = [];
  const all: number[] = [];
  let results = 0;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    let f = -1;
    results = (await streamSearch(page, query, { onPage: () => void (f < 0 && (f = performance.now() - t)) })).length;
    first.push(f < 0 ? performance.now() - t : f);
    all.push(performance.now() - t);
  }
  return { query, results, firstP95Ms: r1(percentile(first, 95)), allP95Ms: r1(percentile(all, 95)) };
}

export function missedTargets(r: Result): string[] {
  const m: string[] = [];
  if (r.warmOpenMs > TARGETS.warmOpenMs) m.push(`warm open ${r.warmOpenMs} ms > ${TARGETS.warmOpenMs}`);
  if (r.coldOpenMs > TARGETS.coldOpenMs) m.push(`cold open ${r.coldOpenMs} ms > ${TARGETS.coldOpenMs}`);
  if (r.search.p95Ms > TARGETS.searchP95Ms) m.push(`search p95 ${r.search.p95Ms} ms > ${TARGETS.searchP95Ms}`);
  if (r.saveToIndexMs > TARGETS.saveToIndexMs || !r.saveFound) m.push(`save→index ${r.saveToIndexMs} ms${r.saveFound ? "" : " (edit not found)"} > ${TARGETS.saveToIndexMs}`);
  if (r.idle.cpuPct > TARGETS.idleCpuPct) m.push(`idle CPU ${r.idle.cpuPct}% > ${TARGETS.idleCpuPct}%`);
  if (r.idle.maxStallMs > TARGETS.idleMaxStallMs) m.push(`idle stall ${r.idle.maxStallMs} ms > ${TARGETS.idleMaxStallMs}`);
  if (r.stream && r.stream.firstP95Ms > TARGETS.streamFirstP95Ms) m.push(`streamed search first page p95 ${r.stream.firstP95Ms} ms > ${TARGETS.streamFirstP95Ms}`);
  if (r.stream && r.stream.allP95Ms > TARGETS.streamAllP95Ms) m.push(`streamed search, all ${r.stream.results}, p95 ${r.stream.allP95Ms} ms > ${TARGETS.streamAllP95Ms}`);
  return m;
}

/** docs/perf/large-vault.md: the runs, newest first, each with its machine. */
export function renderReport(runs: Result[]): string {
  const rows = runs.map(
    (r) =>
      `| ${r.date.slice(0, 10)} | ${r.notes.toLocaleString("en")} | ${r.origin} | ${r.coldOpenMs} (${r.coldCache === "yes" ? "cache purged" : r.coldCache === "no" ? "cache warm" : "cache ?"}) | ${r.warmOpenMs} | ${r.search.p50Ms} / ${r.search.p95Ms} (${r.search.found}/${r.search.queries} found) | ${r.saveToIndexMs}${r.saveFound ? "" : " ✗"} | ${r.backlinks.p50Ms} / ${r.backlinks.p95Ms} | ${r.idle.cpuPct}% over ${r.idle.seconds} s, max stall ${r.idle.maxStallMs} ms | ${r.peakRssMB} | ${r.stream ? `${r.stream.firstP95Ms} / ${r.stream.allP95Ms} (“${r.stream.query}”, ${r.stream.results.toLocaleString("en")})` : "—"} | ${r.machine.cpu}, ${r.machine.cores} cores, ${r.machine.memGB} GB, ${r.machine.platform} ${r.machine.release} ${r.machine.arch}, Node ${r.machine.node} | ${r.missed.length ? r.missed.join("; ") : "—"} |`,
  );
  return [
    "# Large-vault benchmark",
    "",
    "Generated by `scripts/perf/large-vault.ts` (W11.Q2) from vaults made by `scripts/perf/corpus-vault.mjs` (W11.Q1). Do not edit by hand: rerun the harness.",
    "",
    "The **origin** column says what the vault is made of: `real` is Hebrew and English Wikipedia plus Project Ben-Yehuda; `derived-from-docs` is this repository's own documentation (the cloud run, where the dumps cannot be downloaded); only `real` rows at 10k, 50k and 100k count for W2.22 and W11.M8.",
    "",
    "It measures lumen-md's index core (`src/storage/vaultIndexCore.ts`, what the vault worker runs) in Node. The app window and Obsidian 1.15.1 are measured by hand on the same machine and folder: [large-vault-obsidian.md](./large-vault-obsidian.md).",
    "",
    `Targets at 100k (W11.Q2, fixed): warm open ≤ ${TARGETS.warmOpenMs} ms, cold ≤ ${TARGETS.coldOpenMs} ms, search p95 ≤ ${TARGETS.searchP95Ms} ms, save→index ≤ ${TARGETS.saveToIndexMs} ms, idle CPU ≤ ${TARGETS.idleCpuPct}%, no stall over ${TARGETS.idleMaxStallMs} ms when idle; streamed search (W13.V3) first page p95 ≤ ${TARGETS.streamFirstP95Ms} ms, all results p95 ≤ ${TARGETS.streamAllP95Ms} ms.`,
    "",
    "| date | notes | origin | cold open ms | warm open ms | search p50 / p95 ms | save→index ms | backlinks p50 / p95 ms | idle | peak RSS MB | streamed search first / all p95 ms | machine | missed targets |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const vault = arg("vault");
  if (!vault || !statSync(vault).isDirectory()) throw new Error("large-vault: --vault <folder made by corpus-vault.mjs>");
  const r = await measure(vault, { idleSeconds: Number(arg("idle") ?? 60), coldCache: (arg("cold-cache") as Result["coldCache"]) ?? "unknown" });
  console.log(JSON.stringify(r));
  const report = arg("report");
  if (report) {
    const runsFile = report.replace(/\.md$/, ".runs.json");
    const runs: Result[] = existsSync(runsFile) ? JSON.parse(readFileSync(runsFile, "utf8")) : [];
    runs.unshift(r);
    mkdirSync(dirname(report), { recursive: true });
    writeFileSync(runsFile, `${JSON.stringify(runs, null, 2)}\n`);
    writeFileSync(report, renderReport(runs));
  }
  if (process.argv.includes("--targets") && r.missed.length) {
    console.error(`large-vault: missed ${r.missed.join("; ")}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, "/"))) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
