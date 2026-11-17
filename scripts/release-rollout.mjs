#!/usr/bin/env node
/**
 * Move a desktop release through its stages, or stop it (plan W13.T1):
 *
 *   npm run release:rollout -- v1.5.0 --next          5% → 25% → 100%
 *   npm run release:rollout -- v1.5.0 --percent 25
 *   npm run release:rollout -- v1.5.0 --halt          nobody else is offered it, at once
 *   npm run release:rollout -- v1.5.0 --resume        lift the halt, at the stage it had
 *   npm run release:rollout -- beta-channel --halt    the beta feed
 *   … --dry-run                                       download, check, change and sign; upload nothing
 *
 * Steps: the release's latest.json and latest.json.sig are downloaded and
 * verified with the updater key (security/updater-key.pub or
 * LUMEN_UPDATER_PUBKEY) before anything in them is read; the rollout is
 * changed with the app's own rule (src/update/stagedRollout.ts), the expiry
 * renewed, and the new bytes signed with the updater key
 * (TAURI_SIGNING_PRIVATE_KEY, through `tauri signer sign`) and verified
 * again; then both files are uploaded over the old ones. A device that
 * already installed the release keeps it: a halt stops new installs, and
 * a broken release is fixed by the next version (the app refuses anything
 * older than what it ran: W11.S2).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MANIFEST, MANIFEST_SIG, manifestProblems, normalizeUpdaterPubkey, signManifest } from "./lib/releaseRun.mjs";
import { describeRollout, parseRolloutArgs, rolloutCommand } from "./lib/rollout.mjs";

const ROOT = process.cwd();

function repoOf() {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).trim();
  const m = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`origin is not a GitHub repository: ${url}`);
  return m[1];
}

function updaterPubkey() {
  const env = process.env.LUMEN_UPDATER_PUBKEY;
  const file = path.join(ROOT, "security", "updater-key.pub");
  const raw = env || (existsSync(file) ? readFileSync(file, "utf8") : "");
  return normalizeUpdaterPubkey(raw.trim());
}

function tauriSigner(file) {
  rmSync(`${file}.sig`, { force: true });
  const r = spawnSync("npm", ["run", "tauri", "--", "signer", "sign", file], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error("tauri signer sign failed: is TAURI_SIGNING_PRIVATE_KEY (and _PASSWORD) set?");
  return readFileSync(`${file}.sig`, "utf8");
}

function main(argv) {
  const cmd = parseRolloutArgs(argv);
  const repo = repoOf();
  const pubkey = updaterPubkey();
  const dir = mkdtempSync(path.join(tmpdir(), "lumen-rollout-"));
  try {
    execFileSync("gh", ["release", "download", cmd.tag, "--repo", repo, "--pattern", MANIFEST, "--pattern", MANIFEST_SIG, "--dir", dir], { stdio: "inherit" });
    const bytes = readFileSync(path.join(dir, MANIFEST));
    const sig = existsSync(path.join(dir, MANIFEST_SIG)) ? readFileSync(path.join(dir, MANIFEST_SIG)) : null;
    const problems = manifestProblems(new Map([[MANIFEST, bytes], ...(sig ? [[MANIFEST_SIG, sig]] : [])]), pubkey);
    if (!sig) problems.push(`${MANIFEST_SIG} is missing on ${cmd.tag}`);
    if (problems.length) throw new Error(`the release's manifest does not verify, so it is not changed:\n  ${problems.join("\n  ")}`);
    const latest = JSON.parse(bytes.toString("utf8"));
    console.log(`now:  ${describeRollout(latest)}`);
    const next = rolloutCommand(latest, cmd, { tag: cmd.tag.startsWith("v") ? cmd.tag : undefined });
    console.log(`next: ${describeRollout(next)}`);
    const file = path.join(dir, MANIFEST);
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
    const newBytes = readFileSync(file);
    writeFileSync(path.join(dir, MANIFEST_SIG), signManifest(newBytes, { pem: null, pubkey }, { file, tauriSigner }) + "\n");
    const after = manifestProblems(new Map([[MANIFEST, newBytes], [MANIFEST_SIG, readFileSync(path.join(dir, MANIFEST_SIG))]]), pubkey);
    if (after.length) throw new Error(after.join("; "));
    if (cmd.dryRun) {
      console.log(`dry run: signed and verified in ${dir}; would run: gh release upload ${cmd.tag} --repo ${repo} ${MANIFEST} ${MANIFEST_SIG} --clobber`);
      return 0;
    }
    execFileSync("gh", ["release", "upload", cmd.tag, "--repo", repo, file, path.join(dir, MANIFEST_SIG), "--clobber"], { stdio: "inherit" });
    console.log(`${cmd.tag}: ${describeRollout(next)}`);
    return 0;
  } finally {
    if (!cmd.dryRun) rmSync(dir, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(`release:rollout: ${e.message}`);
  process.exitCode = 1;
}
