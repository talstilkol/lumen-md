#!/usr/bin/env node
/**
 * Reproducible build check (plan W1.27): build the same commit twice from
 * clean and compare the SHA-256 of every file in dist/.
 *
 *   node scripts/supply-chain/repro-check.mjs [--build "npm run build"] [--keep]
 *
 * SOURCE_DATE_EPOCH is set to the commit time for both builds. Prints each
 * file that differs (and files only one build has); exit code 1 if any.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { filesUnder, opts, sha256File } from "./lib.mjs";
import { sourceDate } from "./sbom.mjs";

const o = opts(process.argv);
const root = resolve(o.get("--root", "."));
const build = o.get("--build", "npm run build");
const env = { ...process.env, SOURCE_DATE_EPOCH: String(Math.floor(sourceDate(root).getTime() / 1000)), TZ: "UTC", LC_ALL: "C" };
const work = mkdtempSync(join(tmpdir(), "lumen-repro-"));
const snapshots = [];
for (const n of [1, 2]) {
  rmSync(join(root, "dist"), { recursive: true, force: true });
  console.log(`build ${n}: ${build}`);
  execSync(build, { cwd: root, env, stdio: "inherit" });
  const copy = join(work, `dist-${n}`);
  cpSync(join(root, "dist"), copy, { recursive: true });
  snapshots.push(new Map(filesUnder(copy).map((p) => [p, sha256File(join(copy, p))])));
}
const [a, b] = snapshots;
const diff = [];
for (const p of new Set([...a.keys(), ...b.keys()])) {
  if (a.get(p) !== b.get(p)) diff.push(!a.has(p) ? `only in build 2: ${p}` : !b.has(p) ? `only in build 1: ${p}` : `differs: ${p}`);
}
if (!o.has("--keep")) rmSync(work, { recursive: true, force: true });
console.log(diff.length ? `NOT REPRODUCIBLE: ${diff.length} of ${a.size} files\n  ${diff.sort().join("\n  ")}` : `REPRODUCIBLE: ${a.size} files, same SHA-256 in both builds`);
process.exit(diff.length ? 1 : 0);
