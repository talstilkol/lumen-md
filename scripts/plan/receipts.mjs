#!/usr/bin/env node
/**
 * `npm run plan:receipts` (plan W10.G9, W6.7): compute every task's and PR's
 * verification level from the receipts that exist, and write
 * plan/verified-receipts.json. scripts/plan/build.mjs reads that file:
 * plan:check refuses `verified: "real"` without a receipt that proves it, and
 * counts the levels the receipts don't back ("manual"); with --strict-receipts
 * every such level fails. The rules are in ./receiptLevels.mjs. It never
 * edits plan/plan.json and never makes or signs a receipt.
 *
 *   node scripts/plan/receipts.mjs [--receipts <clone of the factory receipts repo>] [--nightly reports/nightly]
 *        [--vercel <dir of /__build/receipt.json files>] [--reviews <dir of lumen-review files>]
 *        [--pin <fingerprint,…>] [--gh] [--pr-heads <file.json>] [--out plan/verified-receipts.json]
 *
 *   trusted keys   <receipts>/keys/*.pem and <nightly>/PUBLIC_KEY.pem (--pin keeps only those fingerprints)
 *   --gh           PR heads and bases, the PR's author, its review comments (author_association) and
 *                  GitHub's Vercel status, through `gh api` (REST). Without it --pr-heads gives
 *                  { "<pr>": "<head sha>" } or { "<pr>": { "head", "base" } }, and Vercel receipts don't count.
 *   reviews        counted under pr:check's rules: signed with the key security/reviewers.json lists at
 *                  the PR's merge base, not by the PR's author or a committer in its range, for this PR,
 *                  base and head, covering its sensitive files (.github/CODEOWNERS at the head)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commentReceipts, excludedIdentities, parseReviewers } from "../lib/independentReview.mjs";
import { parseCodeowners, sensitiveChanges } from "../lib/humanReview.mjs";
import { LEVELS, RECEIPTS_FILE, byPhase, computeLevels, evidenceOf, fingerprint, reviewOf, verifySealed } from "./receiptLevels.mjs";

const REPO = "talstilkol/lumen-md";

function walkJson(dir) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  const go = (d) => {
    for (const f of readdirSync(d).sort()) {
      if (f === ".git" || f === "node_modules") continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) go(p);
      else if (f.endsWith(".json")) out.push(p);
    }
  };
  go(dir);
  return out;
}
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null; // why: not JSON, so not a receipt
  }
};
const gh = (path) => {
  const r = spawnSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 64 << 20 });
  return r.status === 0 ? JSON.parse(r.stdout) : null;
};
const git = (...a) => {
  const r = spawnSync("git", a, { encoding: "utf8", maxBuffer: 256 << 20 });
  return r.status === 0 ? r.stdout : null;
};
const hasCommit = (sha) => spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`]).status === 0;
/** Does `commit` contain `head`? null when an object is missing (never guessed). */
const contains = (head, commit) => (hasCommit(head) && hasCommit(commit) ? spawnSync("git", ["merge-base", "--is-ancestor", head, commit]).status === 0 : null);

/** What the review gate needs to know about one PR, from git: its sensitive files, the registry at its base, who wrote it. */
function reviewContext(number, head, base, prAuthor) {
  if (!head || !base || !hasCommit(head) || !hasCommit(base)) return null;
  const mb = git("merge-base", base, head)?.trim();
  if (!mb) return null;
  const files = (git("diff", "--name-only", mb, head) ?? "").split("\n").filter(Boolean);
  const owners = git("show", `${head}:.github/CODEOWNERS`);
  const registry = git("show", `${mb}:security/reviewers.json`);
  const commits = (git("log", "--format=%an%x1f%ae%x1f%cn%x1f%ce", `${mb}..${head}`) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [authorName, authorEmail, committerName, committerEmail] = l.split("\x1f");
      return { authorName, authorEmail, committerName, committerEmail };
    });
  return {
    number,
    head,
    base: mb,
    sensitive: owners ? sensitiveChanges(files, parseCodeowners(owners)) : files.map((file) => ({ file, pattern: "" })),
    reviewers: registry ? parseReviewers(registry) : null,
    excluded: excludedIdentities({ prAuthor, commits }),
  };
}

function main(argv) {
  const opt = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const plan = JSON.parse(readFileSync(join(root, "plan/plan.json"), "utf8"));
  const tasks = plan.phases.flatMap((p, phase) => p.tasks.map((t) => ({ id: t.id, pr: t.pr, claimed: t.verified, phase })));
  const useGh = argv.includes("--gh");

  const pins = opt("pin")?.split(",").filter(Boolean) ?? null;
  const keys = new Map();
  const pems = [];
  const receiptsDir = opt("receipts");
  if (receiptsDir && existsSync(join(receiptsDir, "keys"))) for (const x of readdirSync(join(receiptsDir, "keys"))) if (x.endsWith(".pem")) pems.push(join(receiptsDir, "keys", x));
  if (opt("nightly") && existsSync(join(opt("nightly"), "PUBLIC_KEY.pem"))) pems.push(join(opt("nightly"), "PUBLIC_KEY.pem"));
  for (const f of pems) {
    const pem = readFileSync(f, "utf8");
    const fp = fingerprint(pem);
    if (!pins || pins.includes(fp)) keys.set(fp, pem);
  }

  const evidence = [];
  const rejected = [];
  const reviewFiles = [];
  const vercelOk = new Map();
  for (const f of [...walkJson(receiptsDir), ...walkJson(opt("nightly")), ...walkJson(opt("vercel")), ...walkJson(opt("reviews"))]) {
    const r = readJson(f);
    if (!r || typeof r !== "object") continue;
    const source = relative(process.cwd(), f);
    for (const x of Array.isArray(r) ? r : [r]) {
      if (x?.format === "lumen-review") {
        reviewFiles.push({ source, receipt: x });
        continue;
      }
      if (x?.receipt) {
        const v = verifySealed(x, keys);
        if (!v.ok) rejected.push({ source, why: v.problems.join("; ") });
        else {
          const e = evidenceOf(x);
          if (e) evidence.push({ ...e, source });
        }
        continue;
      }
      if (Array.isArray(x?.gates) && x.sha) {
        if (!vercelOk.has(x.sha)) vercelOk.set(x.sha, useGh ? (gh(`repos/${REPO}/commits/${x.sha}/status`)?.statuses ?? []).some((s) => s.context === "Vercel" && s.state === "success") : false);
        const e = vercelOk.get(x.sha) ? evidenceOf(x) : null;
        if (e) evidence.push({ ...e, source });
        else rejected.push({ source, why: useGh ? "GitHub's Vercel status for this commit is not success" : "a Vercel receipt counts only with --gh (its Vercel status is checked)" });
      }
    }
  }

  const given = opt("pr-heads") ? readJson(opt("pr-heads")) ?? {} : {};
  const heads = {};
  const bases = {};
  const authors = {};
  const comments = {};
  for (const [pr, v] of Object.entries(given)) {
    heads[pr] = typeof v === "string" ? v : v?.head;
    if (v?.base) bases[pr] = v.base;
  }
  if (useGh) {
    for (const pr of [...new Set(tasks.map((t) => t.pr).filter(Boolean))]) {
      const p = gh(`repos/${REPO}/pulls/${pr}`);
      if (p?.head?.sha) heads[String(pr)] ??= p.head.sha;
      if (p?.base?.sha) bases[String(pr)] ??= p.base.sha;
      authors[String(pr)] = p?.user?.login ?? null;
      const cs = gh(`repos/${REPO}/issues/${pr}/comments?per_page=100`) ?? [];
      comments[String(pr)] = commentReceipts(cs.map((c) => ({ id: c.id, user: c.user?.login, association: c.author_association, body: c.body ?? "" })));
    }
  }
  const reviews = {};
  for (const pr of [...new Set(tasks.map((t) => t.pr).filter(Boolean))].map(String)) {
    const mine = [...(comments[pr] ?? []), ...reviewFiles.filter((f) => String(f.receipt.pr) === pr)];
    if (!mine.length) continue;
    const ctx = reviewContext(Number(pr), heads[pr], bases[pr], authors[pr] ?? null);
    reviews[pr] = ctx ? reviewOf(ctx, mine) : { status: "rejected", why: [`the PR's head or base is unknown here, so its ${mine.length} receipt(s) can't be checked`] };
  }

  const result = computeLevels({ tasks, heads, evidence, contains, reviews });
  const out = {
    version: 2,
    generatedAt: new Date().toISOString(),
    sources: { evidence: evidence.length, reviews: Object.values(reviews).filter((r) => r.status === "signed").length, rejected, trustedKeys: [...keys.keys()], pinned: Boolean(pins), unknownAncestry: result.unknown },
    counts: result.counts,
    byPhase: byPhase(result.tasks, plan.phases.map((p) => p.title)),
    prs: Object.fromEntries(Object.entries(result.prs).map(([pr, p]) => [pr, { ...p, ...(reviews[pr]?.why ? { reviewWhy: reviews[pr].why } : {}) }])),
    tasks: result.tasks,
  };
  const file = resolve(opt("out") ?? join(root, RECEIPTS_FILE));
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  const c = out.counts.computed;
  console.log(`receipts: ${evidence.length} counted, ${rejected.length} rejected, ${out.sources.reviews} signed reviews · computed: ${LEVELS.map((k) => `${k} ${c[k]}`).join(", ")}, none ${c.none}; ${out.counts.manual} level(s) claimed above what the receipts prove → ${relative(process.cwd(), file)}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
