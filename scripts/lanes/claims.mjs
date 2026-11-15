#!/usr/bin/env node
/**
 * Task claims for parallel lanes (plan R12.13): a session claims a plan task
 * before it works on it; a second session sees the claim and picks another.
 * Claims live in the repository's common git directory (shared by every
 * worktree, never committed): <git-common-dir>/lumen-claims/<task>.json,
 * created with an exclusive create, so two sessions racing for one task
 * cannot both win.
 *
 *   node scripts/lanes/claims.mjs claim <task> [lane]   # exit 1 when taken
 *   node scripts/lanes/claims.mjs release <task> [lane]
 *   node scripts/lanes/claims.mjs list
 *
 * Clean reimplementation (design reference only: israelconnect's unit
 * claims, AGPL; no code taken).
 */
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function claimsDir(cwd = process.cwd()) {
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" }).trim();
  return join(resolve(cwd, common), "lumen-claims");
}

const fileOf = (dir, task) => {
  if (!/^[\p{L}\p{N}._-]+$/u.test(task)) throw new Error(`not a task id: ${task}`);
  return join(dir, `${task}.json`);
};

/** Claim `task` for `lane`: { ok: true } or { ok: false, by } when another lane holds it. Claiming again for the same lane is ok. */
export function claim(dir, task, lane, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const f = fileOf(dir, task);
  try {
    const fd = openSync(f, "wx");
    writeSync(fd, JSON.stringify({ task, lane, at: now.toISOString() }) + "\n");
    closeSync(fd);
    return { ok: true };
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const held = JSON.parse(readFileSync(f, "utf8"));
    return held.lane === lane ? { ok: true } : { ok: false, by: held.lane, at: held.at };
  }
}

export function release(dir, task, lane) {
  const f = fileOf(dir, task);
  try {
    const held = JSON.parse(readFileSync(f, "utf8"));
    if (lane && held.lane !== lane) return false;
    rmSync(f);
    return true;
  } catch {
    return false;
  }
}

export function listClaims(dir) {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")))
      .sort((a, b) => (a.task < b.task ? -1 : 1));
  } catch {
    return [];
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, task, laneArg] = process.argv.slice(2);
  const lane = laneArg ?? process.env.LUMEN_LANE ?? "";
  const dir = claimsDir();
  if (cmd === "claim" && task && lane) {
    const r = claim(dir, task, lane);
    if (!r.ok) console.error(`המשימה ${task} כבר נתבעה על ידי ${r.by} (${r.at}); בחרו משימה אחרת.\nTask ${task} is claimed by ${r.by}; pick another.`);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "release" && task) process.exit(release(dir, task, lane || undefined) ? 0 : 1);
  else if (cmd === "list") {
    for (const c of listClaims(dir)) console.log(`${c.task}\t${c.lane}\t${c.at}`);
    process.exit(0);
  } else {
    console.error("usage: claims.mjs claim <task> [lane] | release <task> [lane] | list");
    process.exit(2);
  }
}
