#!/usr/bin/env node
/**
 * Posts the pr:check report on the pull request (plan 0.19, W10.E25): the
 * part of Danger's job that Lumen still lacked. The `pr-check` Buildkite job
 * runs it on the host after pr:check, pass or fail, so every PR gets the
 * report without anyone pasting it.
 *
 *   node scripts/buildkite/pr-comment.mjs ci-out/pr-check.md
 *
 * One comment per PR: it carries MARKER, and a later build edits that comment
 * instead of adding another. Only a comment written by the token's own user
 * is edited (a marker in someone else's comment is left alone).
 *
 * Token: LUMEN_PR_COMMENT_TOKEN_FILE (a fine-grained token with "Pull
 * requests: write" on this repository, on the agent's host), else GH_TOKEN.
 * Without a token, or outside a PR build, it says so and exits 0: posting is
 * a convenience, the job's own status is the gate.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO } from "./lib.mjs";

export const MARKER = "<!-- lumen:pr-check (scripts/buildkite/pr-comment.mjs) -->";
/** GitHub's limit for a comment body is 65,536 characters. */
export const MAX_BODY = 65_000;

/** The comment's text: the marker, the report (cut to fit), and where it came from. */
export function commentBody(report, { buildUrl = null, sha = null } = {}) {
  const foot = `\n\n<sub>Posted by the Buildkite \`pr-check\` job${buildUrl ? ` ([build](${buildUrl}))` : ""}${sha ? ` for \`${sha.slice(0, 12)}\`` : ""}. It is edited on every build.</sub>`;
  let text = String(report).trim();
  const room = MAX_BODY - MARKER.length - foot.length - 2;
  const cut = "\n\n… (cut: the whole report is the job's artifact ci-out/pr-check.md)";
  if (text.length > room) text = `${text.slice(0, room - cut.length)}${cut}`;
  return `${MARKER}\n${text}${foot}`;
}

/**
 * What to do with the PR's comments: { action: "create" } or { action: "update", id }.
 * Only our own login's comment with the marker is updated.
 */
export function planComment(comments, login) {
  const ours = (comments ?? []).filter((c) => c?.user?.login === login && String(c.body ?? "").includes(MARKER));
  return ours.length ? { action: "update", id: ours[ours.length - 1].id } : { action: "create" };
}

function main() {
  const file = process.argv[2] ?? "ci-out/pr-check.md";
  const env = process.env;
  const log = (s) => console.log(`[pr-comment] ${s}`);
  const pr = env.BUILDKITE_PULL_REQUEST;
  if (!pr || pr === "false" || !/^\d+$/.test(pr)) return log("not a pull-request build: nothing to post");
  if (!existsSync(file)) return log(`✗ no report at ${file} (pr:check did not get as far as writing it); nothing posted`);
  const tokenFile = env.LUMEN_PR_COMMENT_TOKEN_FILE;
  const token = tokenFile && existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : env.GH_TOKEN;
  if (!token) return log("✗ no token (LUMEN_PR_COMMENT_TOKEN_FILE or GH_TOKEN): the report is the job's artifact only");
  const gh = (args, input) => spawnSync("gh", ["api", ...args], { encoding: "utf8", input, env: { ...env, GH_TOKEN: token } });
  const me = gh(["user", "--jq", ".login"]);
  if (me.status !== 0) return log(`✗ gh api user: ${(me.stderr || "").trim().slice(0, 200)}`);
  const list = gh(["--paginate", `repos/${REPO}/issues/${pr}/comments?per_page=100`, "--jq", ".[] | {id, body, user: {login: .user.login}}"]);
  if (list.status !== 0) return log(`✗ listing comments: ${(list.stderr || "").trim().slice(0, 200)}`);
  const comments = list.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const plan = planComment(comments, me.stdout.trim());
  const body = JSON.stringify({ body: commentBody(readFileSync(file, "utf8"), { buildUrl: env.BUILDKITE_BUILD_URL, sha: env.BUILDKITE_COMMIT }) });
  const r = plan.action === "update" ? gh(["-X", "PATCH", `repos/${REPO}/issues/comments/${plan.id}`, "--input", "-"], body) : gh(["-X", "POST", `repos/${REPO}/issues/${pr}/comments`, "--input", "-"], body);
  log(r.status === 0 ? `${plan.action === "update" ? "updated" : "posted"} the report on #${pr}` : `✗ ${plan.action}: ${(r.stderr || "").trim().slice(0, 200)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
