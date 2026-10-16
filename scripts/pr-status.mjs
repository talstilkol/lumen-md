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

const gh = (...a) => JSON.parse(execFileSync("gh", ["api", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
// owner/name from GH_REPO or the origin remote (no GraphQL needed).
const remote = process.env.GH_REPO || execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
const repo = remote.replace(/\.git$/, "").split(/[/:]/).slice(-2).join("/");
const [owner, name] = repo.split("/");

function checks(sha) {
  const runs = gh(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).check_runs;
  const failed = runs.filter((r) => ["failure", "timed_out", "cancelled", "action_required"].includes(r.conclusion)).map((r) => r.name);
  const pending = runs.filter((r) => r.status !== "completed").map((r) => r.name);
  const state = failed.length ? "fail" : pending.length ? "pending" : runs.length ? "green" : "none";
  return { state, failed, pending };
}

let graphqlOk = true;
function threads(n) {
  if (graphqlOk) try {
    const q = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved path comments(first:1){nodes{body}}}}}}}`;
    const res = gh("graphql", "-f", `query=${q}`, "-f", `o=${owner}`, "-f", `r=${name}`, "-F", `n=${n}`);
    return res.data.repository.pullRequest.reviewThreads.nodes
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

const prs = gh(`repos/${repo}/pulls?state=open&per_page=100`).filter((p) => !only.length || only.includes(p.number));
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
