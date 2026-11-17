#!/usr/bin/env node
/**
 * `npm run privacy:ledger` (plan W6.29, W10.D17): every network call in the
 * app's production source goes through the privacy ledger. The same rule as
 * pr:check (scripts/lib/prGate.mjs, unregisteredNetworkCalls), on every line
 * of src/ rather than on the lines a PR adds: a fetch, fetchWithRetry,
 * WebSocket, EventSource, XMLHttpRequest, sendBeacon or importScripts call
 * names a host src/ai/privacyLedger.ts knows, or carries
 * `// privacy-ledger: <the rule or path that records it>` on its line or the
 * two above. There is no baseline: one call without either fails.
 *
 * A gate of its own in scripts/vercel-build.mjs (preview and production), so
 * it does not depend on the vitest run; src/__tests__/ledgerGaps.test.ts
 * checks the same thing in the suite.
 *
 *   node scripts/privacy-ledger-check.mjs [--root <dir>] [--json]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isProductionSource, unregisteredNetworkCalls } from "./lib/prGate.mjs";
import { builtWorkerGaps, workerSourceGaps, workerSources } from "./lib/workerLedgerScan.mjs";

/** Every production file under `root`/src, with each line and the two above it. */
export function sourceLines(root) {
  const out = {};
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (isProductionSource(rel)) {
        const lines = readFileSync(join(root, rel), "utf8").split("\n");
        out[rel] = lines.map((text, i) => ({ line: i + 1, text, before: lines.slice(Math.max(0, i - 2), i) }));
      }
    }
  };
  walk("src");
  return out;
}

/** The calls outside the ledger: [{ file, line, text, why }]. */
export function ledgerGaps(root) {
  return unregisteredNetworkCalls(sourceLines(root), readFileSync(join(root, "src/ai/privacyLedger.ts"), "utf8"));
}

/**
 * W13.P2: every worker — found by what starts it or what its built file
 * does, never by its name — carries the ledger bridge. `dist` is scanned
 * when a build is there.
 */
export function workerGaps(root, dist = join(root, "dist")) {
  const source = workerSourceGaps(root).map((g) => ({ ...g, line: 1, text: "" }));
  const built = builtWorkerGaps(dist);
  return { gaps: [...source, ...(built?.gaps ?? []).map((g) => ({ ...g, line: 0, text: "" }))], sources: workerSources(root).length, built };
}

function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--root");
  const root = resolve(at >= 0 ? argv[at + 1] : join(dirname(fileURLToPath(import.meta.url)), ".."));
  const calls = ledgerGaps(root);
  const workers = workerGaps(root);
  const gaps = [...calls, ...workers.gaps];
  if (argv.includes("--json")) console.log(JSON.stringify(gaps, null, 2));
  if (!workers.sources && existsSync(join(root, "src/ai/workerLedgerInstall.ts"))) {
    // The app has a worker ledger bridge, so it has workers: a scan that finds none checks nothing.
    console.error("✗ privacy:ledger: no worker found in src/ — the worker scan has nothing to check");
    process.exitCode = 1;
    return;
  }
  const builtNote = workers.built ? `${workers.built.workers} built worker file(s) in dist/assets scanned by content` : "no dist/ to scan (run after a build to check the built workers too)";
  if (!gaps.length) {
    console.log("privacy:ledger: every network call in src/ names a ledger host or carries its `// privacy-ledger:` note");
    console.log(`privacy:ledger: every worker carries the ledger bridge — ${workers.sources} worker source(s), found by what starts them, not by name (argon2Worker.ts included); ${builtNote}`);
    return;
  }
  for (const g of gaps) console.error(`${g.file}${g.line ? `:${g.line}` : ""}: ${g.why}${g.text ? `\n    ${g.text.slice(0, 160)}` : ""}`);
  console.error(`\n✗ privacy:ledger: ${gaps.length} gap(s) outside the privacy ledger. Route each network call through a ledger rule, or add \`// privacy-ledger: <rule>\` above it; a worker imports src/ai/workerLedgerInstall.ts first.`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
