#!/usr/bin/env node
/**
 * obsidianmd/obsidian-help as a compatibility corpus (plan W11.P3): Obsidian's
 * own help vault, the docs Obsidian writes in Obsidian, in English and Hebrew,
 * with the release notes and the Sandbox vault.
 *
 * The repository has no licence file (none at the pinned commit, and its
 * README names none), so its files are NOT copied into this repository. The
 * manifest (src/__tests__/fixtures/obsidian-help.manifest.json) pins the
 * commit and the sha256 of every file; this script downloads that commit into
 * .cache/obsidian-help/ (git-ignored) and checks every hash, and
 * src/__tests__/obsidianHelp.test.ts runs Lumen's open → save path over it.
 *
 *   node scripts/obsidian-help-corpus.mjs --fetch     download the pinned commit into the cache, then check
 *   node scripts/obsidian-help-corpus.mjs             check the cache against the manifest
 *   node scripts/obsidian-help-corpus.mjs --manifest  rewrite the manifest from the cache (after moving the pin)
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "src", "__tests__", "fixtures", "obsidian-help.manifest.json");
export const CACHE = join(ROOT, ".cache", "obsidian-help");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
/** The parts of the repository the corpus takes: the English and Hebrew vaults, the release notes, the Sandbox, the root notes. */
const SETS = ["en", "he", "Release notes", "Sandbox"];
const TEXT = /\.(md|base|canvas)$/;

function listText(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === ".git") continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (TEXT.test(e)) out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  for (const s of SETS) if (existsSync(join(dir, s))) walk(join(dir, s));
  for (const e of readdirSync(dir)) if (TEXT.test(e) && statSync(join(dir, e)).isFile()) out.push(e);
  return out.sort();
}

const args = process.argv.slice(2);
if (args.includes("--fetch")) {
  const tmp = mkdtempSync(join(tmpdir(), "obsidian-help-"));
  try {
    const git = (...a) => execFileSync("git", ["-C", tmp, ...a], { stdio: ["ignore", "ignore", "inherit"] });
    git("init", "-q");
    git("remote", "add", "origin", manifest.repo);
    // Only text is needed: leave the images and videos (≈ 1 GB) on GitHub.
    git("fetch", "-q", "--depth", "1", "--filter=blob:limit=1m", "origin", manifest.commit);
    git("sparse-checkout", "set", "--no-cone", ...SETS.map((s) => `/${s}/**/*.md`), "/*.md");
    git("-c", "core.autocrlf=false", "checkout", "-q", "FETCH_HEAD");
    rmSync(CACHE, { recursive: true, force: true });
    for (const f of listText(tmp)) {
      mkdirSync(dirname(join(CACHE, f)), { recursive: true });
      copyFileSync(join(tmp, f), join(CACHE, f));
    }
    writeFileSync(join(CACHE, ".commit"), manifest.commit + "\n");
    console.log(`obsidian-help: ${listText(CACHE).length} text files at ${manifest.commit.slice(0, 12)} in ${relative(ROOT, CACHE)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (!existsSync(CACHE)) {
  console.error(`${relative(ROOT, CACHE)} is missing: run node scripts/obsidian-help-corpus.mjs --fetch`);
  process.exit(1);
}

if (args.includes("--manifest")) {
  const files = listText(CACHE).map((path) => ({ path, sha256: sha(join(CACHE, path)), bytes: statSync(join(CACHE, path)).size }));
  writeFileSync(MANIFEST, JSON.stringify({ ...manifest, files }, null, 1) + "\n");
  console.log(`manifest: ${files.length} files`);
  process.exit(0);
}

let bad = 0;
for (const f of manifest.files) {
  const p = join(CACHE, f.path);
  if (!existsSync(p)) {
    console.error(`missing: ${f.path}`);
    bad++;
  } else if (sha(p) !== f.sha256) {
    console.error(`changed: ${f.path}`);
    bad++;
  }
}
const extra = listText(CACHE).filter((p) => !manifest.files.some((f) => f.path === p));
for (const p of extra) console.error(`not in the manifest: ${p}`);
console.log(`${manifest.files.length - bad}/${manifest.files.length} obsidian-help files match the manifest${extra.length ? `, ${extra.length} extra` : ""}`);
process.exit(bad || extra.length ? 1 : 0);
