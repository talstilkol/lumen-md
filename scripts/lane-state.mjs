#!/usr/bin/env node
/**
 * A lane's STATE.md (W8.10): resume from it without redoing work or pushing
 * twice, and keep it written without anyone doing it.
 *
 *   node scripts/lane-state.mjs resume <STATE.md>              one action per branch
 *   node scripts/lane-state.mjs resume <STATE.md> --no-github  git only (no PR lookup)
 *   node scripts/lane-state.mjs table <STATE.md>                the Branches table with the
 *                                                               current origin heads filled in
 *
 * Written automatically (step 2: after every push, and every hour):
 *   node scripts/lane-state.mjs install-hook --state-dir <dir> | --state <STATE.md> [--force]
 *        the reference-transaction hook: once origin has a push that the pre-push hook
 *        (npm run ci:local -- --install-hook) noted, the lane's STATE.md gets the new head
 *        in Branches, a line in Pushes and a new Updated time. With --state-dir, the
 *        STATE.md is the one under <dir> whose Branches table lists the branch. It also
 *        writes the pre-push half when the clone has no pre-push hook (one command per clone).
 *   node scripts/lane-state.mjs watch <STATE.md> [--every-min 60]   the hourly timer:
 *        `tick` now and every N minutes, until stopped
 *   node scripts/lane-state.mjs ensure-watch   what the reference-transaction hook calls: starts
 *        `watch` in the background for the lane's STATE.md unless one already runs (W10.E57),
 *        so the hourly tick needs no one to start it ($LUMEN_LANE_TICK_MIN: the interval)
 *   node scripts/lane-state.mjs tick <STATE.md> [--no-remote]       once: Updated, and any
 *        Branches head that origin moved (ls-remote) recorded
 *   node scripts/lane-state.mjs record <STATE.md> --branch <b> --sha <sha>
 *   (pending / committed: what the two hooks call; stdin is git's)
 *
 * The lane state is found by: $LUMEN_LANE_STATE (a file), $LUMEN_LANE_STATE_DIR,
 * git config lumen.laneState, git config lumen.laneStateDir. With none set, the
 * hooks do nothing.
 *
 * resume and table only read (git fetch of the listed branches, ls-remote,
 * gh api GET); nothing here pushes, merges or opens a PR. The template and
 * the resume instruction are in docs/dev/lane-state.md.
 * resume exit 0: every branch is "nothing", "push" or "open-pr". Exit 1: a
 * branch needs a person ("look"), or STATE.md is stale ("record").
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PREPUSH_LINE, confirmedPushes, parseBranches, prePushPlan, pushedRefs, recordPush, renderBranches, resumeAction, stateFor, touchUpdated, txnHookPlan, watchPlan } from "./lib/lane-state.mjs";

const argv = process.argv.slice(2);
const [cmd, file] = argv;
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const REPO = process.env.LUMEN_REPO ?? "talstilkol/lumen-md";
const now = () => `${new Date().toISOString().slice(0, 16)}Z`;

function sh(args, cwd) {
  const r = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function facts(row) {
  const local = existsSync(row.worktree) ? sh(["git", "rev-parse", "HEAD"], row.worktree) : null;
  const cwd = local ? row.worktree : process.cwd();
  const remote = (sh(["git", "ls-remote", "origin", `refs/heads/${row.branch}`], cwd) ?? "").split(/\s+/)[0] || null;
  let ahead = null;
  let behind = null;
  if (local && remote && sh(["git", "fetch", "-q", "origin", row.branch], cwd) !== null) {
    const n = sh(["git", "rev-list", "--left-right", "--count", `${remote}...${local}`], cwd);
    if (n) [behind, ahead] = n.split(/\s+/).map(Number);
  }
  let prs = [];
  if (!flag("no-github")) {
    const out = sh(["gh", "api", `repos/${REPO}/pulls?state=all&head=${REPO.split("/")[0]}:${row.branch}`, "--jq", ".[].number"]);
    prs = (out ?? "").split("\n").filter(Boolean).map(Number);
  }
  return { local, remote, prs, ahead, behind };
}

const readStdin = () => {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

/** Where the lane state lives → { file } | { dir } | null. */
function laneConfig() {
  if (process.env.LUMEN_LANE_STATE) return { file: resolve(process.env.LUMEN_LANE_STATE) };
  if (process.env.LUMEN_LANE_STATE_DIR) return { dir: resolve(process.env.LUMEN_LANE_STATE_DIR) };
  const f = sh(["git", "config", "--get", "lumen.laneState"]);
  if (f) return { file: f };
  const d = sh(["git", "config", "--get", "lumen.laneStateDir"]);
  return d ? { dir: d } : null;
}

/** Candidate STATE.md files of a config: the file, or <dir>/STATE.md and <dir>/*\/STATE.md. */
function stateFiles(cfg) {
  if (cfg.file) return existsSync(cfg.file) ? [cfg.file] : [];
  const out = [];
  if (existsSync(join(cfg.dir, "STATE.md"))) out.push(join(cfg.dir, "STATE.md"));
  for (const e of existsSync(cfg.dir) ? readdirSync(cfg.dir, { withFileTypes: true }) : []) if (e.isDirectory() && existsSync(join(cfg.dir, e.name, "STATE.md"))) out.push(join(cfg.dir, e.name, "STATE.md"));
  return out;
}

const pendingFile = () => resolve(sh(["git", "rev-parse", "--git-path", "lumen-lane-pending.json"]) ?? ".git/lumen-lane-pending.json");
const readPending = () => {
  try {
    return JSON.parse(readFileSync(pendingFile(), "utf8"));
  } catch {
    return [];
  }
};

/** Write a file through a temporary name, so a reader never sees half of it. */
function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function record(path, entry) {
  writeAtomic(path, recordPush(readFileSync(path, "utf8"), entry));
}

function tick(path) {
  let md = touchUpdated(readFileSync(path, "utf8"), now());
  if (!flag("no-remote")) {
    for (const row of parseBranches(md)) {
      const cwd = existsSync(row.worktree) ? row.worktree : process.cwd();
      const head = (sh(["git", "ls-remote", "origin", `refs/heads/${row.branch}`], cwd) ?? "").split(/\s+/)[0];
      if (head) md = recordPush(md, { branch: row.branch, sha: head, at: now(), note: "(origin's head, seen by the hourly tick)" });
    }
  }
  writeAtomic(path, md);
}

const watchFile = () => resolve(sh(["git", "rev-parse", "--git-path", "lumen-lane-watch.json"]) ?? ".git/lumen-lane-watch.json");
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
};

function ensureWatch() {
  const cfg = laneConfig();
  let running = null;
  try {
    running = JSON.parse(readFileSync(watchFile(), "utf8"));
  } catch {
    running = null;
  }
  const plan = watchPlan(cfg, cfg ? stateFiles(cfg) : [], sh(["git", "rev-parse", "--abbrev-ref", "HEAD"]), (f) => readFileSync(f, "utf8"), running, isAlive);
  if (plan.action === "none") return 0;
  const every = Number(process.env.LUMEN_LANE_TICK_MIN ?? 60) > 0 ? String(Number(process.env.LUMEN_LANE_TICK_MIN ?? 60)) : "60";
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "watch", plan.file, "--every-min", every, ...(flag("no-remote") ? ["--no-remote"] : [])], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  writeAtomic(watchFile(), JSON.stringify({ pid: child.pid, file: plan.file, since: now() }));
  return 0;
}

function main() {
  if (cmd === "ensure-watch") return ensureWatch();
  if (cmd === "pending") {
    // pre-push: argv[1] is the remote's name. Nothing to note without a lane state.
    if (!laneConfig()) return 0;
    const remote = file ?? "origin";
    const keep = readPending().filter((p) => !pushedRefs(readStdinCache()).some((q) => q.branch === p.branch));
    const add = pushedRefs(readStdinCache()).map((p) => ({ ...p, remote }));
    const f = pendingFile();
    mkdirSync(dirname(f), { recursive: true });
    writeAtomic(f, JSON.stringify([...keep, ...add]));
    return 0;
  }
  if (cmd === "committed") {
    const cfg = laneConfig();
    const pending = readPending();
    if (!cfg || !pending.length) return 0;
    const input = readStdinCache();
    const remotes = [...new Set(pending.map((p) => p.remote ?? "origin"))];
    let left = pending;
    for (const remote of remotes) {
      const r = confirmedPushes(input, left, remote);
      left = r.pending;
      for (const c of r.confirmed) {
        const files = stateFiles(cfg);
        const target = cfg.file ? files[0] : stateFor(c.branch, files.map((p) => [p, readFileSync(p, "utf8")]));
        if (target) record(target, { ...c, at: now() });
      }
    }
    if (left.length) writeAtomic(pendingFile(), JSON.stringify(left));
    else rmSync(pendingFile(), { force: true });
    return 0;
  }
  if (cmd === "install-hook") {
    const state = opt("state");
    const dir = opt("state-dir");
    if (!state === !dir) {
      console.error("usage: node scripts/lane-state.mjs install-hook --state <STATE.md> | --state-dir <dir> [--force]");
      return 2;
    }
    const hooks = resolve(sh(["git", "rev-parse", "--git-path", "hooks"]) ?? ".git/hooks");
    mkdirSync(hooks, { recursive: true });
    const hook = join(hooks, "reference-transaction");
    const plan = txnHookPlan(existsSync(hook) ? readFileSync(hook, "utf8") : null, { force: flag("force") });
    if (plan.action === "refuse") {
      console.error(`lane-state: ${hook} exists and is not ours; not replacing it (--force saves it as reference-transaction.bak).`);
      return 1;
    }
    if (plan.action === "backup") renameSync(hook, `${hook}.bak`);
    writeFileSync(hook, plan.content);
    chmodSync(hook, 0o755);
    // The pre-push half too, unless a hook already notes the push (ci:local's does) or is someone else's.
    const pp = join(hooks, "pre-push");
    const pre = prePushPlan(existsSync(pp) ? readFileSync(pp, "utf8") : null);
    if (pre.action === "write") {
      writeFileSync(pp, pre.content);
      chmodSync(pp, 0o755);
    } else if (pre.action === "refuse") console.error(`lane-state: ${pp} is not ours and does not note pushes; add this line to it: ${PREPUSH_LINE}`);
    sh(["git", "config", state ? "lumen.laneState" : "lumen.laneStateDir", resolve(state ?? dir)]);
    console.log(`reference-transaction hook written to ${hook}; lane state: ${resolve(state ?? dir)}. The pre-push half: npm run ci:local -- --install-hook.`);
    return 0;
  }
  if (cmd === "record") {
    if (!file || !opt("branch") || !opt("sha")) {
      console.error("usage: node scripts/lane-state.mjs record <STATE.md> --branch <b> --sha <sha>");
      return 2;
    }
    record(file, { branch: opt("branch"), sha: opt("sha"), at: now(), note: "" });
    return 0;
  }
  if (cmd === "tick" || cmd === "watch") {
    if (!file || !existsSync(file)) {
      console.error(`usage: node scripts/lane-state.mjs ${cmd} <STATE.md> (an existing file)`);
      return 2;
    }
    const every = Number(opt("every-min") ?? 60);
    if (cmd === "watch" && !(every > 0)) {
      console.error("--every-min must be a positive number");
      return 2;
    }
    tick(file);
    if (cmd === "tick") return 0;
    console.log(`lane-state: ticking ${file} every ${every} min (Ctrl-C stops)`);
    const timer = setInterval(() => {
      // The lane's folder went away (the lane is over): stop, rather than tick forever.
      if (!existsSync(file)) return clearInterval(timer);
      try {
        tick(file);
      } catch (e) {
        console.error(`lane-state: tick failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, every * 60_000);
    return null;
  }
  if (!["resume", "table"].includes(cmd) || !file) {
    console.error("usage: node scripts/lane-state.mjs resume|table|tick|watch|record <STATE.md> | install-hook | ensure-watch");
    return 2;
  }
  const rows = parseBranches(readFileSync(file, "utf8"));
  if (!rows.length) {
    console.error(`${file}: no "## Branches" table (docs/dev/lane-state.md has the template)`);
    return 2;
  }
  if (cmd === "table") {
    console.log(renderBranches(rows.map((r) => ({ ...r, pushed: (sh(["git", "ls-remote", "origin", `refs/heads/${r.branch}`]) ?? "").split(/\s+/)[0].slice(0, 10) || null }))));
    return 0;
  }
  let bad = 0;
  for (const row of rows) {
    const { action, why } = resumeAction(row, facts(row));
    if (action === "look" || action === "record") bad++;
    console.log(`${action.padEnd(8)} ${row.branch}: ${why}`);
  }
  return bad ? 1 : 0;
}

let stdinText = null;
function readStdinCache() {
  if (stdinText == null) stdinText = readStdin();
  return stdinText;
}

const code = main();
if (code != null) process.exitCode = code;
