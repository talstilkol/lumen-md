#!/usr/bin/env node
/**
 * Source provenance and a VSA for each head of a protected branch (plan
 * W13.T3, SLSA 1.2 Source track, level 2). See source-vsa-lib.mjs for what
 * is verified.
 *
 *   npm run release:source-vsa -- --ref verify/train-7 [--commit <sha>] --fetch --key <pem> [--out security/source-vsa]
 *   npm run release:source-vsa -- --trains --fetch --key <pem>     every origin/verify/* head and origin/main
 *   … --live <file>     the server's rulesets from a saved `gh api` answer instead of --fetch
 *   … --test-key        sign with a throwaway TEST key (a dry run; release:verify refuses it)
 *
 * For each head: <out>/<sha>.provenance.json and <out>/<sha>.vsa.json (DSSE
 * envelopes) and <out>/<ref>.head (the last verified head of that ref, the
 * "previous" of the next run: a head that does not descend from it fails
 * the history check). The key is Ed25519 PEM (LUMEN_SOURCE_VSA_KEY); its
 * public half goes in security/source-vsa.json.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attest } from "./source-vsa-lib.mjs";

const git = (root, ...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** The server's rulesets with their rules (gh api; the list endpoint omits the rules). */
export function fetchLive(repo, call = (args) => execFileSync("gh", args, { encoding: "utf8" })) {
  const list = JSON.parse(call(["api", `repos/${repo}/rulesets`]));
  return list.map((r) => JSON.parse(call(["api", `repos/${repo}/rulesets/${r.id}`])));
}

/** Facts for one head of `ref`. */
export function factsFor(root, { ref, commit, previous, live }) {
  let committed = [];
  try {
    committed = JSON.parse(git(root, "show", `${commit}:security/github-ruleset.json`)).rulesets ?? [];
  } catch {
    // why: no ruleset at that commit — nothing is declared, so the continuity check fails (never assumed)
  }
  let isAncestor = null;
  if (previous) isAncestor = spawnSync("git", ["merge-base", "--is-ancestor", previous, commit], { cwd: root }).status === 0;
  return { ref, commit, previous: previous ?? null, isAncestor, committed, live: live ?? null, receipts: null };
}

function main(argv) {
  const has = (f) => argv.includes(f);
  const get = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const root = resolve(get("--root") ?? ".");
  const out = resolve(get("--out") ?? join(root, "security", "source-vsa"));
  const repo = "talstilkol/lumen-md";
  let pem;
  if (has("--test-key")) pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  else {
    const keyPath = get("--key") ?? process.env.LUMEN_SOURCE_VSA_KEY;
    if (!keyPath || !existsSync(keyPath)) throw new Error("no source key: --key <Ed25519 PEM> or LUMEN_SOURCE_VSA_KEY (or --test-key for a dry run)");
    pem = readFileSync(keyPath, "utf8");
  }
  const live = get("--live") ? JSON.parse(readFileSync(get("--live"), "utf8")) : has("--fetch") ? fetchLive(repo) : null;
  const heads = [];
  if (has("--trains")) {
    for (const line of git(root, "for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes/origin/verify/", "refs/remotes/origin/main").split("\n").filter(Boolean)) {
      const [r, sha] = line.split(" ");
      heads.push({ ref: r.replace("refs/remotes/origin/", "refs/heads/"), commit: sha });
    }
  } else {
    const ref = `refs/heads/${String(get("--ref") ?? "main").replace(/^refs\/heads\//, "")}`;
    heads.push({ ref, commit: get("--commit") ?? git(root, "rev-parse", `origin/${ref.slice("refs/heads/".length)}`) });
  }
  mkdirSync(out, { recursive: true });
  let failed = 0;
  for (const h of heads) {
    const headFile = join(out, `${h.ref.replace(/^refs\/heads\//, "").replace(/\//g, "__")}.head`);
    const previous = existsSync(headFile) ? readFileSync(headFile, "utf8").trim() : null;
    const r = attest(factsFor(root, { ...h, previous: previous === h.commit ? null : previous, live }), pem);
    writeFileSync(join(out, `${h.commit}.provenance.json`), JSON.stringify(r.provenance, null, 2) + "\n");
    writeFileSync(join(out, `${h.commit}.vsa.json`), JSON.stringify(r.vsa, null, 2) + "\n");
    const ok = r.evaluation.level >= 2;
    if (ok) writeFileSync(headFile, `${h.commit}\n`);
    else failed++;
    console.log(`${ok ? "✓" : "✗"} ${h.ref} @ ${h.commit.slice(0, 12)}: SLSA source level ${r.evaluation.level}${has("--test-key") ? " (TEST key)" : ""}`);
    for (const c of r.evaluation.checks) if (!c.ok) console.log(`    ✗ ${c.id}: ${c.detail}`);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`source-vsa: ${e.message}`);
    process.exitCode = 2;
  }
}
