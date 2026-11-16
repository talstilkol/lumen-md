#!/usr/bin/env node
/**
 * Mac pack L3, plan W4.20 / 11.4: how long one vault-unlock derivation at
 * the plan's target (Argon2id m = 64 MiB, t = 3, p = 1) takes on this
 * machine, for the in-house Argon2id (W1.7, src/sync/e2ee/primitives/argon2.ts)
 * and for hash-wasm (called as src/sync/e2ee/primitives/lib/argon2.ts calls
 * it) when the package is installed. Both are checked against RFC 9106 §5.3 first.
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/lib/ts-register.mjs \
 *     scripts/mac-pack/L3/argon2-bench.mjs [--runs 3] [--budget-ms 1000] [--out reports/mac-pack/L3-argon2.json]
 *
 * Writes { impls: { "in-house": { rfc9106, medianMs, runs }, "hash-wasm": … | null }, ok }.
 * ok (exit 0): hash-wasm is installed, both pass RFC 9106, and hash-wasm's
 * median is within --budget-ms (the plan's "≤ 1 s on a desktop"). The
 * Pixel 7 figure (≤ 2 s) needs the phone: the app measures it itself
 * (src/sync/e2ee/kdfCalibrate.ts) — owner/device step, not this script.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const hex = (b) => Buffer.from(b).toString("hex");
export const RFC9106 = {
  input: () => ({ password: new Uint8Array(32).fill(1), salt: new Uint8Array(16).fill(2), secret: new Uint8Array(8).fill(3), associatedData: new Uint8Array(12).fill(4), memoryKiB: 32, iterations: 3, parallelism: 4, tagLength: 32 }),
  tag: "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
};
export const TARGET = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1, tagLength: 32 };

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/** The verdict from the measured impls (pure, tested). */
export function verdict(impls, budgetMs) {
  const problems = [];
  const hw = impls["hash-wasm"];
  if (!hw) problems.push("hash-wasm is not installed (npm i --no-save hash-wasm, or the owner's lockfile change)");
  for (const [name, r] of Object.entries(impls)) if (r && !r.rfc9106) problems.push(`${name}: RFC 9106 §5.3 vector does not match`);
  if (hw && !(hw.medianMs <= budgetMs)) problems.push(`hash-wasm: median ${hw.medianMs} ms > ${budgetMs} ms`);
  return { ok: problems.length === 0, problems };
}

async function measure(fn, runs) {
  const salt = new Uint8Array(16).fill(7);
  const password = new TextEncoder().encode("correct horse battery staple");
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn({ password, salt, ...TARGET });
    times.push(Math.round(performance.now() - t0));
  }
  return times;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
  const runs = Number(opt("runs", 3));
  const budgetMs = Number(opt("budget-ms", 1000));
  const impls = {};
  const inHouse = (await import(resolve(ROOT, "src/sync/e2ee/primitives/argon2.ts"))).argon2id;
  {
    const rfc = hex(await inHouse(RFC9106.input())) === RFC9106.tag;
    const times = await measure(inHouse, runs);
    impls["in-house"] = { rfc9106: rfc, runs: times, medianMs: median(times) };
  }
  // hash-wasm called the way src/sync/e2ee/primitives/lib/argon2.ts (argon2idHere) calls it.
  let hashWasm = null;
  try {
    const { argon2id } = await import("hash-wasm");
    hashWasm = (i) => argon2id({ password: i.password, salt: i.salt, secret: i.secret, parallelism: i.parallelism, iterations: i.iterations, memorySize: i.memoryKiB, hashLength: i.tagLength, outputType: "binary" });
  } catch {
    impls["hash-wasm"] = null;
  }
  if (hashWasm) {
    // hash-wasm takes no associated data: the RFC vector minus AD is checked against the in-house result instead.
    const noAd = { ...RFC9106.input(), associatedData: undefined };
    const rfc = hex(await hashWasm(noAd)) === hex(await inHouse(noAd));
    const times = await measure(hashWasm, runs);
    impls["hash-wasm"] = { rfc9106: rfc, rfcNote: "vector without associated data, equal to the in-house result", runs: times, medianMs: median(times) };
  }
  const v = verdict(impls, budgetMs);
  const out = resolve(ROOT, opt("out", "reports/mac-pack/L3-argon2.json"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ schema: "lumen.mac-pack.argon2/1", at: new Date().toISOString(), target: TARGET, budgetMs, platform: process.platform, arch: process.arch, node: process.version, impls, ...v }, null, 2)}\n`);
  for (const [n, r] of Object.entries(impls)) console.log(`${n.padEnd(10)} ${r ? `${r.medianMs} ms median of ${r.runs.length} (RFC 9106 ${r.rfc9106 ? "✓" : "✗"})` : "not installed"}`);
  console.log(`${v.ok ? "✓" : "✗"} argon2 m=64 MiB t=3 p=1 → ${out}${v.problems.length ? `\n  ${v.problems.join("\n  ")}` : ""}`);
  process.exit(v.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
