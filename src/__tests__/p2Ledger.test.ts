/**
 * Plan W10.G10 (W1.32): the P2 ledger is data (plan/p2-ledger.json), the
 * markdown is regenerated from it, every fixed entry names a commit that is
 * in the branch, and a P2 comment GitHub has but the ledger lacks is caught.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs module without type declarations
import { isP2, ledgerCounts, ledgerProblems, mapping, parseLedgerMd, renderLedgerMd } from "../../scripts/lib/p2Ledger.mjs";

type Entry = { pr: number; id: number; url: string; finding: string; decision: string; sha?: string; inHead?: string; evidence: string };
const ledger = JSON.parse(readFileSync("plan/p2-ledger.json", "utf8")) as { prs: number[]; entries: Entry[] };
const md = readFileSync("plan/p2-ledger.md", "utf8");
const inHead = (sha: string) => spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"]).status === 0;
const one = (over: Partial<Entry> = {}): Entry => ({ pr: 199, id: 1, url: "https://github.com/talstilkol/lumen-md/pull/199#discussion_r1", finding: "f", decision: "accepted risk", evidence: "e", ...over });

describe("the P2 ledger (W10.G10)", () => {
  it("the committed .md is rendered from the JSON, and parses back to the same entries", () => {
    expect(renderLedgerMd(ledger)).toBe(md);
    const back = parseLedgerMd(md);
    expect(back.map((e: Entry) => e.id)).toEqual(ledger.entries.map((e) => e.id));
    expect(back.map((e: Entry) => e.decision)).toEqual(ledger.entries.map((e) => e.decision));
  });

  it("covers the 12 W1.32 PRs; the JSON is valid and every fixed commit is in this branch", () => {
    expect(ledger.prs).toEqual([199, 201, 202, 204, 210, 211, 218, 225, 231, 232, 235, 238]);
    expect(ledgerProblems(ledger, { isCommit: inHead })).toEqual([]);
    const c = ledgerCounts(ledger);
    expect(c.total).toBe(c.fixed + c.accepted + c.superseded + c.open);
    expect(md).toContain(`**${c.total} comments:** fixed ${c.fixed} · accepted risk ${c.accepted} · superseded ${c.superseded} · open ${c.open}.`);
  });

  it("an open entry is listed under Open; with none, the section says so", () => {
    for (const e of ledger.entries.filter((x) => x.decision === "open")) expect(md).toContain(`- #${e.pr} ${e.id}: ${e.finding}`);
    expect(renderLedgerMd({ ...ledger, title: "t", intro: "i", method: "m", entries: [one()] })).toContain("None: every P2 comment has a decision.");
  });

  it("refuses a fixed entry without its commit, a commit not in the branch, a wrong link, a duplicate and an unknown decision", () => {
    const base = { prs: [199] };
    expect(ledgerProblems({ ...base, entries: [one({ decision: "fixed" })] })).toEqual([expect.stringMatching(/names its commit/)]);
    expect(ledgerProblems({ ...base, entries: [one({ decision: "fixed", sha: "abcdef1" })] }, { isCommit: () => false })).toEqual([expect.stringMatching(/abcdef1 is not in this branch/)]);
    expect(ledgerProblems({ ...base, entries: [one({ decision: "fixed", sha: "abcdef1", inHead: "1234567" })] }, { isCommit: (s: string) => s === "1234567" })).toEqual([]);
    expect(ledgerProblems({ ...base, entries: [one({ url: "https://example.org" })] })).toEqual([expect.stringMatching(/discussion link/)]);
    expect(ledgerProblems({ ...base, entries: [one(), one()] })).toEqual([expect.stringMatching(/listed twice/)]);
    expect(ledgerProblems({ ...base, entries: [one({ decision: "wontfix" })] })).toEqual([expect.stringMatching(/decision must be one of/)]);
    expect(ledgerProblems({ ...base, entries: [one({ sha: "abcdef1" })] })).toEqual([expect.stringMatching(/only a fixed entry has a sha/)]);
    expect(ledgerProblems({ ...base, entries: [one({ pr: 5, url: "https://github.com/talstilkol/lumen-md/pull/5#discussion_r1" })] })).toEqual([expect.stringMatching(/not one of prs/)]);
  });

  it("against GitHub: a top-level P2 comment with no entry is missing, an entry GitHub lacks is unknown, replies and non-P2 comments don't count", () => {
    const l = { prs: [199], entries: [one({ id: 1 }), one({ id: 9, url: "https://github.com/talstilkol/lumen-md/pull/199#discussion_r9" })] };
    const badge = "**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Fix the thing**\n\nbody";
    const comments = [
      { id: 1, body: badge, pull_request_url: "https://api.github.com/repos/x/y/pulls/199" },
      { id: 2, body: badge, pull_request_url: "https://api.github.com/repos/x/y/pulls/199" },
      { id: 3, body: "P2: fixed in abc", in_reply_to_id: 1, pull_request_url: "https://api.github.com/repos/x/y/pulls/199" },
      { id: 4, body: "a P1 finding", pull_request_url: "https://api.github.com/repos/x/y/pulls/199" },
    ];
    expect(mapping(l, comments)).toEqual({ missing: [{ id: 2, pr: 199, title: "Fix the thing" }], unknown: [9] });
    expect(isP2(badge)).toBe(true);
    expect(isP2("item P20")).toBe(false);
    expect(isP2("a P1 finding")).toBe(false);
  });

  it("npm run p2:ledger -- --check passes; --strict fails while an entry is open", () => {
    const r = spawnSync(process.execPath, ["scripts/p2-ledger.mjs", "--check"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const open = ledgerCounts(ledger).open;
    const s = spawnSync(process.execPath, ["scripts/p2-ledger.mjs", "--check", "--strict"], { encoding: "utf8" });
    expect(s.status).toBe(open ? 1 : 0);
  });
});
