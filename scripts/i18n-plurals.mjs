#!/usr/bin/env node
/**
 * The CLDR plural gate (plan W13.I2), part of `npm run i18n:check`.
 *
 *   node scripts/i18n-plurals.mjs --check          exit 1 on any problem
 *   node scripts/i18n-plurals.mjs --prune-pending  drop the keys that no longer count without a plural block
 *   node scripts/i18n-plurals.mjs --list           the count strings still waiting (i18n/plural-pending.json)
 *
 * For every key whose English is a plural block ({count, plural, one {…} other {…}}),
 * every language must have exactly the categories of
 * Intl.PluralRules(locale).resolvedOptions().pluralCategories (Arabic: zero, one, two,
 * few, many, other), the same count variable, and every {var} of the English in each
 * form. The old `.one` / `.other` key pairs are refused. An English string that counts
 * something ("{n} notes") without a plural block must be listed in
 * i18n/plural-pending.json, which only shrinks: a new one fails, and a listed one that
 * was converted must be removed (--prune-pending). With no plural key at all the gate
 * fails, so it never passes on nothing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { ROOT, listLocales, readLocale } from "./lib/i18n-files.mjs";
import { lazyEnglishEntries } from "./lib/i18n-lazy.mjs";
import { checkPlurals } from "./lib/i18n-plural.mjs";

const PENDING = join(ROOT, "i18n", "plural-pending.json");
const args = new Set(argv.slice(2));

const en = { ...readLocale("en"), ...Object.fromEntries(lazyEnglishEntries(ROOT)) };
const locales = Object.fromEntries(listLocales().filter((l) => l !== "en").map((l) => [l, readLocale(l)]));
const pendingFile = existsSync(PENDING) ? JSON.parse(readFileSync(PENDING, "utf8")) : { keys: [] };
const result = checkPlurals({ en, locales, pending: pendingFile.keys });

if (args.has("--prune-pending")) {
  const keep = pendingFile.keys.filter((k) => result.counting.includes(k));
  writeFileSync(PENDING, JSON.stringify({ ...pendingFile, keys: keep }, null, 2) + "\n");
  console.log(`✓ ${pendingFile.keys.length - keep.length} converted key(s) removed; ${keep.length} still pending`);
  exit(0);
}
if (args.has("--list")) {
  // One write and no exit(): a piped stdout is flushed before the process ends.
  process.stdout.write(result.counting.map((k) => `${k}\t${JSON.stringify(en[k])}\n`).join(""));
} else check();

function check() {
  const langs = Object.keys(locales).length;
  if (!result.plural.length || !langs) {
    console.error("✗ i18n plurals: no plural key or no language found — the gate has nothing to check");
    exit(1);
  }
  if (result.problems.length) {
    for (const p of result.problems.slice(0, 200)) console.error(`  ✗ ${p.locale} ${p.key}: ${p.kind}${p.detail ? ` — ${p.detail}` : ""}`);
    console.error(`✗ i18n plurals: ${result.problems.length} problem(s)`);
    exit(1);
  }
  console.log(`✓ i18n plurals: ${result.plural.length} plural keys have every CLDR form in ${langs + 1} languages; ${result.counting.length} count strings still pending`);
}
