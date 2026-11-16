#!/usr/bin/env node
/**
 * `npm run pr:check` (plan 0.19): the PR gate, run locally. It replaces
 * Danger.js and size-limit, which need GitHub Actions; this repo runs none
 * on a PR. One Markdown report (paste it into the PR, or --out a file):
 *
 *   - Bundle size: `bundle-budget.mjs --json` of this build against the
 *     base's, as a table (scripts/bundle-diff.mjs), plus the budget's own
 *     verdict. The base's sizes come from --base-sizes, or --build-base
 *     builds the merge base in a temporary worktree.
 *   - Commits: every subject in base..HEAD carries [skip ci].
 *   - PR body (--body FILE): every required section, none empty.
 *   - New network calls must be in the privacy ledger
 *     (src/ai/privacyLedger.ts) or carry `// privacy-ledger: <rule>`.
 *   - Production packages added or changed, with their licence.
 *   - Source changed with no test changed (a warning).
 *   - A snapshot changed with nothing that produces it (a hand edit, W10.D20).
 *   - Added lines that name the project's domain (the owner's rule).
 *   - The max-lines gate has no baseline (plan W6.25, W10.E31): a diff that brings one back fails.
 *   - Written by an AI agent → the PR wants the `ai-written` label.
 *   - Sensitive paths (.github/CODEOWNERS) changed → a person reviews and
 *     adds the `human-reviewed` label (plan W4.28). With `--pr <n>` the
 *     label is read from GitHub and must be newer than the last commit;
 *     without it the rule only warns.
 *   - The same paths need an independent review receipt for the head
 *     commit (plan W6.11): a `lumen-review` block in a PR comment (read with
 *     `--pr`) or a JSON file (`--review <file>`, repeatable), by a reviewer
 *     that is not the author, with attack tests and no critical or high
 *     finding open. A new push makes older receipts stale. The receipt names
 *     the PR, its merge base and its head; it is signed with a key from the
 *     merge base's security/reviewers.json (never the PR's own copy, T6-H1),
 *     and CODEOWNERS is the union of the base's and the PR's.
 *   - Budgets only go down (plan W6.26): no bundle budget, startup budget,
 *     exception date, perf-gate FCP/LCP limit or Lighthouse assertion loosened.
 *   - No stacks (plan W6.22): the base is the current train (the highest
 *     verify/train-N) or main. An older verify/* base warns; any other base
 *     fails, and so does a stack deeper than 1, worked out through the chain
 *     of open PRs' bases (`--pr` reads them from GitHub, `--prs <file>`
 *     takes them as JSON offline). Commits behind the base warn; a merge
 *     base older than 7 days, or a criss-cross, fails.
 *   - Every sensitive file the PR adds or changes has an owner in
 *     CODEOWNERS or a dated exception (plan W8.6; sensitive is worked out
 *     from the code: scripts/lib/sensitivePaths.mjs). When the PR changes
 *     CODEOWNERS or the exceptions, the whole tree is checked.
 *
 *   npm run pr:check -- --base origin/main --body pr-body.md
 *   npm run build && npm run pr:check -- --base origin/main --body pr-body.md --build-base --out pr-check.md
 *   npm run pr:check -- --base origin/main --pr 123 --no-size     # before merging
 *   npm run pr:check -- --base origin/verify/train-2 --review review.json --no-size   # offline
 *
 * Exit 1 when a check fails; warnings do not fail.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LABELS, labelProblems } from "./privacy/store-labels.mjs";
import { ledgerRoutes, unknownRecorders } from "./privacy/ledgerRoutes.mjs";
import { addedLinesFromDiff, AI_LABEL, bodyProblems, domainMentions, handEditedSnapshots, licenceChanges, skipCiViolations, unregisteredNetworkCalls, untestedChanges, writtenByAi } from "./lib/prGate.mjs";
import { bundleDiffMarkdown } from "./bundle-diff.mjs";
import { RETIRED_BASELINE_PATH } from "./lib/maxLines.mjs";
import { HUMAN_REVIEW_LABEL, humanReviewVerdict, independentPatterns, parseCodeowners, sensitiveChanges } from "./lib/humanReview.mjs";
import { commentReceipts, excludedIdentities, independentReviewVerdict, parseReviewers } from "./lib/independentReview.mjs";
import { check as auditLockCheck, readVersions } from "./audit-lock.mjs";
import { RATCHET_FILES, raiseLine, raisesFor } from "./lib/budgetRatchet.mjs";
import { MAX_AGE_DAYS, baseVerdict, branchName, currentTrain, depthVerdict, driftVerdicts, isRoot, stackDepth, worst } from "./lib/trainBase.mjs";
import { EXCEPTIONS_FILE } from "./lib/sensitivePaths.mjs";
import { coverageLines, treeCoverage } from "./codeowners-coverage.mjs";

export function parseArgs(argv) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  return {
    base: opt("--base") ?? "origin/main",
    body: opt("--body"),
    out: opt("--out"),
    baseSizes: opt("--base-sizes"),
    headSizes: opt("--head-sizes"),
    buildBase: argv.includes("--build-base"),
    train: opt("--train"),
    maxAgeDays: opt("--max-age-days") != null ? Number(opt("--max-age-days")) : MAX_AGE_DAYS,
    now: opt("--now") != null ? Date.parse(opt("--now")) : Date.now(),
    noSize: argv.includes("--no-size"),
    pr: opt("--pr"),
    prs: opt("--prs"),
    review: argv.flatMap((a, i) => (a === "--review" && argv[i + 1] ? [argv[i + 1]] : [])),
    repo: opt("--repo"),
    cwd: resolve(opt("--cwd") ?? process.cwd()),
  };
}

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** `bundle-budget.mjs --json` in `dir` (which must hold dist/) → { sizes, budgetOk }. */
function budget(dir, script) {
  const tmp = mkdtempSync(join(tmpdir(), "lumen-sizes-"));
  try {
    const f = join(tmp, "sizes.json");
    const r = spawnSync(process.execPath, [script, "--json", f], { cwd: dir, encoding: "utf8" });
    if (!existsSync(f)) throw new Error(`bundle-budget wrote no sizes in ${dir} (is dist/ built?): ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
    return { sizes: JSON.parse(readFileSync(f, "utf8")), budgetOk: r.status === 0, budgetLog: r.stdout };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Build the merge base in a temporary worktree (this checkout's node_modules linked in) → its sizes. */
function buildBase(cwd, mergeBase) {
  const dir = mkdtempSync(join(tmpdir(), "lumen-base-"));
  try {
    git(cwd, "worktree", "add", "--detach", dir, mergeBase);
    symlinkSync(join(cwd, "node_modules"), join(dir, "node_modules"), "dir");
    const b = spawnSync("npm", ["run", "build"], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
    if (b.status !== 0) throw new Error(`building the base ${mergeBase.slice(0, 9)} failed`);
    // The base's own budget script: its classes are what it measured with.
    return budget(dir, join(dir, "scripts", "bundle-budget.mjs")).sizes;
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd });
    rmSync(dir, { recursive: true, force: true });
  }
}

/** owner/name of the GitHub repository (from --repo, or the origin remote). */
function repoOf(cwd, given) {
  if (given) return given;
  const url = git(cwd, "remote", "get-url", "origin").trim();
  // github.com URLs, and proxies that keep owner/name as the last two segments.
  const m = url.match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/) ?? url.match(/\/([^/:]+\/[^/]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`cannot tell the GitHub repository from the origin remote (${url}); pass --repo owner/name`);
  return m[1];
}

const ghJson = (args) => JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));

/** What the human-review rule needs about PR `n`, read with `gh api` (REST only). */
export function loadPr(repo, n) {
  const pull = ghJson([`repos/${repo}/pulls/${n}`]);
  const events = ghJson(["--paginate", `repos/${repo}/issues/${n}/events?per_page=100`]).map((e) => ({ event: e.event, label: e.label?.name, created_at: e.created_at, actor: e.actor?.login }));
  const reviews = ghJson(["--paginate", `repos/${repo}/pulls/${n}/reviews?per_page=100`]).map((r) => ({ user: r.user?.login, state: r.state, submitted_at: r.submitted_at, commit_id: r.commit_id }));
  const comments = ghJson(["--paginate", `repos/${repo}/issues/${n}/comments?per_page=100`]).map((c) => ({ id: c.id, user: c.user?.login, association: c.author_association, created_at: c.created_at, body: c.body ?? "" }));
  const head = ghJson([`repos/${repo}/commits/${pull.head.sha}`]);
  return { number: Number(n), labels: pull.labels.map((l) => l.name), events, reviews, comments, author: pull.user?.login, headSha: pull.head.sha, headDate: head.commit?.committer?.date ?? null };
}

/** The open pull requests as [{ number, head, base }], read with `gh api` (REST only). */
export function loadOpenPrs(repo) {
  return ghJson(["--paginate", `repos/${repo}/pulls?state=open&per_page=100`]).map((p) => ({ number: p.number, head: p.head?.ref, base: p.base?.ref }));
}

/** Every check → { sections: [{ title, status: "ok" | "warn" | "fail" | "skipped", lines }], failed }. */
export function runChecks(opts) {
  const { cwd } = opts;
  const mergeBase = git(cwd, "merge-base", opts.base, "HEAD").trim();
  const range = `${mergeBase}..HEAD`;
  const sections = [];
  const add = (title, status, lines = []) => sections.push({ title, status, lines });

  // Commits
  const subjects = git(cwd, "log", "--format=%s", range).split("\n").filter(Boolean);
  const noSkip = skipCiViolations(subjects);
  add("Commits carry [skip ci]", noSkip.length ? "fail" : "ok", noSkip.length ? noSkip.map((s) => `- \`${s}\``) : [`${subjects.length} commit${subjects.length === 1 ? "" : "s"}, all with [skip ci].`]);

  // No stacks (W6.22): the base, the drift behind it and the age of the merge base.
  {
    const remotes = git(cwd, "remote").split("\n").filter(Boolean);
    const base = branchName(opts.base, remotes);
    const remoteOf = remotes.find((r) => opts.base.startsWith(`${r}/`)) ?? remotes[0];
    const trainBranches = remoteOf ? git(cwd, "for-each-ref", "--format=%(refname:short)", `refs/remotes/${remoteOf}/verify/`).split("\n").filter(Boolean).map((r) => r.slice(remoteOf.length + 1)) : [];
    const train = opts.train ?? currentTrain(trainBranches);
    const v = baseVerdict(base, train);
    // Drift against the base when it is allowed; against the train head when the PR is stacked.
    const driftRef = v.status === "ok" || !train || !remoteOf ? opts.base : `${remoteOf}/${train}`;
    const behind = Number(git(cwd, "rev-list", "--count", `HEAD..${driftRef}`).trim());
    const ageDays = (opts.now / 1000 - Number(git(cwd, "show", "-s", "--format=%ct", mergeBase).trim())) / 86400;
    const mergeBases = git(cwd, "merge-base", "--all", opts.base, "HEAD").split("\n").filter(Boolean).length;
    const rows = [v, ...driftVerdicts({ base: branchName(driftRef, remotes), behind, ageDays, mergeBases, maxAgeDays: opts.maxAgeDays, ageOf: base })];
    // Stack depth through the chain of bases: only a base that is not main or verify/* can be deeper than 1.
    if (!isRoot(base)) {
      const prs = opts.prs ? JSON.parse(readFileSync(resolve(cwd, opts.prs), "utf8")) : opts.pr ? (opts.loadOpenPrs ?? loadOpenPrs)(opts.loadOpenPrs ? opts.repo : repoOf(cwd, opts.repo)) : [];
      rows.push(depthVerdict(stackDepth(base, prs)));
    }
    add("Based on the train head", worst(rows), rows.map((r) => `- ${r.line}`));
  }

  // Body
  let body = null;
  if (opts.body) {
    body = readFileSync(resolve(cwd, opts.body), "utf8");
    const p = bodyProblems(body);
    add("PR body sections", p.length ? "fail" : "ok", p.length ? p.map((x) => `- ${x}`) : ["Every required section is there and not empty."]);
  } else add("PR body sections", "skipped", ["Pass the body with `--body <file>`."]);

  // Diff-based rules
  const diff = git(cwd, "diff", "-U2", "--no-color", `${mergeBase}...HEAD`);
  const added = addedLinesFromDiff(diff);
  const changed = git(cwd, "diff", "--name-only", `${mergeBase}...HEAD`).split("\n").filter(Boolean);
  const ledgerFile = join(cwd, "src", "ai", "privacyLedger.ts");
  if (existsSync(ledgerFile)) {
    const v = unregisteredNetworkCalls(added, readFileSync(ledgerFile, "utf8"));
    add("Network calls in the privacy ledger", v.length ? "fail" : "ok", v.length ? v.map((x) => `- \`${x.file}:${x.line}\` ${x.why}: \`${x.text.slice(0, 120)}\``) : ["No new network call outside the ledger."]);
  } else add("Network calls in the privacy ledger", "skipped", ["src/ai/privacyLedger.ts is not on this branch."]);

  // W11.S13: every ledger route has its store privacy label entry (a label that doesn't match the ledger is a store risk).
  if (existsSync(ledgerFile) && existsSync(join(cwd, LABELS))) {
    const lp = labelProblems(JSON.parse(readFileSync(join(cwd, LABELS), "utf8")), ledgerRoutes(cwd), unknownRecorders(cwd));
    add("Store privacy labels cover the ledger", lp.length ? "fail" : "ok", lp.length ? lp.map((x) => `- ${x}`) : [`Every ledger route has an entry in \`${LABELS}\`.`]);
  } else add("Store privacy labels cover the ledger", "skipped", [`${LABELS} or the ledger is not on this branch.`]);

  const dom = domainMentions(added);
  add("The project's domain", dom.length ? "fail" : "ok", dom.length ? dom.map((x) => `- \`${x.file}:${x.line}\``) : ["Not named in any added line."]);

  // Max-lines (W6.25, W10.E31): the gate has no baseline; a diff that brings one back fails.
  if (existsSync(join(cwd, RETIRED_BASELINE_PATH))) add("Max-lines has no baseline", "fail", [`- \`${RETIRED_BASELINE_PATH}\` exists. The gate allows no exceptions: split the file instead.`]);
  else add("Max-lines has no baseline", "ok", ["No baseline file."]);

  // Human review of sensitive paths (plan W4.28)
  const ownersFile = join(cwd, ".github", "CODEOWNERS");
  const atBase = (f) => {
    try {
      return git(cwd, "show", `${mergeBase}:${f}`);
    } catch {
      return null; // why: the base has no such file
    }
  };
  const baseOwners = atBase(".github/CODEOWNERS");
  if (existsSync(ownersFile) || baseOwners != null) {
    // T6-H1: a PR can't make a path non-sensitive by editing CODEOWNERS: the base's entries apply too.
    const ownersText = [baseOwners, existsSync(ownersFile) ? readFileSync(ownersFile, "utf8") : null].filter((x) => x != null).join("\n");
    const sensitive = sensitiveChanges(changed, parseCodeowners(ownersText));
    let pr = null;
    let mismatch = null;
    if (opts.pr && sensitive.length) {
      pr = opts.loadPr ? opts.loadPr(opts.repo, opts.pr) : loadPr(repoOf(cwd, opts.repo), opts.pr);
      const local = git(cwd, "rev-parse", "HEAD").trim();
      if (pr.headSha && pr.headSha !== local) mismatch = `This checkout's HEAD (\`${local.slice(0, 9)}\`) is not PR #${pr.number}'s head (\`${pr.headSha.slice(0, 9)}\`): fetch the PR branch and run again.`;
    }
    // Plan W6.13: cryptography needs a label from someone other than the owner and the author.
    let owner = opts.owner ?? null;
    if (pr && !owner) {
      try {
        owner = repoOf(cwd, opts.repo).split("/")[0];
      } catch {
        /* why: no GitHub remote — the author rule still applies */
      }
    }
    const v = humanReviewVerdict(sensitive, pr, HUMAN_REVIEW_LABEL, { independent: independentPatterns(ownersText), owner });
    add("Human review of sensitive paths", mismatch ? "fail" : v.status, mismatch ? [mismatch, "", ...v.lines] : v.lines);

    // Independent review receipt for the head (plan W6.11)
    const receipts = commentReceipts(pr?.comments);
    for (const f of opts.review ?? []) {
      let receipt;
      try {
        receipt = JSON.parse(readFileSync(resolve(cwd, f), "utf8"));
      } catch (e) {
        receipt = { error: `cannot read ${f} as JSON (${e.message})` };
      }
      receipts.push({ source: `\`${f}\``, receipt });
    }
    const head = pr?.headSha ?? git(cwd, "rev-parse", "HEAD").trim();
    // T6-H1: the trust anchor comes from the merge base, never from the change under review,
    // so a key the PR adds (or changes) is not trusted until the PR is merged.
    const baseRegistry = atBase("security/reviewers.json");
    const reviewers = baseRegistry != null ? parseReviewers(baseRegistry) : null;
    // W10.D3: neither the PR's author nor anyone who wrote or committed a commit in the range may review it.
    const commits = git(cwd, "log", "--format=%an%x1f%ae%x1f%cn%x1f%ce", range)
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [authorName, authorEmail, committerName, committerEmail] = l.split("\x1f");
        return { authorName, authorEmail, committerName, committerEmail };
      });
    const excluded = excludedIdentities({ prAuthor: pr?.author ?? null, commits });
    const prNumber = pr?.number ?? (opts.pr != null ? Number(opts.pr) : null);
    const iv = independentReviewVerdict(sensitive, receipts, { head, strict: !!opts.pr || (opts.review ?? []).length > 0, reviewers, excluded, pr: prNumber, base: mergeBase });
    if (!reviewers) iv.lines.push("", `- security/reviewers.json is missing at the merge base \`${mergeBase.slice(0, 9)}\`: no receipt can be verified, so none counts.`);
    if (changed.includes("security/reviewers.json")) iv.lines.push("", "- This PR changes security/reviewers.json: receipts are checked against the merge base's registry, so a key it adds or changes counts only after it is merged.");
    if (reviewers?.problems.length) iv.lines.push("", ...reviewers.problems.map((x) => `- ${x}`));
    add("Independent review of sensitive paths", mismatch ? "fail" : iv.status, mismatch ? [mismatch, "", ...iv.lines] : iv.lines);
  } else {
    add("Human review of sensitive paths", "skipped", [".github/CODEOWNERS is not on this branch."]);
    add("Independent review of sensitive paths", "skipped", [".github/CODEOWNERS is not on this branch."]);
  }

  // Every sensitive file has an owner (plan W8.6)
  {
    const whole = changed.includes(".github/CODEOWNERS") || changed.includes(EXCEPTIONS_FILE);
    const paths = whole ? git(cwd, "ls-files", "-z").split("\0").filter(Boolean) : changed;
    const c = treeCoverage(cwd, paths, opts.today ?? new Date());
    const title = "Sensitive files have an owner";
    if (!c) add(title, "skipped", [".github/CODEOWNERS is not on this branch."]);
    else add(title, c.uncovered.length || c.problems.length ? "fail" : "ok", [whole ? "CODEOWNERS or its exceptions changed: the whole tree is checked." : `The ${changed.length} changed file${changed.length === 1 ? "" : "s"} are checked (\`npm run codeowners:check\` checks the whole tree).`, "", ...coverageLines(c)]);
  }

  const untested = untestedChanges(changed);
  // W10.D20 (W6.15 step 4): a snapshot changes only with what produces it.
  const handEdited = handEditedSnapshots(changed, (f) => existsSync(join(cwd, f)), { root: cwd, list: () => git(cwd, "ls-files").split("\n").filter(Boolean) });
  add("Snapshots are regenerated, not edited", handEdited.length ? "fail" : "ok", handEdited.length ? [`Changed with nothing that produces them (no source, test, input document or package changed): ${handEdited.map((f) => `\`${f}\``).join(", ")}. Regenerate them with the test's update flag (\`npx vitest run <test> -u\`, \`npx playwright test <spec> --update-snapshots\`) in the PR that changes their output.`] : ["No snapshot changed without what produces it."]);
  add("Tests", untested.length ? "warn" : "ok", untested.length ? [`Source changed and no test changed: ${untested.slice(0, 10).map((f) => `\`${f}\``).join(", ")}${untested.length > 10 ? ` and ${untested.length - 10} more` : ""}.`] : ["Source changes come with test changes (or there are none)."]);

  // Licences
  if (changed.includes("package-lock.json")) {
    const baseLock = JSON.parse(git(cwd, "show", `${mergeBase}:package-lock.json`));
    const headLock = JSON.parse(readFileSync(join(cwd, "package-lock.json"), "utf8"));
    const rows = licenceChanges(baseLock, headLock);
    const bad = rows.filter((r) => r.level === "fail");
    add("Licences of production packages", bad.length ? "fail" : rows.some((r) => r.level === "warn") ? "warn" : "ok", rows.length ? ["| Package | Version | Licence | Before | |", "|---|---|---|---|---|", ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} | ${r.previous ?? "new"} | ${r.level} |`)] : ["The lockfile changed, no production package did."]);
  } else add("Licences of production packages", "ok", ["package-lock.json is unchanged."]);

  // Dependency review (W10.D14, in place of GitHub's dependency-review action): a
  // changed lockfile or manifest is checked against the known-bad list offline
  // (scripts/audit-lock.mjs); npm audit and cargo audit run in Buildkite's security job.
  {
    const deps = changed.filter((f) => /(^|\/)(package-lock\.json|package\.json|Cargo\.lock|Cargo\.toml)$/.test(f) || f === "security/known-bad.json");
    if (!deps.length) add("Dependency review", "ok", ["No lockfile, manifest or known-bad entry changed."]);
    else if (!existsSync(join(cwd, "security/known-bad.json"))) add("Dependency review", "skipped", ["security/known-bad.json is not on this branch."]);
    else {
      const { entries } = JSON.parse(readFileSync(join(cwd, "security/known-bad.json"), "utf8"));
      const r = auditLockCheck(entries, (f) => (existsSync(join(cwd, f)) ? readVersions(cwd, f) : null), opts.today ?? new Date().toISOString().slice(0, 10));
      add("Dependency review", r.errors.length ? "fail" : r.open.length ? "warn" : "ok", [
        `Changed: ${deps.map((f) => `\`${f}\``).join(", ")}.`,
        ...(r.errors.length ? ["", ...r.errors.map((e) => `- ${e}`)] : []),
        ...(r.open.length ? ["", "Open (waiting for an owner step):", ...r.open.map((o) => `- ${o}`)] : []),
        ...(!r.errors.length && !r.open.length ? ["", "No known-bad version in any checked file."] : []),
      ]);
    }
  }

  // Budgets only go down (W6.26): every ratchet file the diff changes, against the merge base.
  {
    const raised = [];
    const touched = RATCHET_FILES.filter((f) => changed.includes(f));
    for (const f of touched) {
      let before = null;
      try {
        before = git(cwd, "show", `${mergeBase}:${f}`);
      } catch {
        // why: the base has no such file yet — this diff introduces it, so there is nothing to raise.
      }
      const after = existsSync(join(cwd, f)) ? readFileSync(join(cwd, f), "utf8") : null;
      if (before != null && after == null) raised.push(`- \`${f}\` was deleted.`);
      else if (before != null) raised.push(...raisesFor(f, before, after).map((x) => raiseLine(f, x)));
    }
    // The numbers live in the JSON: a number written into the enforcer itself would bypass the check.
    for (const a of added["scripts/bundle-budget.mjs"] ?? []) {
      if (/\bbudgetKb\s*:\s*\d|STARTUP_BUDGET_KB\s*=\s*\d/.test(a.text)) raised.push(`- \`scripts/bundle-budget.mjs:${a.line}\` sets a budget in code; budgets live in \`scripts/bundle-budgets.json\`.`);
    }
    add("Budgets only go down", raised.length ? "fail" : "ok", raised.length ? [...raised, "", "A budget is never raised: split the chunk, load it lazily, or make the page faster."] : [touched.length ? `${touched.map((f) => `\`${f}\``).join(", ")}: nothing raised.` : "No budget file changed."]);
  }

  // AI label
  const messages = git(cwd, "log", "--format=%B%x1e", range).split("\x1e");
  if (writtenByAi(body, messages)) add("Label", "warn", [`Written by an AI agent: add the \`${AI_LABEL}\` label.`]);

  // Bundle size
  if (opts.noSize) add("Bundle size", "skipped", ["--no-size"]);
  else {
    try {
      const head = opts.headSizes ? { sizes: JSON.parse(readFileSync(opts.headSizes, "utf8")), budgetOk: null } : existsSync(join(cwd, "dist", "assets")) ? budget(cwd, join(cwd, "scripts", "bundle-budget.mjs")) : null;
      if (!head) add("Bundle size", "skipped", ["dist/ is not built: run `npm run build` first (or pass --head-sizes)."]);
      else {
        const baseSizes = opts.baseSizes ? JSON.parse(readFileSync(opts.baseSizes, "utf8")) : opts.buildBase ? buildBase(cwd, mergeBase) : null;
        const table = bundleDiffMarkdown(baseSizes, head.sizes, opts.base.replace(/^origin\//, "")).split("\n").filter((l) => !l.startsWith("<!--") && !l.startsWith("###"));
        add("Bundle size", head.budgetOk === false ? "fail" : "ok", [...table, "", head.budgetOk === false ? "**The bundle budget (`npm run budget`) fails.**" : head.budgetOk ? "The bundle budget passes." : ""]);
      }
    } catch (e) {
      add("Bundle size", "fail", [String(e.message)]);
    }
  }
  return { base: opts.base, mergeBase, sections, failed: sections.some((s) => s.status === "fail") };
}

const ICON = { ok: "✅", warn: "⚠️", fail: "❌", skipped: "➖" };

export function report(r) {
  const lines = ["<!-- lumen-pr-check -->", `## PR check (plan 0.19)`, "", `Against \`${r.base}\` (merge base \`${r.mergeBase.slice(0, 9)}\`). Replaces Danger: run \`npm run pr:check\`.`, ""];
  lines.push("| | Check |", "|---|---|", ...r.sections.map((s) => `| ${ICON[s.status]} | ${s.title} |`), "");
  for (const s of r.sections) lines.push(`### ${ICON[s.status]} ${s.title}`, "", ...s.lines.filter((l, i, a) => l !== "" || (i && a[i - 1] !== "")), "");
  lines.push(r.failed ? "**PR check: failed.**" : "**PR check: passed.**");
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const r = runChecks(opts);
  const md = report(r);
  console.log(md);
  if (opts.out) writeFileSync(opts.out, md + "\n");
  process.exit(r.failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
