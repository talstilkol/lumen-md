#!/usr/bin/env node
/**
 * Lumen plugin publisher (γ.6).
 *
 * Reads a plugin directory (must contain `package.json`, `dist/index.js`),
 * signs the bundle with the author's Ed25519 key, and emits a registry-PR
 * payload that can be opened against `lumen-plugins-registry`.
 *
 * Usage:
 *   node scripts/publish-plugin.mjs --dir ./my-plugin \
 *     --key ~/.lumen/author-ed25519.key \
 *     --bundle-url https://cdn.example.com/my-plugin/1.0.0/index.js \
 *     [--registry-repo ../lumen-plugins-registry]
 *
 * If `--registry-repo` is supplied, the script writes the new entry into
 * the local clone's `registry.json` and stops there — the user runs
 * `git push + gh pr create` themselves. If omitted, the script just
 * prints the JSON entry + the signature.
 *
 * Why a stand-alone script and not a published `create-lumen-plugin`
 * package: the script is ~150 lines, ships in this repo, and works
 * without npm-publish access. We can promote it later.
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { argv, exit } from "node:process";
import {
  parseArgs,
  sha256Hex,
  buildRegistryEntry,
} from "./lib/plugin-entry.mjs";

const args = parseArgs(argv.slice(2));

if (!args.dir || !args.key || !args["bundle-url"]) {
  console.error(
    "usage: publish-plugin --dir <plugin-dir> --key <author.key> --bundle-url <https://…/index.js>\n" +
      "                      [--registry-repo <path> | --gh-pr <owner/repo>]\n" +
      "\n" +
      "Modes:\n" +
      "  (no flag)        print the registry JSON entry to stdout\n" +
      "  --registry-repo  patch a local clone of the registry repo\n" +
      "  --gh-pr          open a PR via GitHub API (needs GITHUB_TOKEN)",
  );
  exit(2);
}

const pluginDir = resolve(args.dir);
const keyPath = resolve(args.key.replace(/^~/, process.env.HOME ?? ""));
const bundleUrl = args["bundle-url"];

// ── 1. Read plugin manifest + bundle ──────────────────────────────────────
const pkg = JSON.parse(await readFile(join(pluginDir, "package.json"), "utf8"));
if (!pkg.name || !pkg.version) {
  console.error("plugin package.json must declare name + version");
  exit(2);
}

const bundlePath = join(pluginDir, "dist", "index.js");
let bundle;
try {
  bundle = await readFile(bundlePath);
  await stat(bundlePath);
} catch {
  console.error(`No bundle at ${bundlePath}. Run \`npm run build\` first.`);
  exit(2);
}

// ── 2. Compute SHA-256 + sign with Ed25519 ────────────────────────────────
const sha256 = sha256Hex(bundle);

const keyMaterial = await readFile(keyPath, "utf8");
const { sign } = await import("node:crypto");
let pem = keyMaterial.trim();
if (!pem.startsWith("-----BEGIN")) {
  // Allow raw 32-byte hex / base64 keys by wrapping into a PKCS8 PEM-ish blob.
  console.error(
    "Author key must be a PEM-encoded Ed25519 PKCS8 private key. Generate with:\n" +
      '  openssl genpkey -algorithm Ed25519 -out ~/.lumen/author-ed25519.key',
  );
  exit(2);
}

const signature = sign(null, Buffer.from(sha256, "hex"), pem).toString("base64");

// ── 3. Build registry entry (pure helper for unit testing) ───────────────
const entry = buildRegistryEntry(pkg, { bundleUrl, sha256, signature });

// ── 4. Three modes ────────────────────────────────────────────────────────
//   a) `--registry-repo <path>`   → patch a local clone, user pushes manually.
//   b) `--gh-pr <owner/repo>`     → open the PR via GitHub API directly.
//                                    Requires GITHUB_TOKEN env var.
//   c) (no flag)                  → print the JSON entry to stdout for piping.
if (args["gh-pr"]) {
  const slug = String(args["gh-pr"]);
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) {
    console.error("--gh-pr must look like 'owner/repo'");
    exit(2);
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Set GITHUB_TOKEN to a fine-grained PAT with 'contents:write + pull_requests:write' on " + slug);
    exit(2);
  }
  const branch = `publish/${entry.id}-${entry.version.replace(/\W+/g, "-")}`;
  const api = `https://api.github.com/repos/${slug}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "lumen-publish-plugin",
  };

  // 4a. Get the default branch SHA.
  const repoRes = await fetch(`${api}`, { headers });
  if (!repoRes.ok) throw new Error(`GitHub repo lookup failed: ${repoRes.status}`);
  const repo = await repoRes.json();
  const baseBranch = repo.default_branch;
  const refRes = await fetch(`${api}/git/refs/heads/${baseBranch}`, { headers });
  const { object: { sha: baseSha } } = await refRes.json();

  // 4b. Create the publish branch.
  await fetch(`${api}/git/refs`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });

  // 4c. Read existing registry.json from the default branch.
  const fileRes = await fetch(`${api}/contents/registry.json?ref=${baseBranch}`, { headers });
  if (!fileRes.ok) throw new Error(`Couldn't read registry.json from ${slug}: ${fileRes.status}`);
  const fileMeta = await fileRes.json();
  const current = JSON.parse(Buffer.from(fileMeta.content, "base64").toString("utf8"));
  const idx = current.plugins.findIndex((p) => p.id === entry.id);
  if (idx >= 0) current.plugins[idx] = entry;
  else current.plugins.push(entry);
  current.updated = new Date().toISOString().slice(0, 10);
  const newContent = Buffer.from(JSON.stringify(current, null, 2) + "\n").toString("base64");

  // 4d. Commit on the new branch.
  await fetch(`${api}/contents/registry.json`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `feat(plugins): publish ${entry.id}@${entry.version}`,
      content: newContent,
      sha: fileMeta.sha,
      branch,
    }),
  });

  // 4e. Open the pull request.
  const prRes = await fetch(`${api}/pulls`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `feat(plugins): publish ${entry.id}@${entry.version}`,
      head: branch,
      base: baseBranch,
      body:
        `Adds **${entry.name}** v${entry.version} to the registry.\n\n` +
        `- Bundle: ${entry.bundle}\n` +
        `- SHA-256: \`${sha256.slice(0, 16)}…\`\n` +
        `- Signature: \`${signature.slice(0, 24)}…\`\n` +
        `- Permissions: ${(entry.permissions ?? []).join(", ") || "(none)"}\n\n` +
        `_Submitted via \`lumen-publish-plugin\`._`,
    }),
  });
  if (!prRes.ok) {
    console.error(`PR creation failed: ${prRes.status} ${await prRes.text()}`);
    exit(2);
  }
  const pr = await prRes.json();
  console.log(`✓ Opened PR #${pr.number}: ${pr.html_url}`);
} else if (args["registry-repo"]) {
  const regPath = join(resolve(args["registry-repo"]), "registry.json");
  const reg = JSON.parse(await readFile(regPath, "utf8"));
  const idx = reg.plugins.findIndex((p) => p.id === entry.id);
  if (idx >= 0) reg.plugins[idx] = entry;
  else reg.plugins.push(entry);
  reg.updated = new Date().toISOString().slice(0, 10);
  await writeFile(regPath, JSON.stringify(reg, null, 2) + "\n");
  console.log(`✓ patched ${regPath}`);
  console.log(`  id: ${entry.id}`);
  console.log(`  sha256: ${sha256.slice(0, 12)}…`);
  console.log(`  signature: ${signature.slice(0, 16)}…`);
  console.log(
    "\nNext: cd " +
      args["registry-repo"] +
      ' && git checkout -b "publish/' +
      entry.id +
      '-' +
      entry.version +
      '" && git add registry.json && git commit -m "feat(plugins): publish ' +
      entry.id +
      "@" +
      entry.version +
      '" && gh pr create',
  );
} else {
  console.log(JSON.stringify(entry, null, 2));
}
