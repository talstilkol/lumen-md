#!/usr/bin/env node
/**
 * `npm run p2:ledger` (plan W10.G10, W1.32): the P2 ledger, regenerable.
 * plan/p2-ledger.json is the record; plan/p2-ledger.md is written from it.
 * The rules are in ./lib/p2Ledger.mjs.
 *
 *   node scripts/p2-ledger.mjs                 write plan/p2-ledger.md from plan/p2-ledger.json
 *   node scripts/p2-ledger.mjs --check         exit 1 when the JSON is invalid, a fixed entry's commit
 *                                              is not in HEAD, or the .md is out of date
 *        … --fetch                             also: every top-level P2 review comment on the PRs
 *                                              (gh api REST, paginated) is an entry, and no entry is
 *                                              unknown to GitHub ("100% mapped")
 *        … --strict                            also: no entry is open ("0 P2 without a decision")
 *   node scripts/p2-ledger.mjs --import-md     (once) plan/p2-ledger.json from the hand-written .md
 *
 * It never posts to GitHub: --fetch only reads.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ledgerCounts, ledgerProblems, mapping, parseLedgerMd, renderLedgerMd } from "./lib/p2Ledger.mjs";

const args = process.argv.slice(2);
const root = args.includes("--root") ? args[args.indexOf("--root") + 1] : ".";
const JSON_PATH = join(root, "plan/p2-ledger.json");
const MD_PATH = join(root, "plan/p2-ledger.md");
const REPO = "talstilkol/lumen-md";

if (args.includes("--import-md")) {
  const md = readFileSync(MD_PATH, "utf8");
  const lines = md.split("\n");
  const ledger = {
    $comment: "Plan W10.G10: one entry per top-level Codex review comment that mentions P2 on the W1.32 PRs. Edit this file, then run `npm run p2:ledger`; `npm run p2:ledger -- --check --fetch` checks it against GitHub (REST).",
    title: lines[0].replace(/^# /, ""),
    intro: lines[2],
    method: lines[6],
    prs: [...new Set(parseLedgerMd(md).map((e) => e.pr))].sort((a, b) => a - b),
    entries: parseLedgerMd(md),
  };
  writeFileSync(JSON_PATH, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`p2-ledger: ${ledger.entries.length} entries from ${MD_PATH} → ${JSON_PATH}`);
  process.exit(0);
}

const ledger = JSON.parse(readFileSync(JSON_PATH, "utf8"));
const md = renderLedgerMd(ledger);
const c = ledgerCounts(ledger);
const summary = `${c.total} comments: fixed ${c.fixed} · accepted risk ${c.accepted} · superseded ${c.superseded} · open ${c.open}`;

if (!args.includes("--check")) {
  const problems = ledgerProblems(ledger);
  for (const p of problems) console.error(`✖ ${p}`);
  if (problems.length) process.exit(1);
  writeFileSync(MD_PATH, md);
  console.log(`p2-ledger: ${summary} → ${MD_PATH}`);
  process.exit(0);
}

const isCommit = (sha) => spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", sha, "HEAD"]).status === 0;
const problems = ledgerProblems(ledger, { isCommit });
if (!existsSync(MD_PATH) || readFileSync(MD_PATH, "utf8") !== md) problems.push(`${MD_PATH} is out of date: run node scripts/p2-ledger.mjs`);
if (args.includes("--fetch")) {
  const comments = [];
  for (const pr of ledger.prs) {
    const r = spawnSync("gh", ["api", "--paginate", `repos/${REPO}/pulls/${pr}/comments?per_page=100`, "--jq", ".[] | {id, body, in_reply_to_id, pull_request_url}"], { encoding: "utf8", maxBuffer: 64 << 20 });
    if (r.status !== 0) {
      problems.push(`gh api repos/${REPO}/pulls/${pr}/comments failed: ${(r.stderr || "").trim().split("\n")[0]}`);
      continue;
    }
    // --jq prints one comment per line, across every page.
    for (const line of r.stdout.split("\n").filter((s) => s.trim())) comments.push(JSON.parse(line));
  }
  const { missing, unknown } = mapping(ledger, comments);
  for (const m of missing) problems.push(`#${m.pr} ${m.id}: a P2 comment with no entry ("${m.title}")`);
  for (const id of unknown) problems.push(`${id}: an entry GitHub has no top-level P2 comment for`);
  if (!missing.length && !unknown.length && comments.length) console.log(`p2-ledger: 100% mapped (${c.total} of ${c.total} P2 comments on ${ledger.prs.length} PRs, from GitHub)`);
}
if (args.includes("--strict") && c.open) problems.push(`${c.open} P2 comment(s) without a decision`);
for (const p of problems) console.error(`✖ ${p}`);
if (problems.length) process.exit(1);
console.log(`✓ p2-ledger: ${summary}; every fixed commit is in HEAD; ${MD_PATH} current`);
