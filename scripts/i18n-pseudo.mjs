#!/usr/bin/env node
/**
 * Pseudo-locales for layout and hard-coded-string testing (plan W13.I1).
 *
 *   node scripts/i18n-pseudo.mjs           write .pseudo/en-XA.json and .pseudo/ar-XB.json
 *   node scripts/i18n-pseudo.mjs --check   build both in memory and check them; exit 1 on a problem
 *
 * en-XA: every English string accented, 40 % longer and in ⟦ ⟧; ar-XB: the same,
 * right to left. Built from the English only on demand, into the git-ignored .pseudo/
 * folder — never under src/i18n/locales/, so never in the language picker or the
 * public build (--check fails if either code shows up there). e2e/i18n-pseudo.spec.ts
 * loads them through the test hooks and walks 20 surfaces: a string without
 * brackets is hard-coded, a bracketed label that overflows its box is cut off.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { ROOT, listLocales, readLocale } from "./lib/i18n-files.mjs";
import { lazyEnglishEntries } from "./lib/i18n-lazy.mjs";
import { PSEUDO_LOCALES, buildPseudo, checkPseudo } from "./lib/i18n-pseudo.mjs";

export const OUT = join(ROOT, ".pseudo");
const en = { ...readLocale("en"), ...Object.fromEntries(lazyEnglishEntries(ROOT)) };
const built = buildPseudo(en);

/** Where a pseudo locale must never appear: the locale folders, the picker list, a built bundle. */
function leaks() {
  const out = [];
  const codes = Object.keys(PSEUDO_LOCALES);
  for (const l of listLocales()) if (codes.includes(l)) out.push(`src/i18n/locales/${l}/ exists: a pseudo locale would ship`);
  const index = readFileSync(join(ROOT, "src/i18n/index.ts"), "utf8");
  const list = index.slice(index.indexOf("SUPPORTED_LOCALES"), index.indexOf("];", index.indexOf("SUPPORTED_LOCALES")));
  for (const c of codes) if (list.includes(`"${c}"`)) out.push(`SUPPORTED_LOCALES lists ${c}`);
  const dist = join(ROOT, "dist", "assets");
  if (existsSync(dist)) {
    for (const f of readdirSync(dist).filter((n) => n.endsWith(".js"))) {
      const js = readFileSync(join(dist, f), "utf8");
      if (js.includes("⟦") && /[ÁáéíöüñŕšţýžÉÍÖÜ]{3}/.test(js) && js.includes("one two three")) out.push(`dist/assets/${f} carries pseudo-locale strings`);
    }
  }
  return out;
}

const problems = [...checkPseudo(en, built), ...leaks()];
if (problems.length) {
  for (const p of problems.slice(0, 50)) console.error(`  ✗ ${p}`);
  console.error(`✗ pseudo locales: ${problems.length} problem(s)`);
  exit(1);
}
if (argv.includes("--check")) {
  console.log(`✓ pseudo locales built in memory: ${Object.keys(PSEUDO_LOCALES).join(", ")} — ${Object.keys(en).length} strings each, bracketed and ≥ 40 % longer; not in the picker or the public build`);
} else {
  mkdirSync(OUT, { recursive: true });
  for (const [code, dir] of Object.entries(PSEUDO_LOCALES)) writeFileSync(join(OUT, `${code}.json`), JSON.stringify({ dir, strings: built[code] }) + "\n");
  console.log(`✓ wrote .pseudo/en-XA.json and .pseudo/ar-XB.json (${Object.keys(en).length} strings each)`);
}
