#!/usr/bin/env node
/**
 * `npm run review:coverage` (plan W6.11 acceptance: "100% of the sensitive
 * PRs in trains 2 and 3 have a review receipt on the head"). For an
 * integration train, every PR merged into it (first-parent merge commits
 * "Merge #N …") and the train's own integration commits:
 *
 *   - which sensitive files (.github/CODEOWNERS of the train) each changed;
 *   - whether a receipt counts for the head that the train merged (the
 *     merge's second parent), under the same rules as pr:check
 *     (scripts/lib/independentReview.mjs);
 *   - the train's own commits in sensitive files need a receipt for the
 *     train's head (`--train-pr <n>` reads the train PR's comments; without
 *     it no receipt can be bound to a PR, so the own commits don't count).
 *   - T6-H1/L3: the reviewer keys come from each change's merge base (never
 *     from the train or the PR), and the same author and committer exclusion
 *     as pr:check applies: the PR's author (with --live) and everyone who
 *     wrote or committed a commit it merged.
 *
 * Receipts come from PR comments (`--live`, through `gh api`, REST) and/or
 * a folder of receipt files (`--receipts <dir>`, any *.json holding one
 * receipt or a list). Exit 1 below 100%.
 *
 *   node scripts/review-coverage.mjs --train origin/verify/train-2 --base origin/main --receipts ../receipts
 *   node scripts/review-coverage.mjs --train origin/verify/train-2 --base origin/main --live --train-pr 495 --out coverage.md
 *   … --codeowners <file>   (a train without .github/CODEOWNERS yet: use #481's)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCodeowners, sensitiveChanges } from "./lib/humanReview.mjs";
import { commentReceipts, excludedIdentities, independentReviewVerdict, parseReviewers } from "./lib/independentReview.mjs";

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** PR numbers a merge subject names: "Merge #472 …", "Merge #491 + #494 …" (not "with the fixed #399"). */
export function prsOfSubject(subject) {
  const m = /^Merge ((?:#\d+(?:\s*\+\s*)?)+)/.exec(subject);
  return m ? [...m[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1])) : [];
}

/** Receipt files in `dir` → [{ source, receipt }]. */
export function receiptFiles(dir) {
  const out = [];
  if (!dir || !existsSync(dir)) return out;
  for (const n of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(dir, n), "utf8"));
    } catch (e) {
      out.push({ source: `\`${n}\``, receipt: { error: `cannot read ${n} as JSON (${e.message})` } });
      continue;
    }
    for (const receipt of Array.isArray(doc) ? doc : [doc]) out.push({ source: `\`${n}\``, receipt });
  }
  return out;
}

/** Authors and committers of the commits in `range` (git names and emails), as excludedIdentities takes them. */
function commitsOf(cwd, ...range) {
  return git(cwd, "log", "--format=%an%x1f%ae%x1f%cn%x1f%ce", ...range)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [authorName, authorEmail, committerName, committerEmail] = l.split("\x1f");
      return { authorName, authorEmail, committerName, committerEmail };
    });
}

/**
 * What the train holds, from git alone:
 * → { head, base, commits, prs: [{ number, merge, head, base, commits, files }], own: [{ sha, subject, files }] }
 *   (`base`: the merge base the change was made against; `commits`: who wrote and committed it)
 */
export function trainContents(cwd, train, base) {
  const head = git(cwd, "rev-parse", train).trim();
  const prs = [];
  const own = [];
  const seen = new Set();
  // A train merged into a train ("Merge origin/verify/train into verify/train-2"): walk its first parent too.
  const walk = (...range) => {
    const lines = git(cwd, "log", "--first-parent", "--format=%H%x09%P%x09%s", ...range).split("\n").filter(Boolean);
    for (const line of lines) {
      const [sha, parents, subject] = line.split("\t");
      if (seen.has(sha)) continue;
      seen.add(sha);
      const ps = parents.split(" ");
      const files = git(cwd, "diff", "--name-only", ps[0], sha).split("\n").filter(Boolean);
      const numbers = ps.length > 1 ? prsOfSubject(subject) : [];
      if (numbers.length) {
        const mb = git(cwd, "merge-base", ps[0], ps[1]).trim();
        const commits = commitsOf(cwd, `${mb}..${ps[1]}`);
        for (const number of numbers) if (!prs.some((p) => p.number === number)) prs.push({ number, merge: sha, head: ps[1], base: mb, commits, files });
      } else if (ps.length === 1) own.push({ sha, subject, files });
      else if (/verify\//.test(subject)) walk(`^${base}`, `^${ps[0]}`, ps[1]);
    }
  };
  walk(`${base}..${train}`);
  const trainBase = git(cwd, "merge-base", base, train).trim();
  const commits = commitsOf(cwd, "--no-merges", `${trainBase}..${train}`);
  return { head, base: trainBase, commits, prs, own };
}

/**
 * The coverage table.
 *   contents: trainContents(...)
 *   entries: parseCodeowners(train's CODEOWNERS)
 *   receiptsFor(number) → [{ source, receipt, rejected? }] (comments of PR `number`, plus files whose receipt names it)
 *   files: receiptFiles(...) (matched to a PR by `pr` or by `head`)
 *   registryAt(sha) → parseReviewers(...) of security/reviewers.json at that commit, or null (default: `reviewers` for every sha)
 *   prAuthorOf(number) → the PR author's GitHub login, or null
 * → { rows: [{ what, head, sensitive, status, line }], sensitiveCount, covered, percent }
 */
export function coverageOf(contents, entries, { receiptsFor = () => [], files = [], reviewers = null, registryAt = () => reviewers, prAuthorOf = () => null, trainPr = null } = {}) {
  const rows = [];
  const pick = (number, head) => [...receiptsFor(number), ...files.filter((f) => f.receipt && (f.receipt.pr === number || f.receipt.head === head))];
  for (const p of contents.prs) {
    const sensitive = sensitiveChanges(p.files, entries);
    if (!sensitive.length) continue;
    const excluded = excludedIdentities({ prAuthor: prAuthorOf(p.number), commits: p.commits ?? [] });
    const v = independentReviewVerdict(sensitive, pick(p.number, p.head), { head: p.head, strict: true, reviewers: registryAt(p.base), excluded, pr: p.number, base: p.base });
    rows.push({ what: `#${p.number}`, head: p.head, sensitive: sensitive.length, status: v.status, line: v.lines[0] });
  }
  const ownSensitive = [...new Set(contents.own.flatMap((c) => sensitiveChanges(c.files, entries).map((s) => s.file)))].map((file) => ({ file, pattern: "" }));
  if (ownSensitive.length) {
    const excluded = excludedIdentities({ prAuthor: trainPr ? prAuthorOf(trainPr) : null, commits: contents.commits ?? [] });
    const v = independentReviewVerdict(ownSensitive, trainPr ? pick(trainPr, contents.head) : files.filter((f) => f.receipt?.head === contents.head), { head: contents.head, strict: true, reviewers: registryAt(contents.base), excluded, pr: trainPr, base: contents.base });
    rows.push({ what: `train's own commits${trainPr ? ` (#${trainPr})` : ""}`, head: contents.head, sensitive: ownSensitive.length, status: v.status, line: v.lines[0] });
  }
  const covered = rows.filter((r) => r.status === "ok").length;
  return { rows, sensitiveCount: rows.length, covered, percent: rows.length ? Math.round((1000 * covered) / rows.length) / 10 : 100 };
}

export function coverageMarkdown(c, train) {
  return [
    `## Independent review coverage of \`${train}\` (plan W6.11)`,
    "",
    `${c.covered} of ${c.sensitiveCount} sensitive change sets have a receipt that counts for the head the train holds: **${c.percent}%**.`,
    "",
    "| Change | Head | Sensitive files | Receipt |",
    "|---|---|---|---|",
    ...c.rows.map((r) => `| ${r.what} | \`${r.head.slice(0, 9)}\` | ${r.sensitive} | ${r.status === "ok" ? "✅" : "❌"} ${r.line.replace(/\|/g, "\\|")} |`),
  ].join("\n");
}

const ghJson = (args) => JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));

function main(argv) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const cwd = resolve(opt("--cwd") ?? process.cwd());
  const train = opt("--train");
  const base = opt("--base") ?? "origin/main";
  if (!train) {
    console.error("usage: review-coverage.mjs --train <ref> [--base <ref>] [--codeowners <file>] [--receipts <dir>] [--live --repo owner/name] [--train-pr <n>] [--out <file>]");
    return 2;
  }
  const contents = trainContents(cwd, train, base);
  // The train's CODEOWNERS, or --codeowners <file> for a train that doesn't carry one yet.
  const entries = parseCodeowners(opt("--codeowners") ? readFileSync(opt("--codeowners"), "utf8") : git(cwd, "show", `${contents.head}:.github/CODEOWNERS`));
  // T6-H1: each change's keys come from its own merge base, never from the train head.
  const registries = new Map();
  const registryAt = (sha) => {
    if (!registries.has(sha)) {
      let reg = null;
      try {
        reg = parseReviewers(git(cwd, "show", `${sha}:security/reviewers.json`));
      } catch {
        reg = null; // why: no registry at that commit, so no receipt counts for the change
      }
      registries.set(sha, reg);
    }
    return registries.get(sha);
  };
  const repo = opt("--repo") ?? "talstilkol/lumen-md";
  const prAuthorOf = argv.includes("--live") ? (n) => ghJson([`repos/${repo}/pulls/${n}`]).user?.login ?? null : () => null;
  const receiptsFor = argv.includes("--live")
    ? (n) => commentReceipts(ghJson(["--paginate", `repos/${repo}/issues/${n}/comments?per_page=100`]).map((c) => ({ id: c.id, user: c.user?.login, association: c.author_association, body: c.body ?? "" })))
    : () => [];
  const c = coverageOf(contents, entries, { receiptsFor, files: receiptFiles(opt("--receipts")), registryAt, prAuthorOf, trainPr: opt("--train-pr") ? Number(opt("--train-pr")) : null });
  const md = coverageMarkdown(c, train);
  console.log(md);
  if (opt("--out")) writeFileSync(opt("--out"), md + "\n");
  return c.covered === c.sensitiveCount ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
