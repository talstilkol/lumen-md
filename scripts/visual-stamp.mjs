#!/usr/bin/env node
/**
 * Records which environment rendered the visual baselines (plan 10.3):
 * e2e-visual/baselines/ENVIRONMENT.json. Run by `npm run visual:update`
 * after the matrix is rewritten. Pixels are only comparable within one
 * environment (chromium build, OS, fonts), so the comparison job must run
 * where this says — or the baselines must be refreshed there first.
 */
import { writeFileSync } from "node:fs";
import { release, platform, arch } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "e2e-visual", "baselines", "ENVIRONMENT.json");
const executablePath = process.env.VISUAL_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const stamp = {
  renderedAt: new Date().toISOString(),
  chromium: browser.version(),
  executable: executablePath ?? "playwright's default chromium",
  os: `${platform()} ${release()} ${arch()}`,
  where: process.env.GITHUB_ACTIONS ? `GitHub Actions (${process.env.RUNNER_OS ?? "?"}, run ${process.env.GITHUB_RUN_ID ?? "?"})` : process.env.VISUAL_WHERE ?? "a local machine",
  note: "Compare in this environment; elsewhere the fonts differ and every shot fails — refresh the baselines there first.",
};
await browser.close();
writeFileSync(out, JSON.stringify(stamp, null, 2) + "\n");
console.log(`wrote ${out}: ${stamp.chromium} on ${stamp.os} (${stamp.where})`);
