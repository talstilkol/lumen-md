#!/usr/bin/env node
/**
 * `node scripts/visual-stamp.mjs --write | --check` (plan 10.3; see
 * scripts/lib/visualStamp.mjs).
 *
 *   --write  after `npm run visual:approve -- visual`: records the Chromium,
 *            OS and platform that rendered visual/__baselines__/<platform>/.
 *   --check  the gate, before `npm run test:visual`: exit 1 when this
 *            platform has no baselines, no stamp, or another Chromium.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { STAMP, baselineDir, makeStamp, stampProblems } from "./lib/visualStamp.mjs";

async function chromiumVersion() {
  const { chromium } = await import("@playwright/test");
  const executablePath = process.env.VISUAL_CHROMIUM || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const v = browser.version();
  await browser.close();
  return v;
}

async function main(argv) {
  const mode = argv.includes("--write") ? "write" : argv.includes("--check") ? "check" : null;
  if (!mode) {
    console.error("usage: node scripts/visual-stamp.mjs --write | --check");
    return 1;
  }
  const here = { platform: process.platform, chromium: await chromiumVersion() };
  const dir = baselineDir(here.platform);
  const files = existsSync(dir) ? readdirSync(dir) : null;
  if (mode === "write") {
    const pngs = (files ?? []).filter((f) => f.endsWith(".png")).length;
    const stamp = makeStamp({ ...here, os: `${platform()} ${release()} ${arch()}`, where: process.env.VISUAL_WHERE, renderedAt: new Date().toISOString() }, pngs);
    writeFileSync(join(dir, STAMP), JSON.stringify(stamp, null, 2) + "\n");
    console.log(`wrote ${join(dir, STAMP)}: ${pngs} PNGs, Chromium ${here.chromium} on ${stamp.os}`);
    return 0;
  }
  const stampFile = join(dir, STAMP);
  const stamp = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, "utf8")) : null;
  const problems = stampProblems(here, files, stamp);
  if (problems.length) {
    for (const p of problems) console.error(`✗ visual baselines: ${p}`);
    return 1;
  }
  console.log(`✓ visual baselines: ${files.filter((f) => f.endsWith(".png")).length} PNGs in ${dir}/, rendered by Chromium ${here.chromium}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).then((c) => process.exit(c));
