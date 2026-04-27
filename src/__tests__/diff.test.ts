/**
 * Tests for the line-level 3-way diff used by the conflict-resolution
 * dialog. Covers identity, one-sided changes, both-sides-same changes,
 * and the genuine-conflict case.
 */

import { describe, it, expect } from "vitest";
import { threeWayDiff, applyMerge } from "../sync/cloud/diff";

describe("threeWayDiff", () => {
  it("returns a single equal hunk when nothing changed", () => {
    const hunks = threeWayDiff("a\nb\nc", "a\nb\nc", "a\nb\nc");
    expect(hunks.every((h) => h.op === "equal")).toBe(true);
  });

  it("flags a local-only insert as op=local", () => {
    const base = "a\nb";
    const local = "a\nNEW\nb";
    const remote = "a\nb";
    const hunks = threeWayDiff(base, local, remote);
    expect(hunks.some((h) => h.op === "local" && h.local.includes("NEW"))).toBe(true);
  });

  it("flags a remote-only insert as op=remote", () => {
    const base = "a\nb";
    const local = "a\nb";
    const remote = "a\nFROM-REMOTE\nb";
    const hunks = threeWayDiff(base, local, remote);
    expect(hunks.some((h) => h.op === "remote" && h.remote.includes("FROM-REMOTE"))).toBe(true);
  });

  it("collapses a both-sides-identical change into op=both", () => {
    const base = "a\nb";
    const change = "a\nSAME\nb";
    const hunks = threeWayDiff(base, change, change);
    expect(hunks.some((h) => h.op === "both" && h.local.includes("SAME"))).toBe(true);
    expect(hunks.every((h) => h.op !== "conflict")).toBe(true);
  });

  it("flags genuinely conflicting inserts at the same point", () => {
    const base = "a\nb";
    const local = "a\nLOCAL\nb";
    const remote = "a\nREMOTE\nb";
    const hunks = threeWayDiff(base, local, remote);
    expect(hunks.some((h) => h.op === "conflict")).toBe(true);
  });

  it("collapses adjacent hunks of the same op", () => {
    const base = "a\nb\nc";
    const local = "a\nx\ny\nz\nb\nc";
    const remote = "a\nb\nc";
    const hunks = threeWayDiff(base, local, remote);
    // The three local-only inserts should fold into one hunk.
    const localHunks = hunks.filter((h) => h.op === "local");
    expect(localHunks.length).toBeLessThanOrEqual(1);
    expect(localHunks[0].local).toEqual(["x", "y", "z"]);
  });
});

describe("applyMerge", () => {
  it("auto-merges non-conflict hunks (equal/local/remote/both)", () => {
    const hunks = threeWayDiff("a\nb", "a\nNEW\nb", "a\nb");
    expect(applyMerge(hunks, [])).toBe("a\nNEW\nb");
  });

  it("respects user picks for conflicts (local)", () => {
    const hunks = threeWayDiff("a\nb", "a\nLOCAL\nb", "a\nREMOTE\nb");
    expect(applyMerge(hunks, ["local"])).toContain("LOCAL");
    expect(applyMerge(hunks, ["local"])).not.toContain("REMOTE");
  });

  it("respects user picks for conflicts (remote)", () => {
    const hunks = threeWayDiff("a\nb", "a\nLOCAL\nb", "a\nREMOTE\nb");
    expect(applyMerge(hunks, ["remote"])).toContain("REMOTE");
    expect(applyMerge(hunks, ["remote"])).not.toContain("LOCAL");
  });

  it("'both' pick keeps local + remote with a separator", () => {
    const hunks = threeWayDiff("a\nb", "a\nLOCAL\nb", "a\nREMOTE\nb");
    const out = applyMerge(hunks, ["both"]);
    expect(out).toContain("LOCAL");
    expect(out).toContain("REMOTE");
    expect(out).toContain(">>> remote >>>");
  });
});
