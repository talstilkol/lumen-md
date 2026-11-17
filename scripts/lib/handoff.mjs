/**
 * Pure parts of the handoff generator (plan 0.13): parsing git output and
 * writing the Markdown, so they can be tested without git or GitHub.
 */

/**
 * `git worktree list --porcelain` → [{ path, branch, head, prunable?, locked? }].
 * `prunable` (git's reason) marks a worktree whose directory is gone; a
 * locked one is never prunable, so the CLI also checks that the path exists.
 */
export function parseWorktrees(text) {
  const out = [];
  let cur = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice(9), branch: null, head: null };
      out.push(cur);
    } else if (cur && line.startsWith("HEAD ")) cur.head = line.slice(5, 13);
    else if (cur && line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (cur && (line === "prunable" || line.startsWith("prunable "))) cur.prunable = line.slice(9).trim() || "prunable";
    else if (cur && (line === "locked" || line.startsWith("locked "))) cur.locked = line.slice(7).trim() || true;
  }
  return out;
}

/** The PR stack as a tree: each PR under the PR whose head is its base. Roots are PRs on a branch no open PR provides. */
export function prTree(prs) {
  const byHead = new Map(prs.map((p) => [p.head, p]));
  const children = new Map();
  const roots = [];
  for (const p of prs) {
    const parent = byHead.get(p.base);
    if (parent && parent !== p) {
      if (!children.has(parent.number)) children.set(parent.number, []);
      children.get(parent.number).push(p);
    } else roots.push(p);
  }
  const sort = (a) => a.sort((x, y) => x.number - y.number);
  const lines = [];
  const seen = new Set();
  const walk = (p, depth) => {
    if (seen.has(p.number)) return;
    seen.add(p.number);
    lines.push({ depth, pr: p });
    for (const c of sort(children.get(p.number) ?? [])) walk(c, depth + 1);
  };
  for (const r of sort(roots)) walk(r, 0);
  // PRs based on one another's heads (a cycle) have no root: show each such
  // component from its lowest number rather than drop it (W1.32, Codex on #211).
  for (const p of sort([...prs])) walk(p, 0);
  return lines;
}

const CI_MARK = { success: "✅", failure: "❌", cancelled: "⚪", null: "⏳", undefined: "—" };

/**
 * The CI of a PR head now that GitHub Actions no longer runs the gates
 * (9.11): first the commit's combined status, which Buildkite, Vercel and
 * the `lumen/receipt` signer post; then this machine's own runs at that
 * commit (`train:offline --all` and `ci:local` records); and only then the
 * last Actions run, labelled retired. Returns { ci, sha, via }:
 * ci "success" | "failure" | null (running) | undefined (nothing known).
 * @param {{ headSha?: string|null, status?: any, localRuns?: Array<{ sha: string, at?: string, green?: boolean, gates?: Array<{ status: string }> }>, actionsRun?: any }} o
 */
export function ciOfHead({ headSha = null, status = null, localRuns = [], actionsRun = null }) {
  const short = (x) => (x ? String(x).slice(0, 8) : undefined);
  if (status && Number(status.total_count) > 0) {
    const ci = status.state === "success" ? "success" : status.state === "failure" || status.state === "error" ? "failure" : null;
    const contexts = [...new Set((status.statuses ?? []).map((x) => x.context).filter(Boolean))].sort();
    return { ci, sha: short(status.sha ?? headSha), via: `status${contexts.length ? `: ${contexts.join(", ")}` : ""}` };
  }
  if (headSha) {
    const mine = localRuns.filter((r) => r.sha && r.sha.startsWith(headSha)).sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
    if (mine.length) {
      const r = mine[0];
      const red = r.green === false || (r.gates ?? []).some((g) => g.status === "fail");
      return { ci: red ? "failure" : "success", sha: short(r.sha), via: "local run" };
    }
  }
  if (actionsRun) return { ci: actionsRun.status === "completed" ? actionsRun.conclusion : null, sha: short(actionsRun.head_sha), via: "Actions (retired)" };
  return { ci: undefined, sha: undefined, via: undefined };
}

/** A PR whose head lives in another repository (a fork; `headRepo` null = a deleted fork). */
export const isForkPr = (p, repo) => p.headRepo !== undefined && p.headRepo !== repo;

/**
 * Names mentioned in the handoff that do not exist (a stale handoff is worse
 * than none). A fork PR's head is a branch of the fork, which GitHub just
 * returned, never a local or origin ref, so it is not checked here.
 */
export function missingRefs({ prs, worktrees, branches, repo }) {
  const known = new Set(branches);
  const problems = [];
  for (const p of prs) {
    // A deleted fork (headRepo null) has no head branch anywhere (W1.32, Codex on #211).
    if (p.headRepo === null) problems.push(`PR #${p.number}: its fork was deleted, so branch ${p.head} exists nowhere (close or recreate the PR)`);
    else if (!isForkPr(p, repo) && !known.has(p.head)) problems.push(`PR #${p.number}: branch ${p.head} is not here (git fetch?)`);
  }
  for (const w of worktrees) {
    if (w.prunable) problems.push(`worktree ${w.path}: the directory is gone (${w.prunable}); git worktree prune`);
    else if (w.branch && !known.has(w.branch)) problems.push(`worktree ${w.path}: branch ${w.branch} is gone`);
  }
  return problems;
}

/** Text for a Markdown table cell: a "|" would end the cell. */
const cell = (v) => String(v).replace(/\|/g, "\\|");

/** A line break, which would end the document's one-line fields (review 9, L10). */
const BREAK = /[\n\r\u2028\u2029\u0085]/;

/** The Markdown document. Refuses (throws on) a task or next step with a line break: readHandoff could not read it back. */
export function renderHandoff({ now, repo, task, next, where = null, prs, worktrees, problems }) {
  for (const [name, v] of [["task", task], ["next", next]]) if (v && BREAK.test(String(v))) throw new Error(`handoff: --${name} must be one line (a line break would cut it short when the document is read back)`);
  const o = [];
  o.push(`# Handoff — ${repo}`, "", `Generated ${now} by \`npm run handoff\` (plan 0.13). Regenerate after every PR; do not edit by hand.`, "");
  o.push("## Now", "", `- **Current task:** ${task || "—"}`);
  if (where?.path) o.push(`- **Where:** \`${cell(where.path)}\` on ${where.branch ? `\`${cell(where.branch)}\`` : "(detached)"}`);
  o.push(`- **Next step:** ${next ? `\`${cell(next)}\`` : "—"}`, "");
  o.push(`## Open PRs (${prs.length}) — as a stack`, "", "Indented PRs are based on the PR above them. CI is the head commit's status (Buildkite, Vercel, lumen/receipt); without one, this machine's latest train:offline or ci:local run at that commit; the retired Actions run only as a last resort, and then it says so.", "");
  o.push("| PR | Branch → base | CI | Unanswered review comments | Title |", "|---|---|---|---|---|");
  for (const { depth, pr } of prTree(prs)) {
    const ci = `${CI_MARK[pr.ci] ?? pr.ci}${pr.ciSha ? ` \`${pr.ciSha}\`` : ""}${pr.ciVia ? ` (${cell(pr.ciVia)})` : ""}`;
    const indent = depth === 0 ? "" : depth <= 3 ? "↳ ".repeat(depth) : `↳${depth} `;
    const head = isForkPr(pr, repo) ? `${pr.headRepo ? pr.headRepo.split("/")[0] : "(deleted fork)"}:${pr.head}` : pr.head;
    // A git ref may contain "|", which would end the table cell even inside backticks (W1.32, Codex on #211).
    o.push(`| ${indent}#${pr.number} | \`${cell(head)}\` → \`${cell(pr.base)}\` | ${ci} | ${pr.unanswered ?? "?"} | ${cell(pr.title)} |`);
  }
  o.push("", "\"Unanswered\" counts top-level review comments that have no reply yet. GitHub's REST API does not expose whether a thread is resolved, so this is an upper bound.", "");
  o.push(`## Worktrees (${worktrees.length})`, "", "| Path | Branch | HEAD |", "|---|---|---|");
  for (const w of worktrees) o.push(`| \`${w.path}\`${w.prunable ? " (directory gone)" : ""} | ${w.branch ? `\`${w.branch}\`` : "(detached)"} | \`${w.head ?? ""}\` |`);
  o.push("", "## To continue", "", "```sh", "git fetch origin", "gh api repos/<repo>/commits/<sha>/status  # CI of a PR head (Buildkite, Vercel, receipt)", "npm run ci:local -- --changed       # the gates, on this machine (plan 0.14)", "scripts/lane.sh <branch> <base>     # a new lane (docs/dev/lanes.md)", "```", "");
  o.push("## Checks", "");
  if (problems.length) for (const p of problems) o.push(`- ⚠️ ${p}`);
  else o.push("- Every branch and worktree named above exists.");
  o.push("");
  return o.join("\n");
}

/**
 * Plan 0.13's acceptance: a new agent continues from the document alone. The
 * problems that would stop it: a task with no next step, or a next step with
 * no place to run it.
 */
export function nextStepProblems({ task, next, where }) {
  const out = [];
  if (task && BREAK.test(task)) out.push("the task has a line break: the document would cut it short (one line only)");
  if (next && BREAK.test(next)) out.push("the next step has a line break: the document would cut it short (one line only)");
  if (task && !next) out.push("no next step: a new agent cannot continue from this document (pass --next)");
  if (next && !where?.path) out.push("the next step names no worktree to run in");
  return out;
}

/**
 * What a new agent reads from the document (and only from it): the task, the
 * worktree and branch to work in, and the next step's command.
 * @param {string} md
 */
export function readHandoff(md) {
  const line = (label) => new RegExp(`^- \\*\\*${label}:\\*\\* (.*)$`, "m").exec(md)?.[1] ?? null;
  const unq = (s) => (s && s.startsWith("`") && s.endsWith("`") ? s.slice(1, -1).replace(/\\\|/g, "|") : s);
  const task = line("Current task");
  const next = line("Next step");
  const w = /^`(.+)` on (?:`(.+)`|\(detached\))$/.exec(line("Where") ?? "");
  return {
    task: task === "—" ? null : task,
    next: next === "—" ? null : unq(next),
    where: w ? { path: w[1].replace(/\\\|/g, "|"), branch: w[2] ? w[2].replace(/\\\|/g, "|") : null } : null,
  };
}

/**
 * Plan 0.13 step 2: `--refresh` regenerates the document at the end of a PR
 * (the lane's reference-transaction hook runs it after each push origin
 * confirmed) and keeps what only a person or agent can say: the current task
 * and the next step, from the document it replaces, unless new ones are given.
 * @param {string | null} previousMd  the HANDOFF.md being replaced, or null
 * @param {{ task: string | null; next: string | null }} given  --task / --next
 */
export function refreshFields(previousMd, given) {
  const prev = previousMd ? readHandoff(previousMd) : { task: null, next: null };
  const explicit = given.task != null || given.next != null;
  return explicit ? { task: given.task ?? null, next: given.next ?? null } : { task: prev.task, next: prev.next };
}

