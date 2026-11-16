// @vitest-environment node
/**
 * Review 11, M4: the WIP gate counts a task as started once anything records
 * work on it, and its two ratchet files only move one way.
 *
 * - isStarted: a placeholder status with a `verified` level, a `pr` or
 *   `evidence` is started (it used to read only `status`).
 * - plan/wip-frozen.json only shrinks and plan/audit-verdicts.json only
 *   appends, against the merge base (or, offline without one, the committed
 *   plan/ledger-snapshot.json).
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { isStarted } from "../../scripts/plan/build.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { auditHash, auditsOnlyAppend, checkRoot, frozenOnlyShrinks, snapshotOf, FROZEN_FILE, LEDGER_FILE, SNAPSHOT_FILE } from "../../scripts/plan/ledgerRatchet.mjs";

const ROOT = resolve(__dirname, "../..");
const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
const PLACEHOLDER = "⏳ גל 13 — לא התחיל";

describe("isStarted counts recorded work, not only the status (review 11, M4)", () => {
  it("a placeholder with nothing else is not started", () => {
    expect(isStarted({ status: PLACEHOLDER })).toBe(false);
    expect(isStarted({ status: PLACEHOLDER, pr: undefined, evidence: [] })).toBe(false);
  });
  it("a placeholder with a verified level, a PR or evidence is started", () => {
    expect(isStarted({ status: PLACEHOLDER, verified: "node" })).toBe(true);
    expect(isStarted({ status: PLACEHOLDER, verified: "built" })).toBe(true);
    expect(isStarted({ status: PLACEHOLDER, pr: 1076 })).toBe(true);
    expect(isStarted({ status: PLACEHOLDER, evidence: ["a check went green"] })).toBe(true);
    expect(isStarted({ status: PLACEHOLDER, evidence: { tests: "x" } })).toBe(true);
    expect(isStarted({ status: "", pr: 7 })).toBe(true);
  });
});

const audit = (name: string, v: Record<string, string>) => ({ name, at: "2026-11-16", verdicts: v });

describe("the two ratchet files only move one way (review 11, M4)", () => {
  it("frozen ids: removing passes, adding fails", () => {
    expect(frozenOnlyShrinks(["a", "b"], { started: ["a"] })).toEqual([]);
    expect(frozenOnlyShrinks(["a", "b"], { started: ["a", "b", "c"] })[0]).toMatch(/1 id\(s\) added \(c\)/);
  });
  it("audits: appending passes; changing, reordering or removing one fails", () => {
    const one = audit("r2", { "1.1": "PARTIAL" });
    const base = [auditHash(one)];
    expect(auditsOnlyAppend(base, { audits: [one, audit("r3", { "1.1": "DONE" })] })).toEqual([]);
    expect(auditsOnlyAppend(base, { audits: [audit("r2", { "1.1": "DONE" })] })[0]).toMatch(/changed/);
    expect(auditsOnlyAppend(base, { audits: [audit("r3", {}), one] })[0]).toMatch(/changed/);
    expect(auditsOnlyAppend(base, { audits: [] })[0]).toMatch(/removed/);
    // Key order does not matter, the values do.
    expect(auditsOnlyAppend(base, { audits: [{ verdicts: { "1.1": "PARTIAL" }, at: "2026-11-16", name: "r2" }] })).toEqual([]);
  });

  it("this checkout: against its merge base, or the committed snapshot", () => {
    const r = checkRoot(ROOT);
    expect(r.problems).toEqual([]);
    expect(r.from).toBeTruthy();
    const snap = JSON.parse(readFileSync(join(ROOT, SNAPSHOT_FILE), "utf8"));
    const now = snapshotOf(JSON.parse(readFileSync(join(ROOT, FROZEN_FILE), "utf8")), JSON.parse(readFileSync(join(ROOT, LEDGER_FILE), "utf8")));
    // The snapshot may lag (a shrink or an append since), never lead.
    for (const id of now.frozen) expect(snap.frozen).toContain(id);
    expect(now.audits.slice(0, snap.audits.length)).toEqual(snap.audits);
  });

  it("in a clone: a merge base holds both files, and with none the snapshot does", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-ratchet-"));
    scratch.push(dir);
    const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    mkdirSync(join(dir, "plan"));
    for (const f of [FROZEN_FILE, LEDGER_FILE, SNAPSHOT_FILE]) cpSync(join(ROOT, f), join(dir, f));
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("branch", "base");
    const frozen = JSON.parse(readFileSync(join(dir, FROZEN_FILE), "utf8"));
    const ledger = JSON.parse(readFileSync(join(dir, LEDGER_FILE), "utf8"));
    // Against the merge base: one more id fails; one fewer and a new audit pass.
    writeFileSync(join(dir, FROZEN_FILE), JSON.stringify({ ...frozen, started: [...frozen.started, "W13.X1"] }));
    expect(checkRoot(dir, ["base"]).problems.join("\n")).toMatch(/added \(W13\.X1\)/);
    writeFileSync(join(dir, FROZEN_FILE), JSON.stringify({ ...frozen, started: frozen.started.slice(1) }));
    writeFileSync(join(dir, LEDGER_FILE), JSON.stringify({ ...ledger, audits: [...ledger.audits, audit("r3", {})] }));
    expect(checkRoot(dir, ["base"]).problems).toEqual([]);
    // An old verdict edited by hand fails.
    const edited = structuredClone(ledger);
    const first = Object.keys(edited.audits[0].verdicts)[0];
    edited.audits[0].verdicts[first] = edited.audits[0].verdicts[first] === "DONE" ? "PARTIAL" : "DONE";
    writeFileSync(join(dir, LEDGER_FILE), JSON.stringify(edited));
    expect(checkRoot(dir, ["base"]).problems.join("\n")).toMatch(/changed/);
    // No merge base (no such ref offline): the snapshot holds them.
    expect(checkRoot(dir, ["origin/nowhere"]).from).toBe(SNAPSHOT_FILE);
    expect(checkRoot(dir, ["origin/nowhere"]).problems.join("\n")).toMatch(/changed/);
    writeFileSync(join(dir, LEDGER_FILE), JSON.stringify(ledger));
    writeFileSync(join(dir, FROZEN_FILE), JSON.stringify({ ...frozen, started: [...frozen.started, "W13.X2"] }));
    expect(checkRoot(dir, ["origin/nowhere"]).problems.join("\n")).toMatch(/added \(W13\.X2\)/);
  });
});
