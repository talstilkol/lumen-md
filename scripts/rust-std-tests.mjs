#!/usr/bin/env node
/**
 * Review 10, M5: the std-only Rust crates (scripts/lib/rustStd.mjs
 * STD_CRATES), each built with `rustc --edition 2021 --test` and run. A
 * crate is green when it built and ran at least one test with none failing
 * ("running 0 tests" is not green). A train:offline gate (`rust-std`).
 *
 *   node scripts/rust-std-tests.mjs [--only <id,…>] [--root <dir>]
 *
 * Exit 1 when any crate is not green, when rustc is missing, or when --only
 * names no crate.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STD_CRATES, rustCounts, rustGreen } from "./lib/rustStd.mjs";

const opt = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};

/**
 * Build and run each crate; one result per crate.
 * @param {string} root
 * @param {string[]} [only]
 * @param {typeof spawnSync} [spawn]
 */
export function runCrates(root, only = [], spawn = spawnSync) {
  const crates = STD_CRATES.filter(([id]) => !only.length || only.includes(id));
  const dir = mkdtempSync(join(tmpdir(), "rust-std-"));
  try {
    return crates.map(([id, entry]) => {
      if (!existsSync(join(root, entry))) return { id, ok: false, detail: `${entry}: no such file` };
      const bin = join(dir, id);
      const b = spawn("rustc", ["--edition", "2021", "--test", entry, "-o", bin], { cwd: root, encoding: "utf8" });
      if (b.error) return { id, ok: false, detail: `rustc did not run: ${b.error.message}` };
      if (b.status !== 0) return { id, ok: false, detail: `build failed: ${String(b.stderr).trim().split("\n").find((l) => l.startsWith("error")) ?? `exit ${b.status}`}` };
      const r = spawn(bin, [], { cwd: root, encoding: "utf8" });
      const c = rustCounts(`${r.stdout}\n${r.stderr}`);
      const ok = r.status === 0 && rustGreen(c);
      return { id, ok, detail: c ? `${c.passed}/${c.ran} passed${c.ran === 0 ? " (running 0 tests is not green)" : ""}${r.status ? `, exit ${r.status}` : ""}` : `no Rust test output, exit ${r.status}` };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const root = resolve(opt(argv, "--root") ?? process.cwd());
  const only = (opt(argv, "--only") ?? "").split(",").filter(Boolean);
  const results = runCrates(root, only);
  if (!results.length) {
    console.error(`✗ rust-std: no crate matches --only ${only.join(",")}`);
    return 1;
  }
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.id}: ${r.detail}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(`rust-std: ${results.length - bad}/${results.length} std-only crates green`);
  return bad ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
