#!/usr/bin/env node
/**
 * Review 11, M4: two plan files are ratchets, and now something holds them.
 *
 *   plan/wip-frozen.json      the WIP gate's exemptions (W6.39): ids only leave it
 *   plan/audit-verdicts.json  the audit ledger (W10.B12): audits are only appended,
 *                             an audit already in it never changes
 *
 * Each is compared with the same file at a base: the merge base with the branch
 * a PR goes into (`git merge-base HEAD <ref>`), or, where no merge base can be
 * found offline (a shallow or a fresh clone), with plan/ledger-snapshot.json —
 * a committed snapshot of the frozen ids and a sha256 of each audit. A shrink
 * or an append passes against the snapshot too, so it can stay as it is; when
 * it is refreshed (`--snapshot`), the same rule holds the new one against the old.
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

/** The snapshot of the two files. */
export function snapshotOf(frozen, ledger) {
  return {
    about: `Review 11, M4: the base that ${FROZEN_FILE} may only shrink from and ${LEDGER_FILE} may only append to, where no merge base is found (scripts/plan/ledgerRatchet.mjs).`,
    frozen: [...ids(frozen)],
    audits: audits(ledger).map((a) => ({ name: a?.name ?? null, sha256: auditHash(a) })),
  };
}

/** Both checks of `head` against a base given as { frozenIds, auditHashes }. */
export function ratchetProblems(base, headFrozen, headLedger) {
  return [...frozenOnlyShrinks(base.frozenIds, headFrozen), ...auditsOnlyAppend(base.auditHashes, headLedger)];
}

const readJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The base for `root`: the merge base's two files, else the snapshot. */
export function findBase(root, refs = BASE_REFS) {
  const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
  for (const ref of refs) {
    const mb = git("merge-base", "HEAD", ref);
    if (mb.status !== 0 || !mb.stdout.trim()) continue;
    const sha = mb.stdout.trim();
    const show = (f) => {
      const r = git("show", `${sha}:${f}`);
      return r.status === 0 ? readJson(r.stdout) : null;
    };
    const frozen = show(FROZEN_FILE);
    const ledger = show(LEDGER_FILE);
    return { from: `merge base ${sha.slice(0, 10)} with ${ref}`, frozenIds: frozen ? ids(frozen) : null, auditHashes: audits(ledger).map(auditHash) };
  }
  const p = join(root, SNAPSHOT_FILE);
  const snap = existsSync(p) ? readJson(readFileSync(p, "utf8")) : null;
  if (!snap) return null;
  return { from: SNAPSHOT_FILE, frozenIds: Array.isArray(snap.frozen) ? snap.frozen : [], auditHashes: Array.isArray(snap.audits) ? snap.audits.map((a) => a.sha256) : [] };
}

/** Check `root`'s two files; a base with no frozen file yet (null) holds only the ledger. */
export function checkRoot(root, refs = BASE_REFS) {
  const base = findBase(root, refs);
  if (!base) return { from: null, problems: [`no merge base with ${refs.join(" or ")} and no ${SNAPSHOT_FILE}: nothing to hold the two files against`] };
  const head = (f) => (existsSync(join(root, f)) ? readJson(readFileSync(join(root, f), "utf8")) : null);
  const frozen = head(FROZEN_FILE);
  const problems = [...(base.frozenIds ? frozenOnlyShrinks(base.frozenIds, frozen) : []), ...auditsOnlyAppend(base.auditHashes, head(LEDGER_FILE))];
  // The snapshot itself is a ratchet base: it may only follow the files.
  const p = join(root, SNAPSHOT_FILE);
  const snap = existsSync(p) ? readJson(readFileSync(p, "utf8")) : null;
  if (snap) problems.push(...ratchetProblems({ frozenIds: snap.frozen ?? [], auditHashes: (snap.audits ?? []).map((a) => a.sha256) }, frozen, head(LEDGER_FILE)).map((m) => `${m} (against ${SNAPSHOT_FILE})`));
  return { from: base.from, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const argv = process.argv.slice(2);
  if (argv.includes("--snapshot")) {
    const read = (f) => readJson(readFileSync(join(root, f), "utf8"));
    writeFileSync(join(root, SNAPSHOT_FILE), JSON.stringify(snapshotOf(read(FROZEN_FILE), read(LEDGER_FILE)), null, 1) + "\n");
    console.log(`${SNAPSHOT_FILE} written`);
  } else {
    const at = argv.indexOf("--base");
    const r = checkRoot(root, at >= 0 ? [argv[at + 1]] : BASE_REFS);
    for (const p of r.problems) console.error(`ledger-ratchet: ${p}`);
    if (!r.problems.length) console.log(`ledger-ratchet: ${FROZEN_FILE} only shrank and ${LEDGER_FILE} only grew (against ${r.from})`);
    process.exit(r.problems.length ? 1 : 0);
  }
}
