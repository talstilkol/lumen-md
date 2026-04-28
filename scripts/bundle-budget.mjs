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
  { name: "main bundle",        pattern: /^main-/,                budgetKb: 220 },
  { name: "entry index",        pattern: /^index-/,               budgetKb: 220 },
  { name: "vendor: mermaid",    pattern: /^vendor-mermaid-/,      budgetKb: 800 },
  { name: "vendor: shiki",      pattern: /^vendor-shiki-/,        budgetKb: 1800 },
  { name: "vendor: codemirror", pattern: /^vendor-codemirror-/,   budgetKb: 600 },
  { name: "vendor: echarts",    pattern: /^vendor-echarts-/,      budgetKb: 400 },
  { name: "vendor: graphviz",   pattern: /^vendor-graphviz-/,     budgetKb: 700 },
  { name: "vendor: yjs",        pattern: /^vendor-yjs-/,          budgetKb: 180 },
  { name: "vendor: milkdown",   pattern: /^vendor-milkdown-/,     budgetKb: 200 },
  { name: "vendor: react-dom",  pattern: /^vendor-react-dom-/,    budgetKb: 80 },
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
