#!/usr/bin/env node
/**
 * One table of every open PR: CI state on its head commit, unresolved
 * review threads, and whether it's ready to merge (green CI, no open
 * threads, not a draft). REST only, through the `gh` CLI.
 *
 * Usage:
 *   node scripts/pr-status.mjs            # all open PRs
 *   node scripts/pr-status.mjs 107 110    # just these
 *   node scripts/pr-status.mjs --threads  # also print each open thread
 *
 * Review threads come from GitHub's GraphQL API when available, otherwise
 * from the review-thread REST route some environments proxy
 * (`pulls/N/ccr/review_threads`); if neither answers, that column is "?".
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const showThreads = args.includes("--threads");
const only = args.filter((a) => /^\d+$/.test(a)).map(Number);

const run = (a) => execFileSync("gh", ["api", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
const gh = (...a) => JSON.parse(run(a));
/** Every page, one JSON value per `jq` output line. */
const ghAll = (jq, ...a) =>
  run(["--paginate", "--jq", jq, ...a])
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
// owner/name from GH_REPO or the origin remote (no GraphQL needed).
const remote = process.env.GH_REPO || execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
const repo = remote.replace(/\.git$/, "").split(/[/:]/).slice(-2).join("/");
const [owner, name] = repo.split("/");

/** Conclusions that count as passing; anything else completed (failure, stale, cancelled…) doesn't. */
const PASSING = new Set(["success", "neutral", "skipped"]);

function checks(sha) {
  const all = ghAll(".check_runs[]", `repos/${repo}/commits/${sha}/check-runs?per_page=100`);
  // A re-run creates a new run with the same name: only the latest counts.
  const latest = new Map();
  for (const r of all) {
    const prev = latest.get(r.name);
    if (!prev || r.id > prev.id) latest.set(r.name, r);
  }
  const runs = [...latest.values()];
  const pending = runs.filter((r) => r.status !== "completed").map((r) => r.name);
  const failed = runs.filter((r) => r.status === "completed" && !PASSING.has(r.conclusion)).map((r) => `${r.name} (${r.conclusion})`);
  const state = failed.length ? "fail" : pending.length ? "pending" : runs.length ? "green" : "none";
  return { state, failed, pending };
}

let graphqlOk = true;
function threads(n) {
  if (graphqlOk) try {
    // Every page (gh fills $endCursor from pageInfo).
    const q = `query($o:String!,$r:String!,$n:Int!,$endCursor:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{isResolved path comments(first:1){nodes{body}}}}}}}`;
    return ghAll(".data.repository.pullRequest.reviewThreads.nodes[]", "graphql", "-f", `query=${q}`, "-f", `o=${owner}`, "-f", `r=${name}`, "-F", `n=${n}`)
      .filter((t) => !t.isResolved)
      .map((t) => ({ path: t.path, body: t.comments.nodes[0]?.body ?? "" }));
  } catch {
    graphqlOk = false; // unavailable here: use the REST route from now on
  }
  try {
    return gh(`repos/${repo}/pulls/${n}/ccr/review_threads`)
      .filter((t) => !t.resolved)
      .map((t) => {
        let body = "";
        if (showThreads && t.comment_ids?.[0]) {
          try {
            body = gh(`repos/${repo}/pulls/comments/${t.comment_ids[0]}`).body ?? "";
          } catch {
            /* comment unavailable */
          }
        }
        return { path: t.path, body, id: t.comment_ids?.[0] };
      });
  } catch {
    return null;
  }
}

// Requested numbers are fetched directly; otherwise every page of open PRs.
const prs = only.length
  ? only.map((n) => gh(`repos/${repo}/pulls/${n}`)).filter((p) => p.state === "open")
  : ghAll(".[]", `repos/${repo}/pulls?state=open&per_page=100`);
const rows = [];
for (const p of prs) {
  const c = checks(p.head.sha);
  const open = threads(p.number);
  const ready = !p.draft && c.state === "green" && open?.length === 0;
  rows.push({ p, c, open, ready });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("#", 6)}${pad("CI", 9)}${pad("threads", 9)}${pad("merge?", 8)}title`);
for (const { p, c, open, ready } of rows) {
  const t = open === null ? "?" : open.length;
  const verdict = p.draft ? "draft" : ready ? "yes" : "no";
  console.log(`${pad(p.number, 6)}${pad(c.state, 9)}${pad(t, 9)}${pad(verdict, 8)}${p.title}`);
  if (c.failed.length) console.log(`      failed: ${c.failed.join(", ")}`);
  if (showThreads && open?.length) {
    for (const th of open) {
      // First prose line (skipping badges / HTML) as the thread's title.
      const title = th.body.split("\n").map((l) => l.replace(/<[^>]+>|!\[[^\]]*\]\([^)]*\)|\*\*/g, "").trim()).find(Boolean);
      console.log(`      • ${th.path}${th.id ? ` (#${th.id})` : ""}${title ? ` — ${title.slice(0, 120)}` : ""}`);
    }
  }
}
