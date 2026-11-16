#!/usr/bin/env node
/**
 * Plan W10.A14: every relative and `@/` import in src/, security/ and scripts/
 * names a file that exists (scripts/lib/importCheck.mjs). The offline train's
 * first, fail-fast gate: a broken import is red in seconds.
 *
 *   node scripts/check-imports.mjs                 this checkout
 *   node scripts/check-imports.mjs --root <dir>    another checkout
 *
 * Exit 1 when any import names no file.
 */
import { resolve } from "node:path";
import { brokenImports } from "./lib/importCheck.mjs";

const argv = process.argv.slice(2);
const i = argv.indexOf("--root");
const root = resolve(i >= 0 ? argv[i + 1] : process.cwd());
const t0 = Date.now();
const { files, broken } = brokenImports(root);
for (const b of broken) console.error(`✗ ${b.file}: import "${b.spec}" names no file`);
console.log(`${broken.length ? "✗" : "✓"} imports: ${files} files, ${broken.length} broken import(s) in ${Date.now() - t0} ms`);
process.exit(broken.length ? 1 : 0);
