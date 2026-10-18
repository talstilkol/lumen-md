#!/usr/bin/env node
/**
 * Write docs/dev/HANDOFF.md: everything the next agent (or person) needs to
 * pick the work up — open PRs as a stack with CI and unanswered review
 * comments, worktrees, the current task and the next step (plan 0.13).
 *
 *   npm run handoff -- --task "4.5 [[ autocomplete" --next "push and open the PR"
 *   npm run handoff -- --stdout          print instead of writing the file
 *   npm run handoff -- --no-github       local data only (no gh calls)
 *
 * Needs `gh` signed in for the PR part. Exits 1 when a branch or worktree it
 * names does not exist, after writing the file (the problems are listed in it).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { missingRefs, parseWorktrees, renderHandoff } from "./lib/handoff.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
process.chdir(root);
const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] ?? "" : null;
};
const flag = (n) => argv.includes(`--${n}`);

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${(r.stderr || "").trim().slice(0, 300)}`);
  return r.stdout;
}
const ghJson = (path) => JSON.parse(sh("gh", ["api", "--paginate", "--slurp", path])).flat();

function repoName() {
  const url = sh("git", ["remote", "get-url", "origin"]).trim();
  const m = /github\.com[:/](.+?)(\.git)?$/.exec(url) ?? /\/git\/([^/]+\/[^/]+?)(\.git)?$/.exec(url);
  return m ? m[1] : url;
}

const repo = repoName();
const worktrees = parseWorktrees(sh("git", ["worktree", "list", "--porcelain"]));
const branches = sh("git", ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin"])
  .split("\n")
  .filter(Boolean)
  .map((r) => r.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/origin\//, ""));

let prs = [];
if (!flag("no-github")) {
  prs = ghJson(`repos/${repo}/pulls?state=open&per_page=100`).map((p) => ({ number: p.number, title: p.title, head: p.head.ref, base: p.base.ref }));
  for (const p of prs) {
    try {
      const runs = JSON.parse(sh("gh", ["api", `repos/${repo}/actions/runs?branch=${encodeURIComponent(p.head)}&per_page=10`])).workflow_runs ?? [];
      const ci = runs.find((r) => r.name === "CI");
      p.ci = ci ? (ci.status === "completed" ? ci.conclusion : null) : undefined;
      p.ciSha = ci?.head_sha?.slice(0, 8);
      const comments = ghJson(`repos/${repo}/pulls/${p.number}/comments?per_page=100`);
      const replied = new Set(comments.map((c) => c.in_reply_to_id).filter(Boolean));
      p.unanswered = comments.filter((c) => !c.in_reply_to_id && !replied.has(c.id)).length;
    } catch (e) {
      p.ci = undefined;
      p.unanswered = undefined;
      console.error(`handoff: PR #${p.number}: ${e.message}`);
    }
  }
}

const problems = missingRefs({ prs, worktrees, branches });
const md = renderHandoff({
  now: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  repo,
  task: opt("task"),
  next: opt("next"),
  prs,
  worktrees,
  problems,
});
if (flag("stdout")) process.stdout.write(md);
else {
  const file = resolve(root, "docs/dev/HANDOFF.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, md);
  console.log(`handoff: wrote docs/dev/HANDOFF.md (${prs.length} PRs, ${worktrees.length} worktrees${problems.length ? `, ${problems.length} problems` : ""})`);
}
process.exit(problems.length ? 1 : 0);
