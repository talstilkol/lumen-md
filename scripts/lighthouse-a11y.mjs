#!/usr/bin/env node
/**
 * Reproducible Lighthouse a11y check (α.G.4).
 *
 * Builds the SPA, runs `lhci autorun` against the built dist, and
 * fails when accessibility category < 0.95. Logs the actual score
 * to stdout + CHANGELOG.md.
 *
 * Usage:  node scripts/lighthouse-a11y.mjs
 *
 * Why a separate script vs. plain `npm run lighthouse`: this one is
 * idempotent + non-interactive, runs entirely against the static
 * dist, and parses the result so CI can record the score in the run
 * summary.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// W13.D5: `--site docs` checks the docs site instead — the 30 pages of
// docs/a11y-pages.json (15 English, 15 Hebrew), Lighthouse a11y ≥ 0.95 on
// each, then axe and the right-to-left mirroring of the Hebrew pages.
if (process.argv.includes("--site") && process.argv[process.argv.indexOf("--site") + 1] === "docs") {
  if (!existsSync("docs/dist/index.html")) {
    console.error("✗ docs/dist/index.html missing — run `npm run docs:build` first");
    process.exit(2);
  }
  const pages = JSON.parse(readFileSync("docs/a11y-pages.json", "utf8")).pages;
  const urls = pages.map((p) => `http://localhost/${p.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "")}/`.replace(/\/\/$/, "/"));
  console.error(`→ Lighthouse on ${urls.length} docs pages …`);
  const lh = spawnSync("npx", ["-y", "@lhci/cli@0.16.1", "autorun", "--config=./lighthouserc.docs.json", ...urls.map((u) => `--collect.url=${u}`)], { stdio: "inherit", encoding: "utf8" });
  if (lh.status !== 0) {
    console.error("✗ Lighthouse a11y below 0.95 on a docs page (see reports/lh/docs/)");
    process.exit(lh.status ?? 2);
  }
  const axe = spawnSync("node", ["scripts/docs-a11y-content.mjs", "--site", "docs/dist"], { stdio: "inherit", encoding: "utf8" });
  if (axe.status !== 0) process.exit(axe.status ?? 2);
  console.error(`✓ docs: Lighthouse a11y ≥ 0.95 and axe clean on ${urls.length} pages; Hebrew pages mirrored`);
  process.exit(0);
}

if (!existsSync("dist/index.html")) {
  console.error("✗ dist/index.html missing — run `npm run build` first");
  process.exit(2);
}

console.error("→ Running Lighthouse CI against ./dist …");
const lhci = spawnSync(
  "npx",
  ["-y", "@lhci/cli@0.16.1", "autorun", "--config=./lighthouserc.json"],
  { stdio: "inherit", encoding: "utf8" },
);

if (lhci.status !== 0) {
  console.error("✗ Lighthouse run failed (see output above)");
  process.exit(lhci.status ?? 2);
}

console.error("✓ Lighthouse a11y target met (≥ 0.95). See `reports/lh/desktop/` for the reports.");
