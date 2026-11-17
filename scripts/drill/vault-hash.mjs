#!/usr/bin/env node
/**
 * The vault hash of the three-device drill (plan W13.S7): SHA-256 over every
 * synced file of a vault folder, sorted by path — `path \0 text` lines joined
 * with "\n", the same as src/__tests__/sync3Devices.test.ts. `.trash/` and
 * `.git/` are left out, as the encrypted sync leaves them out.
 *
 *   node scripts/drill/vault-hash.mjs <vault folder>
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export function vaultHash(root) {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const rel = relative(root, p).split("\\").join("/");
      if (rel === ".trash" || rel === ".git" || e.name === ".DS_Store") continue;
      if (e.isDirectory()) walk(p);
      else files.push(rel);
    }
  };
  walk(root);
  files.sort();
  return createHash("sha256").update(files.map((f) => `${f}\0${readFileSync(join(root, f), "utf8")}`).join("\n")).digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.argv[2]) {
    console.error("usage: node scripts/drill/vault-hash.mjs <vault folder>");
    process.exit(2);
  }
  console.log(vaultHash(process.argv[2]));
}
