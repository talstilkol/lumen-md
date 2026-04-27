#!/usr/bin/env node
/**
 * create-lumen-plugin — scaffold a new Lumen plugin.
 *
 * Usage:
 *   npx create-lumen-plugin my-cool-plugin
 *
 * Creates a directory `my-cool-plugin/` with:
 *   • package.json          — npm package metadata
 *   • src/index.ts          — plugin entry, registered via the Lumen plugin API
 *   • src/block.tsx         — example custom code-fence renderer
 *   • lumen-plugin.json     — plugin manifest (id / name / icon / commands)
 *   • README.md             — install/dev/publish instructions
 *   • tsconfig.json + vite config for build → ESM bundle for the registry
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const name = (args[0] ?? "").trim();

if (!name) {
  console.error("Usage: create-lumen-plugin <name>");
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]+$/.test(name)) {
  console.error("Plugin name must be lowercase-kebab-case (e.g. my-cool-plugin).");
  process.exit(1);
}

const dest = path.join(process.cwd(), name);

async function main() {
  await fs.mkdir(dest, { recursive: true });
  const tplDir = path.join(__dirname, "template");
  await copyDir(tplDir, dest, name);
  console.log(`\n✨  Created Lumen plugin at ./${name}\n`);
  console.log(`Next steps:`);
  console.log(`  cd ${name}`);
  console.log(`  npm install`);
  console.log(`  npm run dev          # rebuild on save`);
  console.log(`  npm run build        # produce dist/${name}.js for the registry`);
  console.log(``);
  console.log(`To install in your local Lumen instance:`);
  console.log(`  Open Lumen → ⌘K → "Plugin gallery" → "Load unpacked" → pick dist/${name}.js`);
  console.log(``);
}

async function copyDir(srcDir, destDir, pluginName) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(srcDir, e.name);
    const destPath = path.join(destDir, e.name);
    if (e.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDir(srcPath, destPath, pluginName);
    } else {
      let body = await fs.readFile(srcPath, "utf8");
      body = body.replace(/__PLUGIN_NAME__/g, pluginName);
      body = body.replace(
        /__PLUGIN_TITLE__/g,
        pluginName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      );
      await fs.writeFile(destPath, body, "utf8");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
