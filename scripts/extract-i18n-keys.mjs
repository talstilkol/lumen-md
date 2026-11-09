#!/usr/bin/env node
/**
 * Extract every i18n key + its English value from the English bundle,
 * `src/i18n/en/*.ts` (β.4.1; split out of `src/i18n/index.ts` in plan 12.1). Emits a `i18n/keys.json` blob that an external translation
 * step can feed into Claude / GPT / a translator's TMS.
 *
 * The output shape is intentionally flat — each entry is just
 * `{ key: <id>, en: <english value>, vars: <list of {var} placeholder names> }`
 * so a translator can verify they preserved every interpolation.
 *
 * Usage:
 *   node scripts/extract-i18n-keys.mjs > i18n/keys.json
 *   node scripts/extract-i18n-keys.mjs --check   # CI: fail if keys.json is stale
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// The `en` bundle is split into parts (plan 12.1); src/i18n/index.ts merges
// them in this order. Each part holds one `const en: Strings = { ... };`.
const PARTS = ["src/i18n/en/app.ts", "src/i18n/en/features.ts"];

let body = "";
for (const part of PARTS) {
  const text = readFileSync(resolve(part), "utf8");
  // Pull the `en: Strings = { ... };` block.
  const match = /const en:\s*Strings\s*=\s*\{([\s\S]+?)^\};/m.exec(text);
  if (!match) {
    console.error(`Could not locate the \`en\` bundle in ${part}`);
    process.exit(2);
  }
  body += match[1] + "\n";
}

// Match each `"key": "value"` (including escaped quotes inside the value).
// We don't need to support every JS quirk — the bundle is a flat object
// of string-to-string entries authored by hand.
const entryRe = /^\s*"([\w.\-]+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm;

// Each entry: { key, en, vars: [...] }
const entries = [];
let m;
while ((m = entryRe.exec(body)) !== null) {
  const [, key, raw] = m;
  // Unescape \" and \\ — the raw match preserves them.
  const en = raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  // Capture every {var} placeholder so translators don't drop them.
  const vars = [...en.matchAll(/\{(\w+)\}/g)].map((mm) => mm[1]);
  entries.push({ key, en, vars: [...new Set(vars)] });
}

// The parts are merged with spreads, so TypeScript no longer catches a key
// defined twice: a later part would silently win. Refuse it here.
const seen = new Set();
const dupes = entries.filter((e) => (seen.has(e.key) ? true : (seen.add(e.key), false))).map((e) => e.key);
if (dupes.length) {
  console.error(`✗ i18n key defined twice in src/i18n/en/: ${[...new Set(dupes)].join(", ")}`);
  process.exit(1);
}

// Output deterministically (key order from the bundle is preserved by
// extraction order, so we don't sort).

const out = {
  version: 1,
  generated_at: new Date().toISOString(),
  source: "src/i18n/en/*.ts (en bundle)",
  count: entries.length,
  entries,
};

const dest = resolve("i18n/keys.json");

if (process.argv.includes("--check")) {
  // Compare everything but the timestamp; never writes.
  const committed = existsSync(dest) ? JSON.parse(readFileSync(dest, "utf8")) : { entries: [] };
  const same = JSON.stringify(committed.entries) === JSON.stringify(entries) && committed.count === entries.length;
  if (same) {
    console.error(`✓ i18n/keys.json is up to date (${entries.length} entries)`);
    process.exit(0);
  }
  const was = new Map((committed.entries ?? []).map((e) => [e.key, JSON.stringify(e)]));
  const now = new Map(entries.map((e) => [e.key, JSON.stringify(e)]));
  const added = [...now.keys()].filter((k) => !was.has(k));
  const removed = [...was.keys()].filter((k) => !now.has(k));
  const changed = [...now.keys()].filter((k) => was.has(k) && was.get(k) !== now.get(k));
  console.error(`✗ i18n/keys.json is stale: ${added.length} missing, ${removed.length} removed, ${changed.length} changed.`);
  for (const [label, keys] of [["missing", added], ["removed", removed], ["changed", changed]]) {
    if (keys.length) console.error(`  ${label}: ${keys.slice(0, 20).join(", ")}${keys.length > 20 ? ", …" : ""}`);
  }
  console.error("  Run `npm run i18n:extract` and commit i18n/keys.json.");
  process.exit(1);
}

mkdirSync("i18n", { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.error(`✓ wrote ${entries.length} entries to ${dest}`);
// Echo the JSON to stdout too so the script can be piped.
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
