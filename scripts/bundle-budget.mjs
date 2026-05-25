#!/usr/bin/env node
/**
 * Bundle-size budget enforcer.
 *
 * Runs after `npm run build` and walks `dist/assets/*.js`, comparing each
 * file (gzipped) against the per-chunk-class budgets below. Exits non-zero
 * when any budget is exceeded — so CI fails on a regression.
 *
 * The budgets reflect what Lumen ships *today* with a small headroom, so we
 * catch rgressions without rewriting the file every time we add a feature.
 * Update the table when an intentional new feature lands.
 */

import { promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";
import * as path from "node:path";

const DIST = path.join(process.cwd(), "dist", "assets");

// Each rule applies to files whose name matches `pattern`. Budget is in KB
// (gzipped). The first matching rule wins, so put narrower regexes first.
const BUDGETS = [
  // main is the eager Lumen runtime (App + side panels + i18n table).
  // Round-16 bumped from 222 → 225 because the production-build TDZ
  // fix re-chunked katex (added rehype-katex + mathml-tag-names to its
  // chunk) which freed a tiny bit of code from main; the net main
  // increase came from merging react and react-dom into a single
  // vendor-react chunk so they no longer have a circular cross-chunk
  // import. Trade-off: ~2 KB more in main vs. an app that actually
  // boots in production.
  { name: "main bundle",        pattern: /^main-/,                budgetKb: 225 },
  { name: "entry index",        pattern: /^index-/,               budgetKb: 220 },
  { name: "vendor: mermaid",    pattern: /^vendor-mermaid-/,      budgetKb: 800 },
  // shiki sits at ~263 KB gzipped today. The budget previously read
  // 1800 KB — a relic from when per-language grammars were bundled into
  // the same chunk. They've since been split into assets/shiki-langs/*
  // and are fetched on-demand via the SW cache, so the core shiki
  // wrapper is small and stable. 320 KB gives ~50 KB headroom without
  // hiding a meaningful regression.
  { name: "vendor: shiki",      pattern: /^vendor-shiki-/,        budgetKb: 320 },
  { name: "vendor: codemirror", pattern: /^vendor-codemirror-/,   budgetKb: 600 },
  { name: "vendor: echarts",    pattern: /^vendor-echarts-/,      budgetKb: 400 },
  { name: "vendor: graphviz",   pattern: /^vendor-graphviz-/,     budgetKb: 700 },
  { name: "vendor: yjs",        pattern: /^vendor-yjs-/,          budgetKb: 180 },
  { name: "vendor: milkdown",   pattern: /^vendor-milkdown-/,     budgetKb: 200 },
  // vendor-react now bundles both react and react-dom (round-16);
  // splitting them caused a circular-import init crash.
  { name: "vendor: react",      pattern: /^vendor-react-/,        budgetKb: 160 },
  { name: "vendor: katex",      pattern: /^vendor-katex-/,        budgetKb: 110 },
  { name: "vendor: leaflet",    pattern: /^vendor-leaflet-/,      budgetKb: 60 },
  { name: "vendor: git",        pattern: /^vendor-git-/,          budgetKb: 110 },
  { name: "vendor: tldraw",     pattern: /^vendor-tldraw-/,       budgetKb: 420 },
  { name: "vendor: other",      pattern: /^vendor-/,              budgetKb: 200 },
  { name: "lazy plugin chunk",  pattern: /\.js$/,                 budgetKb: 100 },
];

function format(kb) {
  return kb.toFixed(1).padStart(7) + " KB";
}

async function main() {
  let entries;
  try {
    entries = await fs.readdir(DIST);
  } catch {
    console.error(`No dist/assets directory — run \`npm run build\` first.`);
    process.exit(2);
  }
  const jsFiles = entries.filter((f) => f.endsWith(".js"));
  if (jsFiles.length === 0) {
    console.error("dist/assets has no .js files.");
    process.exit(2);
  }

  let failed = 0;
  let total = 0;
  console.log(
    "\n  Budget                  Actual          File\n" +
      "  ─────────               ─────────       ────",
  );

  for (const file of jsFiles.sort()) {
    const buf = await fs.readFile(path.join(DIST, file));
    const gzipped = gzipSync(buf).length;
    const kb = gzipped / 1024;
    total += kb;
    const rule = BUDGETS.find((r) => r.pattern.test(file));
    if (!rule) continue;
    const ok = kb <= rule.budgetKb;
    if (!ok) failed++;
    const mark = ok ? "✓" : "✗";
    console.log(
      `  ${mark} ${rule.name.padEnd(20)} ${format(kb)} / ${format(rule.budgetKb)}   ${file}`,
    );
  }

  console.log(`\n  Total gzipped: ${format(total)}`);
  if (failed > 0) {
    console.error(
      `\n✗ ${failed} chunk${failed === 1 ? "" : "s"} exceeded its budget. ` +
        `Edit scripts/bundle-budget.mjs if the increase is intentional.\n`,
    );
    process.exit(1);
  }
  console.log("\n✓ All chunks within budget.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
