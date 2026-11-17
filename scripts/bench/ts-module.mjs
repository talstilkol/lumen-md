/**
 * The app's own TypeScript in plain Node (plan 7.8): a scorer that needs a
 * module from src/ (src/text/nikud.ts, src/agents/analystScore.ts) bundles it
 * with esbuild into a temporary ES module and imports that, so the score
 * runs the shipped code, not a copy. esbuild comes with Vite; nothing is
 * written into the repository.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cache = new Map();

/** `entry` (an absolute path to a .ts file) → its exports. */
export function importTs(entry) {
  if (!cache.has(entry)) cache.set(entry, bundle(entry));
  return cache.get(entry);
}

async function bundle(entry) {
  const { build } = await import("esbuild");
  const out = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", target: "node22", write: false, logLevel: "silent" });
  const dir = mkdtempSync(join(tmpdir(), "lumen-bench-"));
  try {
    const file = join(dir, "module.mjs");
    writeFileSync(file, out.outputFiles[0].text);
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
