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
 *
 * `--json <file>` also writes the gzipped size per budget class (summed
 * over its files) and in total, for scripts/bundle-diff.mjs.
 */

import { promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";
import * as path from "node:path";

const DIST = path.join(process.cwd(), "dist", "assets");

// Each rule applies to files whose name matches `pattern`. Budget is in KB
// (gzipped). The first matching rule wins, so put narrower regexes first.
const BUDGETS = [
  // main is the eager Lumen runtime (App + side panels + i18n table).
  // History:
  //   Round-16: 222 → 225 (TDZ fix re-chunked katex; react+react-dom merged)
  //   Round-25: 225 → 230 (y-websocket externalize; macOS↔Linux gzip variance)
  //   Audit M12-followup-2: 230 → 195 (rehype-raw lazy-loaded; parse5 +
  //       entities + hast-util-raw moved into a dynamic chunk that only
  //       fires when a doc contains inline HTML). Measured: 177.9 KB
  //       gzipped on macOS post-fix. Budget gives ~17 KB headroom for
  //       Linux gzip variance + future first-party growth.
  { name: "main bundle",        pattern: /^main-/,                budgetKb: 195 },
  { name: "entry index",        pattern: /^index-/,               budgetKb: 220 },
  // mermaid: 800 → 860 (2026-10 dependency audit). mermaid 11.15 → 11.17.2
  //   fixes GHSA-6x64-9x62-f2gx (CSS injection), GHSA-c4c3-pg64-4m4v and
  //   GHSA-3rrr-jr9j-h3q3 (prototype pollution), GHSA-2v8p-3f2j-5mp7 and
  //   GHSA-rhh3-jpg6-66xh (DoS). Measured 833.3 KB gzipped on Linux after
  //   the bump; lazy chunk, only fetched when a doc has a mermaid block.
  { name: "vendor: mermaid",    pattern: /^vendor-mermaid-/,      budgetKb: 860 },
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
  // @google/model-viewer + three.js, self-hosted (CSP bans the unpkg CDN).
  // Dynamic-imported only when a document contains a ```model3d block.
  { name: "vendor: modelviewer", pattern: /^vendor-modelviewer-/, budgetKb: 320 },
  { name: "vendor: other",      pattern: /^vendor-/,              budgetKb: 200 },
  // pdfjs-dist text extractor — lazy-loaded only when the user imports a PDF.
  // ~144 KB gzipped today; the heavy worker ships as a separate .mjs (not
  // size-checked here). It never touches the eager startup path.
  { name: "lazy: pdfjs",        pattern: /^pdf-/,                 budgetKb: 165 },
  // Prettier (Format document / code block) — standalone core + one chunk
  // per language plugin, all dynamic-imported on first format. The
  // TypeScript parser plugin is the largest at ~124 KB gz.
  { name: "lazy: prettier",     pattern: /^prettier-/,            budgetKb: 140 },
  // TypeScript compiler + ES/DOM lib .d.ts files for the opt-in "TypeScript
  // checks in code blocks" (src/lsp). One worker file, fetched only after
  // the user enables the setting; excluded from the PWA precache. Measured
  // 1325 KB gzipped (TypeScript 5.9).
  { name: "lazy: ts checker",   pattern: /^tsCheck\.worker-/,     budgetKb: 1450 },
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
  /** Gzipped KB per budget class, for --json. */
  const classes = {};
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
    const c = (classes[rule.name] ??= { kb: 0, files: 0 });
    c.kb += kb;
    c.files++;
    const ok = kb <= rule.budgetKb;
    if (!ok) failed++;
    const mark = ok ? "✓" : "✗";
    console.log(
      `  ${mark} ${rule.name.padEnd(20)} ${format(kb)} / ${format(rule.budgetKb)}   ${file}`,
    );
  }

  console.log(`\n  Total gzipped: ${format(total)}`);
  const jsonAt = process.argv.indexOf("--json");
  if (jsonAt !== -1 && process.argv[jsonAt + 1]) {
    const round = (x) => Math.round(x * 10) / 10;
    const out = { totalKb: round(total), classes: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, { kb: round(v.kb), files: v.files }])) };
    await fs.writeFile(process.argv[jsonAt + 1], JSON.stringify(out, null, 2) + "\n");
  }
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
