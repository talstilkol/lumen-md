#!/usr/bin/env node
/**
 * Google Play's 16 KB page-size check (plan W11.P11), for every native
 * library in a build:
 *
 *   node scripts/check-16kb.mjs android/app/build/outputs/apk/release/app-release.apk
 *   node scripts/check-16kb.mjs android/app/build/outputs/bundle/release/app-release.aab
 *   node scripts/check-16kb.mjs path/to/libs/            (every .so under it)
 *
 * It checks each .so's ELF LOAD alignment and, in an .apk, the zip offset of
 * an uncompressed .so (scripts/lib/align16k.mjs). When the Android SDK's
 * `zipalign` is on PATH it also runs `zipalign -c -P 16 -v 4` on an .apk,
 * the official check. Exit 1 on any problem, and when there is no .so at all
 * unless --allow-none (a WebView app may ship none).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { check16k } from "./lib/align16k.mjs";

const args = process.argv.slice(2);
const allowNone = args.includes("--allow-none");
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("usage: node scripts/check-16kb.mjs <app.apk | app.aab | folder> [--allow-none]");
  process.exit(2);
}

function soFiles(root, dir = root, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) soFiles(root, p, out);
    else if (e.endsWith(".so")) out.push({ name: relative(root, p), data: readFileSync(p) });
  }
  return out;
}

const isDir = statSync(target).isDirectory();
const kind = isDir ? "files" : target.endsWith(".aab") ? "aab" : "apk";
const { rows, problems } = check16k(isDir ? { kind, files: soFiles(target) } : { kind, data: readFileSync(target) });

for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}  LOAD×${r.loadSegments} min align ${r.minAlign}${r.zipOffset === null ? "" : r.stored ? `  stored @${r.zipOffset}` : "  compressed"}`);
let failed = problems.length > 0;
for (const p of problems) console.log(`  ✗ ${p}`);

if (kind === "apk") {
  const z = spawnSync("zipalign", ["-c", "-P", "16", "-v", "4", target], { encoding: "utf8" });
  if (z.error) console.log("  (zipalign is not on PATH: the SDK's own check was not run)");
  else {
    const ok = z.status === 0;
    console.log(`${ok ? "ok  " : "FAIL"} zipalign -c -P 16 -v 4: ${ok ? "verification successful" : "verification FAILED"}`);
    if (!ok) failed = true;
  }
}

if (!rows.length) {
  console.log(allowNone ? "no native libraries (allowed)" : "✗ no native libraries found (pass --allow-none if the app ships none)");
  if (!allowNone) failed = true;
}
console.log(failed ? "16 KB check: FAILED" : `16 KB check: ok (${rows.length} libraries)`);
process.exit(failed ? 1 : 0);
