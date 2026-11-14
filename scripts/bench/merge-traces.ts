/**
 * Measure the merge engine (W1.9) on public editing traces (plan W11.S7).
 * See scripts/bench/merge-traces-lib.ts for how pairs are made and counted.
 *
 * Two measurements, both reported, neither hidden:
 *   real     concurrent_traces: every point where two people's concurrent
 *            edits met (base = their common history, expected = what they
 *            really ended up with)
 *   split    sequential traces and crdt-benchmarks B4: one author's history
 *            cut into two consecutive windows of W transactions, as if typed
 *            on two devices (a hard case: both windows usually touch the
 *            same paragraph)
 *
 *   npm run bench:merge-traces                       download each manifest file at its
 *                                                    pinned commit (cached), check its sha256, run
 *   npm run bench:merge-traces -- --from <dir>       read <dir>/<set id>/<path> instead (an
 *                                                    existing checkout); sha256 still checked
 *   … --out bench/merge-traces/results.json          write the numbers there
 *   … --pairs 100 --window 200                       override the split's defaults
 *
 * Exit 2 when a file is missing, its sha256 differs or a replay does not
 * reach the trace's endContent; otherwise 0 (the acceptance verdict of each
 * measurement is printed and written, not turned into an exit code).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeText } from "../../src/sync/merge/textMerge";
import {
  ACCEPT,
  ConcurrentReplay,
  PAIRS_PER_TRACE,
  PRIMARY_WINDOW,
  SENSITIVITY_WINDOWS,
  accepted,
  classify,
  classifyConcurrent,
  concurrentPairs,
  makePairs,
  parseB4,
  parseConcurrentTrace,
  parseEditingTrace,
  replay,
  sha256,
  tally,
  type Outcome,
  type Pair,
  type Tally,
} from "./merge-traces-lib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(root, "bench/merge-traces/manifest.json");

interface FileEntry { path: string; bytes: number; sha256: string }
interface SetEntry { id: string; repo: string; commit: string; format: "editing-traces" | "concurrent" | "b4"; files: FileEntry[] }

async function bytesFor(set: SetEntry, f: FileEntry, from: string | null): Promise<Buffer> {
  if (from) return readFileSync(join(from, set.id, f.path));
  const cache = join(process.env.LUMEN_TRACE_CACHE || join(homedir(), ".cache", "lumen-md", "merge-traces"), set.id, set.commit, f.path);
  if (existsSync(cache)) return readFileSync(cache);
  const url = `https://raw.githubusercontent.com/${set.repo}/${set.commit}/${f.path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, buf);
  return buf;
}

const pct = (t: Tally) =>
  `${t.merged}/${t.pairs} merged (${(100 * t.mergedRate).toFixed(1)} %), ${t.lostChars} chars lost in ${t.pairsWithLoss} pairs, ${t.exact} exact${t.dependentPairs ? `; ${t.dependentPairs} dependent pairs (${t.dependentLostChars} chars off in ${t.dependentPairsWithLoss}, not counted)` : ""}`;

async function main(argv: string[]) {
  const opt = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const from = opt("from") ?? null;
  const pairsPer = Number(opt("pairs") ?? PAIRS_PER_TRACE);
  const windows = opt("window") ? [Number(opt("window"))] : [PRIMARY_WINDOW, ...SENSITIVITY_WINDOWS];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { sets: SetEntry[] };
  const files: Array<{ set: SetEntry; name: string; buf: Buffer }> = [];
  for (const set of manifest.sets)
    for (const f of set.files) {
      const buf = await bytesFor(set, f, from);
      const got = sha256(buf);
      if (got !== f.sha256) throw new Error(`${set.id}/${f.path}: sha256 ${got} is not the manifest's ${f.sha256}`);
      files.push({ set, name: f.path.split("/").pop()!.replace(/\.json\.gz$|\.js$/, ""), buf });
    }

  // Real concurrent pairs.
  const real: Record<string, Tally> = {};
  const realAll: { pairs: Pair[]; outs: Outcome[] } = { pairs: [], outs: [] };
  for (const { set, name, buf } of files.filter((f) => f.set.format === "concurrent")) {
    const t0 = Date.now();
    const trace = parseConcurrentTrace(buf, name);
    const r = new ConcurrentReplay(trace);
    if (r.finalText() !== trace.endContent) throw new Error(`${set.id}/${name}: replay does not reach endContent`);
    const ps = concurrentPairs(r);
    const outs = ps.map((p) => classifyConcurrent(p, mergeText));
    const asPairs = ps.map((p) => ({ ...p, window: 0, reanchored: 0, droppedDeletes: 0 }));
    real[`${set.id}/${name}`] = tally(asPairs, outs);
    realAll.pairs.push(...asPairs);
    realAll.outs.push(...outs);
    console.log(`✓ ${set.id}/${name}: sha256 ok, replay = endContent; real pairs ${pct(real[`${set.id}/${name}`])} (${Date.now() - t0} ms)`);
  }
  const realTotal = tally(realAll.pairs, realAll.outs);

  // One author's history split into two windows.
  const seq = files
    .filter((f) => f.set.format !== "concurrent")
    .map(({ set, name, buf }) => {
      const trace = set.format === "b4" ? parseB4(buf.toString("utf8"), `b4:${name}`) : parseEditingTrace(buf, name);
      replay(trace); // throws unless the replay ends at endContent
      console.log(`✓ ${set.id}/${name}: sha256 ok, ${trace.txns.length} txns, replay = endContent (${trace.endContent.length} chars)`);
      return { set: set.id, trace };
    });
  const split: Record<string, { perTrace: Record<string, Tally>; bySet: Record<string, Tally> }> = {};
  for (const w of windows) {
    const perTrace: Record<string, Tally> = {};
    const acc: Record<string, { pairs: Pair[]; outs: Outcome[] }> = {};
    for (const { set, trace } of seq) {
      const t0 = Date.now();
      const pairs = makePairs(trace, w, pairsPer);
      const outs = pairs.map((p) => classify(p, mergeText));
      const t = (perTrace[`${set}/${trace.name}`] = tally(pairs, outs));
      (acc[set] ??= { pairs: [], outs: [] }).pairs.push(...pairs);
      acc[set].outs.push(...outs);
      console.log(`  split W=${w} ${set}/${trace.name}: ${pct(t)}, re-anchored ${t.reanchored}, dropped deletes ${t.droppedDeletes} (${Date.now() - t0} ms)`);
    }
    split[`W${w}`] = { perTrace, bySet: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, tally(v.pairs, v.outs)])) };
  }

  const splitPrimary = split[`W${PRIMARY_WINDOW}`]?.bySet["editing-traces"] ?? null;
  const out = {
    measured: new Date().toISOString().slice(0, 10),
    engine: "src/sync/merge/textMerge.ts mergeText",
    acceptance: ACCEPT,
    real: { method: "concurrent_traces: each transaction with two parents; base = meet of the parents' versions, expected = their join", total: realTotal, accepted: accepted(realTotal), perTrace: real },
    split: { method: `sequential traces: ${pairsPer} checkpoints per trace, evenly spaced; two consecutive windows of W transactions`, primaryWindow: PRIMARY_WINDOW, primary: splitPrimary, accepted: splitPrimary ? accepted(splitPrimary) : false, byWindow: split },
    traces: manifestPath.replace(`${root}/`, ""),
  };
  const outFile = opt("out");
  if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nreal concurrent pairs: ${pct(realTotal)} → ${out.real.accepted ? "meets" : "does NOT meet"} ≥ ${100 * ACCEPT.mergedRate} % and ${ACCEPT.lost} lost`);
  if (splitPrimary) console.log(`split, editing-traces, W=${PRIMARY_WINDOW}: ${pct(splitPrimary)} → ${out.split.accepted ? "meets" : "does NOT meet"} ≥ ${100 * ACCEPT.mergedRate} % and ${ACCEPT.lost} lost`);
  return 0;
}

main(process.argv.slice(2)).then(
  (c) => process.exit(c),
  (e) => {
    console.error(`✗ ${e.message}`);
    process.exit(2);
  },
);
