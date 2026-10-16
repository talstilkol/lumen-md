// Bundles the extension host code and the webview script with esbuild.
//
//   node build.mjs           one-off build into dist/ and media/
//   node build.mjs --watch   rebuild on change
//
// The extension imports Lumen's shared remark plugins from ../../src and the
// unified/remark/rehype/KaTeX/mermaid packages from the repo-root
// node_modules, so run `npm install` at the repo root first. Everything is
// bundled: the packaged .vsix needs no node_modules.
import { build, context } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "package.json"));
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions[]} */
const targets = [
  {
    entryPoints: [join(here, "src/extension.ts")],
    outfile: join(here, "dist/extension.js"),
    platform: "node",
    format: "cjs",
    target: "node18",
    external: ["vscode"],
  },
  {
    entryPoints: [join(here, "src/webview.ts")],
    outfile: join(here, "media/preview.js"),
    platform: "browser",
    format: "iife",
    target: "es2020",
  },
];

// KaTeX stylesheet + fonts, served from media/katex via webview URIs.
const katexDist = join(dirname(require.resolve("katex/package.json")), "dist");
mkdirSync(join(here, "media/katex"), { recursive: true });
cpSync(join(katexDist, "katex.min.css"), join(here, "media/katex/katex.min.css"));
cpSync(join(katexDist, "fonts"), join(here, "media/katex/fonts"), { recursive: true });

const common = { bundle: true, minify: !watch, sourcemap: watch, logLevel: "info", legalComments: "none" };

if (watch) {
  for (const t of targets) await (await context({ ...common, ...t })).watch();
} else {
  await Promise.all(targets.map((t) => build({ ...common, ...t })));
}
