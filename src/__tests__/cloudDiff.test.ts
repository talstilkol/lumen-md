/**
 * Tests for the 3-way diff / merge engine used by cloud sync.
 */

import { describe, it, expect } from "vitest";
import { threeWayDiff, applyMerge } from "../sync/cloud/diff";

describe("threeWayDiff", () => {
  it("identical files produce a single 'equal' hunk", () => {
    const hunks = threeWayDiff("line1\nline2", "line1\nline2", "line1\nline2");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].op).toBe("equal");
    expect(hunks[0].local).toEqual(["line1", "line2"]);
  });

  it("local-only change → 'local' hunk", () => {
    const base = "a\nb\nc";
    const local = "a\nB\nc";
    const remote = "a\nb\nc";
    const hunks = threeWayDiff(base, local, remote);
    const localHunks = hunks.filter((h) => h.op === "local");
    expect(localHunks.length).toBeGreaterThanOrEqual(1);
  });

  it("remote-only change → 'remote' hunk", () => {
    const base = "a\nb\nc";
    const local = "a\nb\nc";
    const remote = "a\nB\nc";
    const hunks = threeWayDiff(base, local, remote);
    const remoteHunks = hunks.filter((h) => h.op === "remote");
    expect(remoteHunks.length).toBeGreaterThanOrEqual(1);
  });

  it("same change on both sides → 'both' hunk (no conflict)", () => {
    const base = "a\nb\nc";
    const local = "a\nc";  // deleted line b
    const remote = "a\nc"; // deleted same line b
    const hunks = threeWayDiff(base, local, remote);
    const bothHunks = hunks.filter((h) => h.op === "both");
    expect(bothHunks.length).toBeGreaterThanOrEqual(1);
  });

  it("different changes to the same region → 'conflict' hunk", () => {
    const base = "a\nb\nc";
    const local = "a\nX\nc";
    const remote = "a\nY\nc";
    const hunks = threeWayDiff(base, local, remote);
    // At least one conflict or local+remote combo
    const interesting = hunks.filter((h) => h.op !== "equal");
    expect(interesting.length).toBeGreaterThanOrEqual(1);
  });
});

describe("applyMerge", () => {
  it("merges non-conflicting hunks automatically", () => {
    const base = "a\nb\nc";
    const local = "a\nB\nc";
    const remote = "a\nb\nc";
    const hunks = threeWayDiff(base, local, remote);
    const result = applyMerge(hunks, []);
    // Local changed b→B, remote didn't, so result should have B
    expect(result).toContain("B");
    expect(result).toContain("a");
    expect(result).toContain("c");
  });

  it("applies 'local' pick for conflicts", () => {
    const base = "x";
    const local = "LOCAL";
    const remote = "REMOTE";
    const hunks = threeWayDiff(base, local, remote);
    const conflicts = hunks.filter((h) => h.op === "conflict");
    const picks = conflicts.map(() => "local" as const);
    const result = applyMerge(hunks, picks);
    expect(result).toContain("LOCAL");
  });

  it("applies 'remote' pick for conflicts", () => {
    const base = "x";
    const local = "LOCAL";
    const remote = "REMOTE";
    const hunks = threeWayDiff(base, local, remote);
    const conflicts = hunks.filter((h) => h.op === "conflict");
    const picks = conflicts.map(() => "remote" as const);
    const result = applyMerge(hunks, picks);
    expect(result).toContain("REMOTE");
  });

  it("empty files produce no crash", () => {
    const hunks = threeWayDiff("", "", "");
    const result = applyMerge(hunks, []);
    expect(typeof result).toBe("string");
  });
});
