#!/usr/bin/env node
/**
 * create-lumen-plugin — scaffold a new Lumen plugin.
 *
 * Usage:
 *   npx create-lumen-plugin my-cool-plugin
 *
 * Creates a directory `my-cool-plugin/` with:
 *   • lumen-plugin.json     — manifest: id, version, capabilities (each with a reason)
 *   • main.js               — the plugin; runs in Lumen's QuickJS sandbox
 *   • pack.mjs              — packs (and optionally signs) dist/<id>-<version>.lumenplugin.json
 *   • package.json, README.md
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
  console.log(`  edit lumen-plugin.json (id, capabilities) and main.js`);
  console.log(`  npm run pack         # → dist/<id>-<version>.lumenplugin.json`);
  console.log(``);
  console.log(`Install it in Lumen: Plugins → "Install from file…" → pick the .lumenplugin.json`);
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
