/**
 * Plan W10.G10 (W1.32): the P2 ledger as data. plan/p2-ledger.json holds one
 * entry per top-level Codex review comment that mentions P2 on the W1.32
 * PRs, with its decision; plan/p2-ledger.md is rendered from it. Pure
 * functions: scripts/p2-ledger.mjs does the I/O (git, gh api REST).
 *
 * Decisions: "fixed" (with the commit that fixed it), "accepted risk",
 * "superseded", or "open" (no decision yet). "100% mapped" means every P2
 * comment GitHub has on those PRs is an entry, and no entry is unknown to
 * GitHub; "0 P2 without a decision" means no entry is open.
 */

export const DECISIONS = Object.freeze(["fixed", "accepted risk", "superseded", "open"]);
const SHA = /^[0-9a-f]{7,40}$/;

/** A comment is a P2 finding when its body carries the P2 badge or the word P2. */
export const isP2 = (body) => /\bP2\b/.test(String(body ?? ""));

/** The rows of the markdown ledger (the format plan/p2-ledger.md had before this file existed). */
export function parseLedgerMd(md) {
  const rows = [];
  for (const line of String(md).split("\n")) {
    const m = /^\| #(\d+) \| \[(\d+)\]\(([^)]+)\) \| (.*) \| (fixed in ([0-9a-f]+)|accepted risk|superseded|open) \| (.*) \|$/.exec(line);
    if (!m) continue;
    const [, pr, id, url, finding, decisionCell, sha, evidence] = m;
    rows.push({ pr: Number(pr), id: Number(id), url, finding, decision: sha ? "fixed" : decisionCell, ...(sha ? { sha } : {}), evidence });
  }
  return rows;
}

const count = (entries, d) => entries.filter((e) => e.decision === d).length;

/** plan/p2-ledger.md from the JSON ledger. */
export function renderLedgerMd(ledger) {
  const e = ledger.entries;
  const decision = (x) => (x.decision === "fixed" ? `fixed in ${x.sha}` : x.decision);
  const open = e.filter((x) => x.decision === "open");
  return [
    `# ${ledger.title}`,
    "",
    ledger.intro,
    "",
    `**${e.length} comments:** fixed ${count(e, "fixed")} · accepted risk ${count(e, "accepted risk")} · superseded ${count(e, "superseded")} · open ${open.length}.`,
    "",
    ledger.method,
    "",
    "<!-- Written by scripts/p2-ledger.mjs from plan/p2-ledger.json. Do not edit by hand. -->",
    "",
    "| PR | comment | finding (quote) | decision | evidence |",
    "|---|---|---|---|---|",
    ...e.map((x) => `| #${x.pr} | [${x.id}](${x.url}) | ${x.finding} | ${decision(x)} | ${x.evidence} |`),
    "",
    "## Open",
    "",
    ...(open.length ? open.map((x) => `- #${x.pr} ${x.id}: ${x.finding}`) : ["None: every P2 comment has a decision."]),
    "",
  ].join("\n");
}

/**
 * Problems with the JSON ledger. `isCommit(sha)` says whether a fixed
 * entry's commit is in the branch checked (git); leave it out to skip that.
 */
export function ledgerProblems(ledger, { isCommit } = {}) {
  const out = [];
  if (!Array.isArray(ledger?.prs) || !ledger.prs.length) out.push("prs: the PRs the ledger covers");
  if (!Array.isArray(ledger?.entries)) return [...out, "entries: a list"];
  const prs = new Set(ledger.prs ?? []);
  const seen = new Set();
  for (const x of ledger.entries) {
    const w = `#${x.pr} ${x.id}`;
    if (!Number.isInteger(x.id)) out.push(`${w}: id must be the comment's number`);
    if (seen.has(x.id)) out.push(`${w}: listed twice`);
    seen.add(x.id);
    if (!prs.has(x.pr)) out.push(`${w}: PR #${x.pr} is not one of prs`);
    if (x.url !== `https://github.com/talstilkol/lumen-md/pull/${x.pr}#discussion_r${x.id}`) out.push(`${w}: url must be the comment's discussion link`);
    if (!DECISIONS.includes(x.decision)) out.push(`${w}: decision must be one of ${DECISIONS.join(", ")}`);
    if (!String(x.finding ?? "").trim() || !String(x.evidence ?? "").trim()) out.push(`${w}: needs the finding and the evidence`);
    if (/\|/.test(`${x.finding}${x.evidence}`.replace(/\\\|/g, ""))) out.push(`${w}: a "|" in a cell breaks the table`);
    if (x.decision === "fixed") {
      if (!SHA.test(String(x.sha ?? ""))) out.push(`${w}: a fixed entry names its commit (sha)`);
      // A PR rebased into the train carries the fix as another commit with the same subject (`inHead`).
      else if (x.inHead !== undefined && !SHA.test(String(x.inHead))) out.push(`${w}: inHead must be a commit`);
      else if (isCommit && !isCommit(x.sha) && !(x.inHead && isCommit(x.inHead))) out.push(`${w}: commit ${x.sha}${x.inHead ? ` (or ${x.inHead})` : ""} is not in this branch`);
    } else if (x.sha !== undefined || x.inHead !== undefined) out.push(`${w}: only a fixed entry has a sha`);
  }
  return out;
}

/**
 * The ledger against what GitHub has: `comments` are the PRs' review
 * comments as REST returns them ({ id, body, in_reply_to_id, pull_request_url }).
 * → { missing: top-level P2 comments with no entry, unknown: entries GitHub doesn't have as one }.
 */
export function mapping(ledger, comments) {
  const top = comments.filter((c) => !c.in_reply_to_id && isP2(c.body));
  const ids = new Set(top.map((c) => c.id));
  const have = new Set(ledger.entries.map((x) => x.id));
  return {
    missing: top.filter((c) => !have.has(c.id)).map((c) => ({ id: c.id, pr: Number(String(c.pull_request_url ?? "").split("/").pop()), title: firstLine(c.body) })),
    unknown: ledger.entries.filter((x) => !ids.has(x.id)).map((x) => x.id),
  };
}

const firstLine = (body) =>
  String(body ?? "")
    .replace(/<sub>.*<\/sub>/, "")
    .replace(/[*_]/g, "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean) ?? "";

/** The counts plan.json's note quotes: { total, fixed, accepted, superseded, open }. */
export function ledgerCounts(ledger) {
  const e = ledger.entries;
  return { total: e.length, fixed: count(e, "fixed"), accepted: count(e, "accepted risk"), superseded: count(e, "superseded"), open: count(e, "open") };
}
