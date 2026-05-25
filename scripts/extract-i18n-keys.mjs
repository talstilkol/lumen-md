#!/usr/bin/env node
/**
 * Extract every i18n key + its English value from `src/i18n/index.ts`
 * (β.4.1). Emits a `i18n/keys.json` blob that an external translation
 * step can feed into Claude / GPT / a translator's TMS.
 *
 * The output shape is intentionally flat — each entry is just
 * `{ key: <id>, en: <english value>, vars: <list of {var} placeholder names> }`
 * so a translator can verify they preserved every interpolation.
 *
 * Usage:
 *   node scripts/extract-i18n-keys.mjs > i18n/keys.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const PATH = resolve("src/i18n/index.ts");
const text = readFileSync(PATH, "utf8");

// Pull the `en: Strings = { ... };` block.
const match = /const en:\s*Strings\s*=\s*\{([\s\S]+?)^\};/m.exec(text);
if (!match) {
  console.error("Could not locate the `en` bundle in src/i18n/index.ts");
  process.exit(2);
}

const body = match[1];

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

// Output deterministically (key order from the bundle is preserved by
// extraction order, so we don't sort).

const out = {
  version: 1,
  generated_at: new Date().toISOString(),
  source: "src/i18n/index.ts (en bundle)",
  count: entries.length,
  entries,
};

mkdirSync("i18n", { recursive: true });
const dest = resolve("i18n/keys.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.error(`✓ wrote ${entries.length} entries to ${dest}`);
// Echo the JSON to stdout too so the script can be piped.
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
