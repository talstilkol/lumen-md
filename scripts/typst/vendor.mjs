#!/usr/bin/env node
/**
 * Writes public/vendor/typst/ (plan W12.F2) from the npm packages, after
 *   npm i -D @myriaddreamin/typst.ts@<pinned> @myriaddreamin/typst-ts-web-compiler@<pinned>
 * and a Hebrew TTF (OFL) in --fonts:
 *   typst.mjs      scripts/typst/entry.mjs bundled with typst.ts (esbuild, ESM)
 *   compiler.wasm  the web compiler's wasm
 *   fonts/*.ttf + fonts.json (file, licence)
 *   LICENSE.typst.ts (Apache-2.0)
 *
 *   node scripts/typst/vendor.mjs --fonts <dir with .ttf/.otf and their OFL.txt>
 *
 * The folder is git-ignored (like public/pyodide); this script regenerates it.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "public", "vendor", "typst");

/** The font files of a folder Typst can read (TTF/OTF; WOFF2 is not one). */
export function fontFiles(names) {
  return names.filter((n) => /\.(ttf|otf)$/i.test(n)).sort();
}

if (process.argv[1]?.endsWith("typst/vendor.mjs")) {
  const args = process.argv.slice(2);
  const fontsDir = args.includes("--fonts") ? args[args.indexOf("--fonts") + 1] : null;
  if (!fontsDir || !existsSync(fontsDir)) (console.error("--fonts <dir> with a Hebrew .ttf/.otf is required"), process.exit(2));
  const fonts = fontFiles(readdirSync(fontsDir));
  if (!fonts.length) (console.error(`no .ttf/.otf in ${fontsDir}`), process.exit(2));
  const compilerPkg = dirname(require.resolve("@myriaddreamin/typst-ts-web-compiler/package.json"));
  const wasm = readdirSync(compilerPkg, { recursive: true }).map(String).find((f) => f.endsWith("_bg.wasm"));
  if (!wasm) (console.error("no *_bg.wasm in @myriaddreamin/typst-ts-web-compiler"), process.exit(1));
  mkdirSync(join(out, "fonts"), { recursive: true });
  const { build } = await import("esbuild");
  await build({ entryPoints: [join(root, "scripts/typst/entry.mjs")], bundle: true, format: "esm", platform: "browser", outfile: join(out, "typst.mjs"), minify: true, logLevel: "error" });
  copyFileSync(join(compilerPkg, wasm), join(out, "compiler.wasm"));
  for (const f of fonts) copyFileSync(join(fontsDir, f), join(out, "fonts", f));
  const licence = readdirSync(fontsDir).find((n) => /^(OFL|LICENSE)/i.test(n));
  if (licence) copyFileSync(join(fontsDir, licence), join(out, "fonts", licence));
  const tsLicense = join(dirname(require.resolve("@myriaddreamin/typst.ts/package.json")), "LICENSE");
  if (existsSync(tsLicense)) copyFileSync(tsLicense, join(out, "LICENSE.typst.ts"));
  writeFileSync(join(out, "fonts.json"), JSON.stringify({ fonts: fonts.map((file) => ({ file, licence: licence ?? "see the font's own licence" })) }, null, 1) + "\n");
  console.log(`public/vendor/typst: typst.mjs, compiler.wasm, ${fonts.length} font(s)`);
}
