#!/usr/bin/env node
/**
 * Review 11, M4: the plan's ratchet files, and what holds them.
 *
 *   plan/wip-frozen.json          the WIP gate's exemptions (W6.39): ids only leave it
 *   plan/audit-verdicts.json      the audit ledger (W10.B12): audits are only appended,
 *                                 an audit already in it never changes
 *   plan/merged-while-frozen.json work merged while its wave was frozen (review 12, M2):
 *                                 entries are only appended, never changed
 *   plan/wip-decisions.json       the written WIP decisions (W10.G6; review 12, M3): a
 *                                 decision's open and started only go down, its frozen
 *                                 ids only leave; a start may be added only when it is
 *                                 newly recorded in plan/merged-while-frozen.json
 *
 * Each is compared with the same file at a base. The base is the merge base
 * with the branch a PR goes into (`--base <ref>`, else $BUILDKITE_PULL_REQUEST_BASE_BRANCH
 * or $GITHUB_BASE_REF, else BASE_REFS); when that merge base is HEAD itself (the
 * pushed train, an integration merge) it is HEAD's first parent, HEAD^1 (review
 * 12, M3: it used to compare HEAD with itself there). Where no merge base can be
 * found offline (a shallow or a fresh clone), the base is plan/ledger-snapshot.json,
 * a committed snapshot. A shrink or an append passes against the snapshot too,
 * so it can stay as it is; when it is refreshed (`--snapshot`), the same rule
 * holds the new one against the old. plan:check runs this check, and so does
 * ci:local (`npm run plan:ratchet`).
 *
 *   node scripts/plan/ledgerRatchet.mjs [--base <ref>]   check (exit 1 on a problem)
 *   node scripts/plan/ledgerRatchet.mjs --snapshot      rewrite the snapshot from the files
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FROZEN_FILE = "plan/wip-frozen.json";
export const LEDGER_FILE = "plan/audit-verdicts.json";
export const SNAPSHOT_FILE = "plan/ledger-snapshot.json";
export const MERGED_FILE = "plan/merged-while-frozen.json";
export const DECISIONS_FILE = "plan/wip-decisions.json";
/** Where a PR goes, tried in order for the merge base. */
export const BASE_REFS = ["origin/verify/train-7", "origin/main"];

/** JSON with sorted keys: the same value always hashes the same. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const auditHash = (a) => sha256(canonical(a));

const ids = (frozen) => (frozen && Array.isArray(frozen.started) ? frozen.started.filter((x) => typeof x === "string") : []);
const audits = (ledger) => (ledger && Array.isArray(ledger.audits) ? ledger.audits : []);

/** Problems when `head`'s frozen ids are not a subset of `baseIds`. */
export function frozenOnlyShrinks(baseIds, head) {
  const before = new Set(baseIds);
  const added = ids(head).filter((id) => !before.has(id));
  return added.length ? [`${FROZEN_FILE}: ${added.length} id(s) added (${added.slice(0, 8).join(", ")}); the list only shrinks (W6.39)`] : [];
}

/** Problems when the base's audits (as hashes) are not the first audits of `head`, unchanged. */
export function auditsOnlyAppend(baseHashes, head) {
  const now = audits(head).map(auditHash);
  if (now.length < baseHashes.length) return [`${LEDGER_FILE}: ${baseHashes.length - now.length} audit(s) removed; audits are only appended (W10.B12)`];
  const changed = baseHashes.map((h, i) => (h === now[i] ? null : i)).filter((i) => i !== null);
  return changed.length ? [`${LEDGER_FILE}: audit(s) ${changed.map((i) => `#${i + 1} (${audits(head)[i]?.name ?? "?"})`).join(", ")} changed; an audit in the ledger never changes, a new one is appended (W10.B12)`] : [];
}

const mergedOf = (file) => (file && Array.isArray(file.merged) ? file.merged : []);
const decisionsOf = (file) => (file && Array.isArray(file.decisions) ? file.decisions : []);
const pairKey = (d) => `${d?.wave}→${d?.next}`;

/** Problems when the base's merged-while-frozen entries (as hashes) are not the first entries of `head`, unchanged. */
export function mergedOnlyAppend(baseHashes, head) {
  const now = mergedOf(head).map(auditHash);
  if (now.length < baseHashes.length) return [`${MERGED_FILE}: ${baseHashes.length - now.length} entr(y/ies) removed; the list is append-only (review 12, M2)`];
  const changed = baseHashes.map((h, i) => (h === now[i] ? null : i)).filter((i) => i !== null);
  return changed.length ? [`${MERGED_FILE}: entr(y/ies) ${changed.map((i) => `#${i + 1} (${mergedOf(head)[i]?.id ?? "?"})`).join(", ")} changed; an entry never changes, a new one is appended (review 12, M2)`] : [];
}

/**
 * Problems when a WIP decision loosened against the base's decisions: `open` or
 * `started` went up, or a frozen id was added. The one growth allowed is a task
 * in `newMerged` (ids appended to plan/merged-while-frozen.json since the base):
 * recording merged work makes it count as started in its wave and, while it is
 * ⏳, as open in its own. A pair the base did not have must freeze its
 * `startedIds`, and every one must be in `allowedStarts` (the WIP gate's
 * exemptions and the merged list).
 */
export function decisionsOnlyLower(baseDecisions, headDecisions, newMerged = new Set(), allowedStarts = new Set()) {
  const base = new Map(baseDecisions.map((d) => [pairKey(d), d]));
  const out = [];
  for (const d of headDecisions) {
    const k = pairKey(d);
    const b = base.get(k);
    if (!b) {
      const ids = Array.isArray(d.startedIds) ? d.startedIds : null;
      const outside = ids ? ids.filter((id) => !allowedStarts.has(id)) : [];
      if (!ids) out.push(`${DECISIONS_FILE} ${k}: a new decision freezes its "startedIds" (review 12, M3)`);
      else if (outside.length) out.push(`${DECISIONS_FILE} ${k}: a new decision may only hold starts already exempt or recorded in ${MERGED_FILE}; not ${outside.slice(0, 8).join(", ")}`);
      continue;
    }
    for (const [count, field] of [["open", "openIds"], ["started", "startedIds"]]) {
      const ids = Array.isArray(d[field]) ? d[field] : null;
      const baseIds = Array.isArray(b[field]) ? new Set(b[field]) : null;
      if (baseIds && !ids) {
        out.push(`${DECISIONS_FILE} ${k}: "${field}" was removed; frozen ids stay frozen`);
        continue;
      }
      const grown = ids ? ids.filter((id) => (baseIds ? !baseIds.has(id) : newMerged.has(id))) : [];
      const notMerged = grown.filter((id) => !newMerged.has(id));
      if (baseIds && notMerged.length) out.push(`${DECISIONS_FILE} ${k}: ${notMerged.slice(0, 8).join(", ")} added to "${field}"; frozen ids only leave, unless newly recorded in ${MERGED_FILE}`);
      const room = grown.length - notMerged.length;
      if (Number(d[count]) > Number(b[count]) + room) out.push(`${DECISIONS_FILE} ${k}: "${count}" went up from ${b[count]} to ${d[count]}${room ? ` (only ${room} newly merged task(s) may be added)` : ""}; it only goes down`);
    }
  }
  return out;
}

const slim = (d) => ({ wave: d.wave, next: d.next, open: d.open, started: d.started, ...(Array.isArray(d.openIds) ? { openIds: d.openIds } : {}), ...(Array.isArray(d.startedIds) ? { startedIds: d.startedIds } : {}) });

/** The snapshot of the ratchet files (the last two are optional). */
export function snapshotOf(frozen, ledger, merged = null, decisions = null) {
  return {
    about: `Review 11, M4 and review 12, M3: the base that ${FROZEN_FILE} may only shrink from, ${LEDGER_FILE} and ${MERGED_FILE} may only append to, and ${DECISIONS_FILE} may only lower, where no merge base is found (scripts/plan/ledgerRatchet.mjs).`,
    frozen: [...ids(frozen)],
    audits: audits(ledger).map((a) => ({ name: a?.name ?? null, sha256: auditHash(a) })),
    ...(merged ? { merged: mergedOf(merged).map((e) => ({ id: e?.id ?? null, sha256: auditHash(e) })) } : {}),
    ...(decisions ? { wipDecisions: decisionsOf(decisions).map(slim) } : {}),
  };
}

/** Both checks of `head` against a base given as { frozenIds, auditHashes }. */
export function ratchetProblems(base, headFrozen, headLedger) {
  return [...frozenOnlyShrinks(base.frozenIds, headFrozen), ...auditsOnlyAppend(base.auditHashes, headLedger)];
}

/** The ids appended to the merged list since the base (hashes of the base's entries). */
const newMergedIds = (baseCount, head) => new Set(mergedOf(head).slice(baseCount).map((e) => e?.id).filter(Boolean));

/** The checks of the two review-12 files against a base { mergedHashes, decisions }. */
export function newFileProblems(base, head) {
  const added = newMergedIds(base.mergedHashes.length, head.merged);
  const allowed = new Set([...ids(head.frozen), ...mergedOf(head.merged).map((e) => e?.id)]);
  return [...mergedOnlyAppend(base.mergedHashes, head.merged), ...decisionsOnlyLower(base.decisions, decisionsOf(head.decisions), added, allowed)];
}

const readJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The refs to find the base with: `--base`, else the PR's base branch from the CI environment, else BASE_REFS. */
export function baseRefs(env = process.env) {
  const pr = env.BUILDKITE_PULL_REQUEST_BASE_BRANCH || env.GITHUB_BASE_REF;
  return pr && pr !== "false" ? [`origin/${pr}`, ...BASE_REFS] : BASE_REFS;
}

/**
 * The commit to hold HEAD against for `ref`: the merge base, or HEAD^1 when the
 * merge base is HEAD itself (HEAD is on the train: a pushed head, an integration
 * merge, the integrator's own commit). Null when git can't tell.
 */
export function baseCommit(git, ref) {
  const mb = git("merge-base", "HEAD", ref);
  if (mb.status !== 0 || !mb.stdout.trim()) return null;
  const sha = mb.stdout.trim();
  const head = git("rev-parse", "HEAD").stdout.trim();
  if (sha !== head) return { sha, how: `merge base ${sha.slice(0, 10)} with ${ref}` };
  const parent = git("rev-parse", "--verify", "-q", "HEAD^1");
  if (parent.status === 0 && parent.stdout.trim()) return { sha: parent.stdout.trim(), how: `HEAD^1 ${parent.stdout.trim().slice(0, 10)} (HEAD is on ${ref})` };
  return { sha, how: `merge base ${sha.slice(0, 10)} with ${ref} (HEAD, no parent)` };
}

/** The base for `root`: the base commit's files, else the snapshot. */
export function findBase(root, refs = baseRefs()) {
  const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  for (const ref of refs) {
    const b = baseCommit(git, ref);
    if (!b) continue;
    const show = (f) => {
      const r = git("show", `${b.sha}:${f}`);
      return r.status === 0 ? readJson(r.stdout) : null;
    };
    const frozen = show(FROZEN_FILE);
    const ledger = show(LEDGER_FILE);
    const merged = show(MERGED_FILE);
    // Before plan/wip-decisions.json existed, the decisions were plan.json's schedule.wipDecisions.
    const decisions = show(DECISIONS_FILE) ?? { decisions: show("plan/plan.json")?.schedule?.wipDecisions ?? [] };
    return { from: b.how, frozenIds: frozen ? ids(frozen) : null, auditHashes: audits(ledger).map(auditHash), mergedHashes: mergedOf(merged).map(auditHash), decisions: decisionsOf(decisions) };
  }
  const p = join(root, SNAPSHOT_FILE);
  const snap = existsSync(p) ? readJson(readFileSync(p, "utf8")) : null;
  if (!snap) return null;
  return {
    from: SNAPSHOT_FILE,
    frozenIds: Array.isArray(snap.frozen) ? snap.frozen : [],
    auditHashes: Array.isArray(snap.audits) ? snap.audits.map((a) => a.sha256) : [],
    mergedHashes: Array.isArray(snap.merged) ? snap.merged.map((a) => a.sha256) : [],
    decisions: Array.isArray(snap.wipDecisions) ? snap.wipDecisions : [],
  };
}

/** Check `root`'s ratchet files; a base with no frozen file yet (null) holds the others only. */
export function checkRoot(root, refs = baseRefs()) {
  const base = findBase(root, refs);
  if (!base) return { from: null, problems: [`no merge base with ${refs.join(" or ")} and no ${SNAPSHOT_FILE}: nothing to hold the ratchet files against`] };
  const head = (f) => (existsSync(join(root, f)) ? readJson(readFileSync(join(root, f), "utf8")) : null);
  const frozen = head(FROZEN_FILE);
  const now = { frozen, merged: head(MERGED_FILE), decisions: head(DECISIONS_FILE) ?? { decisions: head("plan/plan.json")?.schedule?.wipDecisions ?? [] } };
  const problems = [...(base.frozenIds ? frozenOnlyShrinks(base.frozenIds, frozen) : []), ...auditsOnlyAppend(base.auditHashes, head(LEDGER_FILE)), ...newFileProblems(base, now)];
  // The snapshot itself is a ratchet base: it may only follow the files.
  const p = join(root, SNAPSHOT_FILE);
  const snap = existsSync(p) ? readJson(readFileSync(p, "utf8")) : null;
  if (snap) {
    const against = (m) => `${m} (against ${SNAPSHOT_FILE})`;
    problems.push(...ratchetProblems({ frozenIds: snap.frozen ?? [], auditHashes: (snap.audits ?? []).map((a) => a.sha256) }, frozen, head(LEDGER_FILE)).map(against));
    if (Array.isArray(snap.merged) || Array.isArray(snap.wipDecisions)) problems.push(...newFileProblems({ mergedHashes: (snap.merged ?? []).map((a) => a.sha256), decisions: snap.wipDecisions ?? [] }, now).map(against));
  }
  return { from: base.from, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const argv = process.argv.slice(2);
  if (argv.includes("--snapshot")) {
    const read = (f) => (existsSync(join(root, f)) ? readJson(readFileSync(join(root, f), "utf8")) : null);
    writeFileSync(join(root, SNAPSHOT_FILE), JSON.stringify(snapshotOf(read(FROZEN_FILE), read(LEDGER_FILE), read(MERGED_FILE) ?? { merged: [] }, read(DECISIONS_FILE) ?? { decisions: [] }), null, 1) + "\n");
    console.log(`${SNAPSHOT_FILE} written`);
  } else {
    const at = argv.indexOf("--base");
    const r = checkRoot(root, at >= 0 ? [argv[at + 1]] : baseRefs());
    for (const p of r.problems) console.error(`ledger-ratchet: ${p}`);
    if (!r.problems.length) console.log(`ledger-ratchet: ${FROZEN_FILE} only shrank, ${LEDGER_FILE} and ${MERGED_FILE} only grew, ${DECISIONS_FILE} only went down (against ${r.from})`);
    process.exit(r.problems.length ? 1 : 0);
  }
}
