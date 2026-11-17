#!/usr/bin/env node
/**
 * Fuzz the app's decoders (plan W1.27).
 *
 *   node scripts/fuzz/run.mjs [--runs 1000000] [--target name,…] [--seed 1]
 *                             [--from 0] [--slow-ms 1000] [--jobs N] [--json]
 *                             [--engine builtin|fast-check] [--out fuzz-findings]
 *                             [--clock wall|cpu] [--hang-ms <slow-ms>]
 *   npm run fuzz            (1,000,000 inputs per decoder)
 *
 * Each decoder (scripts/fuzz/targets.mjs) runs in its own worker thread on
 * inputs from scripts/fuzz/generators.ts. A crash is an exception the
 * decoder does not document; a hang is one input that runs longer than
 * --slow-ms (1 s): the worker is stopped, the input saved, and the run goes
 * on from the next one. Inputs are a pure function of (seed, index), so
 *
 *   node scripts/fuzz/run.mjs --target bibtex --seed 1 --from 4242 --runs 1
 *
 * replays input 4242 alone. Failing inputs are written to --out.
 *
 * `--engine fast-check` runs the same decoders through fast-check
 * (`fc.string()` / `fc.json()` arbitraries with shrinking) when the package
 * is installed; it is not in package-lock.json yet (owner command in
 * docs/security/supply-chain).
 *
 * `--clock cpu` (W10.D21) times each input by the CPU time of its worker
 * thread (process.threadCpuUsage) instead of the wall clock. On a shared
 * machine (a load average of 20+ on 2 cores) the wall clock of a 20 ms parse
 * reads 100–500 ms, so a slow finding there says more about the neighbours
 * than about the parser; the thread's CPU time does not move with load. The
 * default stays the wall clock, so `npm run fuzz` on a quiet machine is
 * unchanged. `--hang-ms` is the watchdog's wall-clock limit for one input
 * (default: --slow-ms), so a loaded run can time by CPU at 200 ms and still
 * stop a real hang. Under `--clock cpu` a hang is also confirmed: the input
 * runs again alone in a fresh worker, and counts as a hang only if it stalls
 * again (a "stall" that finishes alone is saved and listed, never hidden).
 * Review 11, L7: a stall still fails the run, since a stall that finished
 * alone may be a hang that the re-run missed. `--allow-stalls` lets a run on
 * a loaded host pass with stalls (they are still listed and saved).
 *
 * Exit code: 0 when no decoder crashed, hung or (without --allow-stalls) stalled, 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "..", "..");
const REGISTER = pathToFileURL(join(dirname(SELF), "register.mjs")).href;

// The decoders are TypeScript: run with type transformation and the resolver
// hook. Not strip-only: the .base and .excalidraw modules use parameter
// properties, which type stripping refuses (W4.16).
if (!process.execArgv.includes("--import") || !(process.features?.typescript === "transform" || process.execArgv.includes("--experimental-transform-types"))) {
  const flags = ["--no-warnings", "--experimental-transform-types", "--import", REGISTER];
  const r = spawnSync(process.execPath, [...flags, SELF, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const runs = Number(opt("--runs", "1000000"));
const seed = Number(opt("--seed", "1"));
const from = Number(opt("--from", "0"));
const slowMs = Number(opt("--slow-ms", "1000"));
const hangMs = Number(opt("--hang-ms", String(slowMs)));
const clock = opt("--clock", "wall");
const allowStalls = args.includes("--allow-stalls");
if (!["wall", "cpu"].includes(clock) || !(slowMs > 0) || !(hangMs > 0)) {
  console.error("--clock is wall or cpu; --slow-ms and --hang-ms are positive numbers");
  process.exit(2);
}
const jobs = Math.max(1, Number(opt("--jobs", String(availableParallelism()))));
const json = args.includes("--json");
const engine = opt("--engine", "builtin");
const out = resolve(opt("--out", "fuzz-findings"));
const only = opt("--target", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const { TARGETS, present } = await import(pathToFileURL(join(ROOT, "scripts/fuzz/targets.mjs")).href);
const { generate } = await import(pathToFileURL(join(ROOT, "scripts/fuzz/generators.ts")).href);
const chosen = TARGETS.filter((t) => !only.length || only.includes(t.name));
// Known slow-input findings, each with an expiry (scripts/fuzz/known.json).
const known = JSON.parse(readFileSync(join(ROOT, "scripts/fuzz/known.json"), "utf8")).findings ?? [];
const today = new Date().toISOString().slice(0, 10);
const knownSlow = (name) => known.find((k) => k.target === name && k.kind === "slow" && k.expires >= today);
if (only.length && chosen.length !== only.length) {
  console.error(`Unknown target. Targets: ${TARGETS.map((t) => t.name).join(", ")}`);
  process.exit(2);
}

/** Run one target from `start` to `end` in a worker; resolves with what happened. */
function runSlice(t, start, end, { confirm = false } = {}) {
  return new Promise((resolveSlice) => {
    const progress = new SharedArrayBuffer(8);
    const cur = new Int32Array(progress);
    Atomics.store(cur, 0, -1);
    const w = new Worker(join(dirname(SELF), "worker.mjs"), {
      workerData: { root: ROOT, name: t.name, seed, from: start, to: end, slowMs, clock, confirm, progress },
      resourceLimits: { maxOldGenerationSizeMb: 1024 },
    });
    let last = -1;
    let since = Date.now();
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      resolveSlice(v);
    };
    const watch = setInterval(() => {
      const i = Atomics.load(cur, 0);
      if (i !== last) {
        last = i;
        since = Date.now();
        return;
      }
      // Stuck on one input for longer than the limit (plus a margin for GC).
      if (i >= 0 && !Atomics.load(cur, 1) && Date.now() - since > hangMs + 500) {
        void w.terminate();
        finish({ type: "hang", index: i });
      }
    }, 100);
    w.on("message", (m) => {
      if (m.type === "done" || m.type === "unavailable") finish(m);
    });
    w.on("error", (e) => finish({ type: "worker-error", index: Atomics.load(cur, 0), error: `${e?.name ?? "Error"}: ${String(e?.message ?? e).split("\n")[0]}` }));
    w.on("exit", () => finish({ type: "worker-error", index: Atomics.load(cur, 0), error: "the worker exited" }));
  });
}

function save(t, kind, index, error) {
  mkdirSync(out, { recursive: true });
  const base = join(out, `${t.name}-${seed}-${index}`);
  writeFileSync(`${base}.txt`, generate(t.gen, seed, index));
  writeFileSync(`${base}.json`, JSON.stringify({ target: t.name, kind, seed, index, error, replay: `node scripts/fuzz/run.mjs --target ${t.name} --seed ${seed} --from ${index} --runs 1` }, null, 2));
}

/** Run input `i` alone again: true when it hangs again (or dies), false when it finished within --hang-ms. */
async function confirmHang(t, i, r) {
  const m = await runSlice(t, i, i + 1, { confirm: true });
  if (m.type !== "done" || m.crashes.length > 0) return true;
  // It finished: still a slow input if it took --slow-ms of CPU.
  if (m.slow.length) {
    r.slow += m.slow.length;
    save(t, "slow", i, `${m.slow[0].ms} ms`);
  }
  r.maxMs = Math.max(r.maxMs, m.maxMs);
  return false;
}

async function runTarget(t) {
  const started = Date.now();
  if (!present(t, ROOT)) return { name: t.name, status: "not on this branch", lands: t.lands ?? null, about: t.about };
  const r = { name: t.name, status: "ok", about: t.about, runs: 0, crashes: 0, hangs: 0, stalls: 0, slow: 0, maxMs: 0, examples: [] };
  let start = from;
  const end = from + runs;
  while (start < end) {
    const m = await runSlice(t, start, end);
    if (m.type === "unavailable") return { name: t.name, status: "unavailable", error: m.error, about: t.about };
    if (m.type === "done") {
      r.runs += m.ran;
      r.crashes += m.crashes.length;
      r.slow += m.slow.length;
      r.maxMs = Math.max(r.maxMs, m.maxMs);
      for (const c of m.crashes) if (c.error) save(t, "crash", c.index, c.error);
      for (const s of m.slow) save(t, "slow", s.index, `${s.ms} ms`);
      r.examples.push(...m.crashes.filter((c) => c.error).slice(0, 3), ...m.slow.slice(0, 3));
      break;
    }
    // A hang or a worker that died (stack/heap exhausted): count it, save
    // the input, go on after it.
    const i = m.index >= start ? m.index : start;
    r.runs += i - start + 1;
    // --clock cpu: a hang is confirmed by running that input again, alone, in a
    // fresh worker. On a machine stalled by its neighbours the watchdog can fire
    // on a 2 ms input (W10.D21: eight such "hangs" in one minute at a load of 38,
    // each 1–12 ms of CPU replayed); a real hang hangs again, and counts.
    const stall = m.type === "hang" && clock === "cpu" && (await confirmHang(t, i, r)) === false;
    if (stall) r.stalls++;
    else if (m.type === "hang") r.hangs++;
    else r.crashes++;
    save(t, stall ? "stall" : m.type, i, m.error ?? `stuck for more than ${hangMs} ms${stall ? " under load; alone it finished in time (not a hang)" : ""}`);
    if (!stall) r.examples.push({ index: i, error: m.error ?? "hang" });
    start = i + 1;
  }
  if (r.crashes) r.status = "FAIL";
  else if (r.hangs || r.slow) r.status = knownSlow(t.name) ? "known-slow" : "FAIL";
  else if (r.stalls && !allowStalls) r.status = "FAIL";
  r.seconds = Math.round((Date.now() - started) / 100) / 10;
  r.examples = r.examples.slice(0, 5);
  return r;
}

async function runFastCheck(t) {
  let fc;
  try {
    fc = await import("fast-check");
  } catch {
    return { name: t.name, status: "unavailable", error: "fast-check is not installed (npm install --save-dev fast-check)" };
  }
  if (!present(t, ROOT)) return { name: t.name, status: "not on this branch", lands: t.lands ?? null };
  const fn = await t.load(ROOT);
  const arb = t.gen === "json" || t.gen === "manifest" ? fc.json() : fc.oneof(fc.string({ unit: "grapheme", maxLength: 2000 }), fc.string({ unit: "binary", maxLength: 2000 }));
  const res = fc.check(
    fc.property(arb, (s) => {
      try {
        fn(s);
      } catch (e) {
        if (!t.expected?.(e)) throw e;
      }
    }),
    { numRuns: runs, seed },
  );
  return { name: t.name, status: res.failed ? "FAIL" : "ok", runs: res.numRuns, crashes: res.failed ? 1 : 0, hangs: 0, slow: 0, counterexample: res.failed ? JSON.stringify(res.counterexample).slice(0, 300) : undefined };
}

const results = new Array(chosen.length);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(jobs, chosen.length) }, async () => {
    while (next < chosen.length) {
      const k = next++;
      results[k] = engine === "fast-check" ? await runFastCheck(chosen[k]) : await runTarget(chosen[k]);
      if (!json) {
        const r = results[k];
        const line = r.status === "ok" || r.status === "FAIL" || r.status === "known-slow" ? `${r.runs} inputs, ${r.crashes} crashes, ${r.hangs} hangs${r.stalls ? ` (+${r.stalls} stalls that finished alone)` : ""}, ${r.slow} slow (> ${slowMs} ms ${clock === "cpu" ? "CPU" : "wall"}), slowest ${Math.round(r.maxMs ?? 0)} ms, ${r.seconds ?? "?"} s` : r.status === "not on this branch" ? `not on this branch (lands with plan ${r.lands})` : `unavailable: ${r.error}`;
        console.log(`${r.status === "FAIL" ? "FAIL" : r.status === "ok" ? "  ok" : r.status === "known-slow" ? "KNOWN" : "  --"} ${r.name.padEnd(16)} ${line}${r.status === "known-slow" ? ` — known finding until ${knownSlow(r.name).expires} (scripts/fuzz/known.json)` : ""}`);
      }
    }
  }),
);

const failed = results.filter((r) => r.status === "FAIL");
if (json) console.log(JSON.stringify({ seed, runsPerTarget: runs, slowMs, hangMs, clock, allowStalls, engine, results }));
else {
  for (const r of failed) for (const e of r.examples ?? []) console.log(`     ${r.name} #${e.index}: ${e.error ?? `${e.ms} ms`}`);
  console.log(failed.length ? `FAIL: ${failed.map((r) => r.name).join(", ")} (inputs in ${out})` : "OK: no decoder crashed or ran longer than the limit");
}
process.exit(failed.length ? 1 : 0);
