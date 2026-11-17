/**
 * A lane's STATE.md, and what a resumed lane does next (W8.10).
 *
 * A session can stop at any point (an API limit, a lost context). Each lane
 * keeps one STATE.md (docs/dev/lane-state.md has the template) whose
 * "Branches" table says, per branch, the head the lane last pushed. On
 * resume, `node scripts/lane-state.mjs resume <STATE.md>` compares that
 * table with git and GitHub and prints one action per branch, so finished
 * work is not redone and nothing is pushed twice.
 *
 * Pure functions here; scripts/lane-state.mjs runs git and gh.
 */

/** The columns of the Branches table, in order. */
export const BRANCH_COLUMNS = ["branch", "worktree", "base", "pushed", "pr"];

const SHA = /^[0-9a-f]{7,40}$/;
const clean = (cell) => cell.replace(/`/g, "").trim();

/**
 * The rows of the "## Branches" table of a STATE.md:
 * [{ branch, worktree, base, pushed: sha|null, pr: number|null }].
 * A "—" (or empty, or "none") pushed cell means never pushed; a pr cell
 * "#512" is that PR. Rows that are not a branch (the header, the rule) are skipped.
 */
export function parseBranches(md) {
  const lines = String(md).split("\n");
  const start = lines.findIndex((l) => /^##\s+Branches\b/i.test(l));
  if (start < 0) return [];
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(clean);
    if (cells.length < BRANCH_COLUMNS.length || /^-+$/.test(cells[0].replace(/[:\s]/g, "")) || cells[0].toLowerCase() === "branch") continue;
    const [branch, worktree, base, pushed, pr] = cells;
    rows.push({
      branch,
      worktree,
      base,
      pushed: SHA.test(pushed) ? pushed : null,
      pr: /^#?\d+$/.test(pr) ? Number(pr.replace("#", "")) : null,
    });
  }
  return rows;
}

const same = (a, b) => Boolean(a && b) && (a.startsWith(b) || b.startsWith(a));

/**
 * What to do with one branch on resume.
 *   row:   its STATE.md row
 *   facts: { local: sha|null (the worktree's HEAD), remote: sha|null (origin's head),
 *            prs: [numbers of open or closed PRs whose head is the branch],
 *            ahead / behind: commits local has that remote lacks, and the reverse (null: unknown) }
 * → { action, why }, action one of
 *   "nothing"    origin already has the local head: do not push again
 *   "push"       local commits origin lacks: run the pre-push check, then push once
 *   "open-pr"    pushed, but no PR has this head yet (and STATE.md names none)
 *   "record"     origin is ahead of STATE.md (another session pushed): update STATE.md, push nothing
 *   "look"       the worktree is gone, or origin moved away from local: a person decides
 */
export function resumeAction(row, facts) {
  const { local, remote, prs = [], ahead = null, behind = null } = facts;
  if (!local) return { action: "look", why: `no worktree at ${row.worktree}: recreate it from origin/${row.branch} before any work` };
  const hasPr = prs.length > 0 || row.pr != null;
  if (remote && same(local, remote)) {
    if (!same(row.pushed ?? "", remote)) return { action: "record", why: `origin/${row.branch} is at ${remote.slice(0, 10)}, STATE.md says ${row.pushed ?? "never pushed"}: write the new head into STATE.md` };
    return hasPr ? { action: "nothing", why: `pushed ${remote.slice(0, 10)}${prs.length ? `, PR #${prs[0]}` : row.pr ? `, PR #${row.pr}` : ""}: nothing to push` } : { action: "open-pr", why: `pushed ${remote.slice(0, 10)}, no PR yet: open one (do not push again)` };
  }
  if (!remote && row.pushed) return { action: "look", why: `STATE.md says ${row.pushed} was pushed, but origin has no ${row.branch}: check the branch name before pushing` };
  if (remote && behind) return { action: "look", why: `origin/${row.branch} (${remote.slice(0, 10)}) has ${behind} commit(s) the worktree (${local.slice(0, 10)}) lacks: fetch and merge, never force` };
  if (remote && row.pushed && !same(row.pushed, remote)) return { action: "look", why: `origin/${row.branch} moved to ${remote.slice(0, 10)} since STATE.md's ${row.pushed}: fetch and merge before pushing` };
  return { action: "push", why: `${ahead ?? "unpushed"} local commit(s) not on origin${remote ? "" : " (the branch is not on origin yet)"}: prepush, then one push, then write the new head into STATE.md` };
}

/** A fresh Branches table for STATE.md from rows (after a push, write this back). */
export function renderBranches(rows) {
  const head = `| ${BRANCH_COLUMNS.join(" | ")} |`;
  const rule = `| ${BRANCH_COLUMNS.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.branch} | ${r.worktree} | ${r.base} | ${r.pushed ?? "—"} | ${r.pr != null ? `#${r.pr}` : "—"} |`);
  return [head, rule, ...body].join("\n");
}

/*
 * Writing STATE.md without a person (W8.10 step 2): after every push and
 * every hour. Git has no post-push hook, so a push is recorded in two
 * halves: the pre-push hook (scripts/ci-local.mjs --install-hook) notes
 * what the push sends (`pending`), and the reference-transaction hook
 * (`lane-state.mjs install-hook`) records it when git moves the
 * remote-tracking ref to that sha, which happens only once origin has
 * accepted the push. A fetch that moves the same ref to another sha is
 * not a push of ours and is not logged as one.
 */

const ZERO = /^0+$/;

/** The pre-push hook's stdin → [{ branch, sha }] for branches this push creates or moves (not deletes). */
export function pushedRefs(stdin) {
  const out = [];
  for (const line of String(stdin).split("\n")) {
    const [, localSha, remoteRef] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha) || !remoteRef?.startsWith("refs/heads/")) continue;
    out.push({ branch: remoteRef.slice("refs/heads/".length), sha: localSha });
  }
  return out;
}

/**
 * The reference-transaction hook's stdin (committed) against what pre-push
 * noted → { confirmed: [{ branch, sha }], pending: the notes still waiting }.
 * A note is confirmed when refs/remotes/<remote>/<branch> moved to its sha.
 */
export function confirmedPushes(stdin, pending, remote = "origin") {
  const prefix = `refs/remotes/${remote}/`;
  const moved = new Map();
  for (const line of String(stdin).split("\n")) {
    const [, newSha, ref] = line.trim().split(/\s+/);
    if (ref?.startsWith(prefix) && newSha && !ZERO.test(newSha)) moved.set(ref.slice(prefix.length), newSha);
  }
  const confirmed = [];
  const left = [];
  for (const p of pending) (moved.get(p.branch) === p.sha && (p.remote ?? remote) === remote ? confirmed : left).push(p);
  return { confirmed: confirmed.map(({ branch, sha }) => ({ branch, sha })), pending: left };
}

/** Replace the "Updated:" line's time (the part before " · ", if any); add the line under the title when there is none. */
export function touchUpdated(md, at) {
  const lines = String(md).split("\n");
  const i = lines.findIndex((l) => /^Updated:/.test(l));
  if (i < 0) {
    const t = lines.findIndex((l) => /^#\s/.test(l));
    lines.splice(t + 1, 0, "", `Updated: ${at}`);
    return lines.join("\n");
  }
  const rest = lines[i].includes(" · ") ? lines[i].slice(lines[i].indexOf(" · ")) : "";
  lines[i] = `Updated: ${at}${rest}`;
  return lines.join("\n");
}

/** The lines of one "## <title>" section: [start, end) indices, or null. */
function section(lines, title) {
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${title}\\b`, "i").test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, j) => j > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  return [start, end];
}

/**
 * STATE.md after `branch` reached origin at `sha`:
 *   - Updated: `at`;
 *   - the Branches row's pushed cell is the sha (a row is added when the branch has none);
 *   - one line at the end of "## Pushes": "<at> <branch> <sha10> <note>".
 * Recording the same sha twice changes only the Updated line.
 */
export function recordPush(md, { branch, sha, at, note = "(recorded by the reference-transaction hook)", worktree = "—", base = "—" }) {
  const short = sha.slice(0, 10);
  const rows = parseBranches(md);
  const had = rows.find((r) => r.branch === branch);
  const already = had && had.pushed && same(had.pushed, sha);
  let lines = touchUpdated(md, at).split("\n");
  if (already) return lines.join("\n");
  const next = had ? rows.map((r) => (r.branch === branch ? { ...r, pushed: short } : r)) : [...rows, { branch, worktree, base, pushed: short, pr: null }];
  const b = section(lines, "Branches");
  if (b) {
    const [start, end] = b;
    const first = lines.findIndex((l, j) => j > start && j < end && l.trim().startsWith("|"));
    let last = first;
    while (first >= 0 && last + 1 < end && lines[last + 1].trim().startsWith("|")) last++;
    const table = renderBranches(next).split("\n");
    if (first >= 0) lines.splice(first, last - first + 1, ...table);
    else lines.splice(start + 1, 0, "", ...table);
  } else {
    lines.push("", "## Branches", "", ...renderBranches(next).split("\n"));
  }
  const entry = `${at} ${branch} ${short} ${note}`.trim();
  const p = section(lines, "Pushes");
  if (p) {
    let at2 = p[1];
    while (at2 - 1 > p[0] && !lines[at2 - 1].trim()) at2--;
    const add = at2 - 1 === p[0] ? ["", entry] : [entry];
    if (/^##\s/.test(lines[at2] ?? "")) add.push("");
    lines.splice(at2, 0, ...add);
  } else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push("", "## Pushes", "", entry, "");
  }
  return lines.join("\n");
}

/** The STATE.md (path → text) whose Branches table lists `branch`, or null. */
export function stateFor(branch, files) {
  for (const [path, md] of files) if (parseBranches(md).some((r) => r.branch === branch)) return path;
  return null;
}

/** The reference-transaction hook (mark included, so a reinstall replaces only ours). */
export const TXN_HOOK_MARK = "installed by `node scripts/lane-state.mjs install-hook` (W8.10)";
/**
 * The pre-push half (W8.10, so one command sets a clone up): `install-hook`
 * also writes a pre-push hook that only notes the push, when there is none.
 * A pre-push hook that already notes it (ci:local's, or ours) is kept as it
 * is; anyone else's is never replaced (`refuse`: add the line yourself).
 */
export const PREPUSH_MARK = "lane-state pre-push half, installed by `node scripts/lane-state.mjs install-hook` (W8.10)";
export const PREPUSH_LINE = 'printf \'%s\\n\' "$(cat)" | node scripts/lane-state.mjs pending "$1" || true';
export function prePushPlan(existing) {
  const content = `#!/bin/sh\n# ${PREPUSH_MARK}\n# Notes what this push sends, for the reference-transaction hook; never stops a push.\n${PREPUSH_LINE}\nexit 0\n`;
  if (existing == null) return { action: "write", content };
  if (existing.includes(PREPUSH_MARK) || existing.includes("lane-state.mjs pending")) return { action: "keep", content };
  return { action: "refuse", content };
}

export function txnHookPlan(existing, { force = false } = {}) {
  const content = [
    "#!/bin/sh",
    `# ${TXN_HOOK_MARK}`,
    "# Records a push in the lane's STATE.md once origin has it, and keeps the lane's hourly",
    "# tick running (W10.E57); with no lane state set it does nothing. Never fails the transaction.",
    '[ "$1" = committed ] || exit 0',
    'if [ -n "$LUMEN_LANE_STATE$LUMEN_LANE_STATE_DIR" ] || git config --get lumen.laneState >/dev/null 2>&1 || git config --get lumen.laneStateDir >/dev/null 2>&1; then',
    "  node scripts/lane-state.mjs ensure-watch </dev/null >/dev/null 2>&1 || true",
    "fi",
    '[ -s "$(git rev-parse --git-path lumen-lane-pending.json)" ] || exit 0',
    "node scripts/lane-state.mjs committed >/dev/null 2>&1 || true",
    "exit 0",
    "",
  ].join("\n");
  if (existing == null || existing.includes(TXN_HOOK_MARK)) return { action: "write", content };
  return { action: force ? "backup" : "refuse", content };
}

/**
 * The hourly tick, started by the reference-transaction hook (W10.E57): which
 * STATE.md to watch, and whether a watcher already runs for it.
 * @param {{ file?: string; dir?: string } | null} cfg  the lane config
 * @param {string[]} candidates  the STATE.md files of a --state-dir config
 * @param {string | null} branch  the checkout's branch
 * @param {(f: string) => string} read
 * @param {{ pid: number; file: string } | null} running  the watcher on record
 * @param {(pid: number) => boolean} alive
 * @returns {{ action: "none"; why: string } | { action: "start"; file: string }}
 */
export function watchPlan(cfg, candidates, branch, read, running, alive) {
  if (!cfg) return { action: "none", why: "no lane state" };
  const file = cfg.file ?? (branch ? stateFor(branch, candidates.map((p) => [p, read(p)])) : null);
  if (!file) return { action: "none", why: "no STATE.md lists this branch" };
  if (running && running.file === file && alive(running.pid)) return { action: "none", why: "a watcher runs" };
  return { action: "start", file };
}


/**
 * The watch record (review 11, M2): one file in the repository's common git dir
 * (`git rev-parse --git-common-dir`, shared by every linked worktree), keyed by
 * the STATE.md path, so two worktrees of one clone share one watcher per STATE.md.
 * An older record (`{ pid, file }`, one per worktree) reads as its one entry.
 * @returns {Record<string, { pid: number; since?: string; repo?: string }>}
 */
export function parseWatchRecord(text) {
  let v;
  try {
    v = JSON.parse(text ?? "");
  } catch {
    return {};
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  if (typeof v.pid === "number" && typeof v.file === "string") return { [v.file]: { pid: v.pid, since: v.since } };
  const out = {};
  for (const [k, e] of Object.entries(v)) if (e && typeof e === "object" && typeof e.pid === "number") out[k] = e;
  return out;
}

/** The entry of `record` for `file` as watchPlan's `running`, or null. */
export const runningFor = (record, file) => (file && record[file] ? { pid: record[file].pid, file } : null);

/**
 * Plan 0.13 step 2: after a push origin confirmed, the handoff of the
 * worktree that pushed is regenerated (scripts/handoff.mjs --refresh, local
 * data only: a hook makes no GitHub calls). null when nothing was confirmed
 * or the checkout has no handoff script.
 * @param {number} confirmed  pushes origin confirmed in this transaction
 * @param {boolean} hasScript  scripts/handoff.mjs exists in the worktree
 */
export function handoffRefreshArgs(confirmed, hasScript) {
  return confirmed > 0 && hasScript ? ["scripts/handoff.mjs", "--refresh", "--no-github"] : null;
}

