#!/usr/bin/env node
/**
 * Which commit turned the train red? `git bisect run` on a fast subset (R12.12).
 *
 * After a red train: take the failing test files from the red log (failSig
 * blocks name them; or pass them), and bisect between the last green commit
 * and the red one, running only that subset. Local only: a temporary
 * detached worktree, `git bisect` inside it, then `bisect reset` and the
 * worktree removed, whatever happens. No GitHub Actions, no network, and the
 * caller's checkout and branches are never touched.
 *
 * `--first-parent` (the default for a train) walks the train's own line, so
 * the answer is the merge that brought the bad change in, and the PR number
 * is read from that merge's subject. `--all` walks into the merged branches
 * and names the commit itself.
 *
 * The test command's exit code is the verdict, as git expects: 0 good, 125
 * cannot test (skipped), anything else from 1 to 127 bad.
 *
 * Clean reimplementation; design reference only: israelconnect's
 * tools/control/culprit_finder.py and batch_bisect.py (AGPL), no code copied.
 *
 * CLI: node scripts/ci-doctor/culprit.mjs --good <sha> --bad <sha> [--all] -- <test command…>
 *      ({files} in the command is replaced by the subset given with --files a,b or --log red.log)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { failureBlocks } from "./failSig.mjs";

const git = (cwd, args, opts = {}) => execFileSync("git", ["-c", "rerere.enabled=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

/** Test files named in a red log: the fast subset to bisect with. */
export function fastSubset(log) {
  const files = new Set();
  for (const b of failureBlocks(log)) {
    const m = /((?:src|scripts|e2e|mcp-server|tests?)\/[\w./@+-]+\.(?:test|spec)\.[cm]?[jt]sx?)/.exec(`${b.test}\n${b.lines.join("\n")}`);
    if (m) files.add(m[1]);
  }
  return [...files].sort();
}

/** The PR number in a merge subject: "Merge pull request #123 …", "merge(x): #576 …", "… (#88)". */
export function prOfSubject(subject) {
  const m = /#(\d+)\b/.exec(subject);
  return m ? Number(m[1]) : null;
}

/**
 * Bisect `good..bad` in `repo` with `cmd` (an argv array). Returns the first
 * bad commit, its subject and PR, and the steps git took.
 */
export function findCulprit({ repo, good, bad, cmd, firstParent = true }) {
  if (!Array.isArray(cmd) || !cmd.length) throw new Error("cmd: the test command as an argv array");
  const root = git(repo, ["rev-parse", "--show-toplevel"]).trim();
  const goodSha = git(root, ["rev-parse", "--verify", `${good}^{commit}`]).trim();
  const badSha = git(root, ["rev-parse", "--verify", `${bad}^{commit}`]).trim();
  if (spawnSync("git", ["merge-base", "--is-ancestor", goodSha, badSha], { cwd: root }).status !== 0) throw new Error("good must be an ancestor of bad");
  const dir = mkdtempSync(join(tmpdir(), "ci-doctor-bisect-"));
  const wt = join(dir, "wt");
  git(root, ["worktree", "add", "--detach", wt, badSha]);
  try {
    git(wt, ["bisect", "start", ...(firstParent ? ["--first-parent"] : []), badSha, goodSha]);
    const run = spawnSync("git", ["bisect", "run", ...cmd], { cwd: wt, encoding: "utf8", maxBuffer: 64 << 20 });
    const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    const m = /^([0-9a-f]{40}) is the first bad commit/m.exec(out);
    const steps = (out.match(/^Bisecting: /gm) ?? []).length;
    if (!m) return { culprit: null, steps, log: out.slice(-4000) };
    const subject = git(wt, ["log", "-1", "--format=%s", m[1]]).trim();
    const parents = git(wt, ["log", "-1", "--format=%P", m[1]]).trim().split(" ").filter(Boolean);
    return { culprit: m[1], subject, pr: prOfSubject(subject), merge: parents.length > 1, steps };
  } finally {
    try {
      git(wt, ["bisect", "reset"]);
    } catch {
      /* why: nothing to reset when bisect start failed */
    }
    try {
      git(root, ["worktree", "remove", "--force", wt]);
    } catch {
      /* why: removed below with the temp dir; prune drops the record */
    }
    rmSync(dir, { recursive: true, force: true });
    try {
      git(root, ["worktree", "prune"]);
    } catch {
      /* why: best effort */
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const dd = argv.indexOf("--");
  const opts = dd >= 0 ? argv.slice(0, dd) : argv;
  let cmd = dd >= 0 ? argv.slice(dd + 1) : [];
  const opt = (k) => (opts.includes(k) ? opts[opts.indexOf(k) + 1] : null);
  const good = opt("--good");
  const bad = opt("--bad") ?? "HEAD";
  const files = opt("--files")?.split(",") ?? (opt("--log") ? fastSubset(readFileSync(opt("--log"), "utf8")) : []);
  if (!good || !cmd.length) {
    console.error("usage: culprit.mjs --good <sha> [--bad <sha>] [--all] [--files a,b | --log red.log] -- <test command…>  ({files} = the subset)");
    process.exit(2);
  }
  cmd = cmd.flatMap((a) => (a === "{files}" ? files : [a]));
  const r = findCulprit({ repo: process.cwd(), good, bad, cmd, firstParent: !opts.includes("--all") });
  if (!r.culprit) {
    console.log(`no culprit found after ${r.steps} step(s):\n${r.log}`);
    process.exitCode = 1;
  } else console.log(`${r.culprit.slice(0, 10)} ${r.subject}${r.pr ? ` (PR #${r.pr})` : ""}${r.merge ? " [merge]" : ""} · ${r.steps} step(s)${files.length ? ` · subset: ${files.join(", ")}` : ""}`);
}
