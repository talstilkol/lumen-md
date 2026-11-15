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
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isProductionSource, unregisteredNetworkCalls } from "./lib/prGate.mjs";

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

function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--root");
  const root = resolve(at >= 0 ? argv[at + 1] : join(dirname(fileURLToPath(import.meta.url)), ".."));
  const gaps = ledgerGaps(root);
  if (argv.includes("--json")) console.log(JSON.stringify(gaps, null, 2));
  if (!gaps.length) {
    console.log("privacy:ledger: every network call in src/ names a ledger host or carries its `// privacy-ledger:` note");
    return;
  }
  for (const g of gaps) console.error(`${g.file}:${g.line}: ${g.why}\n    ${g.text.slice(0, 160)}`);
  console.error(`\n✗ privacy:ledger: ${gaps.length} network call(s) outside the privacy ledger. Route each through a ledger rule, or add \`// privacy-ledger: <rule>\` above it.`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
