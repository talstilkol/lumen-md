/**
 * VersionHistory — tests for snapshot deduplication and pruning logic.
 */
import { describe, it, expect } from "vitest";

const MAX_SNAPSHOTS = 50;

interface Snapshot {
  id: number;
  name: string;
  content: string;
  timestamp: number;
}

/** Should we save? Returns false if content matches latest snapshot. */
function shouldSave(existing: Snapshot[], content: string): boolean {
  const latest = existing.sort((a, b) => b.timestamp - a.timestamp)[0];
  return !(latest && latest.content === content);
}

/** Which IDs should be pruned? */
function snapshotsToPrune(existing: Snapshot[]): number[] {
  if (existing.length < MAX_SNAPSHOTS) return [];
  const oldest = [...existing].sort((a, b) => a.timestamp - b.timestamp);
  const excess = oldest.length - MAX_SNAPSHOTS + 1;
  return oldest.slice(0, excess).map((s) => s.id);
}

/** Diff chars calculation */
function diffChars(selected: string, current: string): number {
  return Math.abs(selected.length - current.length);
}

describe("shouldSave", () => {
  it("returns true when no existing snapshots", () => {
    expect(shouldSave([], "content")).toBe(true);
  });

  it("returns false when content matches latest", () => {
    const existing: Snapshot[] = [
      { id: 1, name: "test", content: "hello", timestamp: 1000 },
      { id: 2, name: "test", content: "hello", timestamp: 2000 },
    ];
    expect(shouldSave(existing, "hello")).toBe(false);
  });

  it("returns true when content differs from latest", () => {
    const existing: Snapshot[] = [
      { id: 1, name: "test", content: "hello", timestamp: 1000 },
    ];
    expect(shouldSave(existing, "hello world")).toBe(true);
  });

  it("compares against most recent by timestamp, not id", () => {
    const existing: Snapshot[] = [
      { id: 5, name: "test", content: "old", timestamp: 1000 },
      { id: 1, name: "test", content: "new", timestamp: 5000 },
    ];
    expect(shouldSave(existing, "new")).toBe(false);
    expect(shouldSave(existing, "old")).toBe(true);
  });
});

describe("snapshotsToPrune", () => {
  it("returns empty when under limit", () => {
    const snapshots: Snapshot[] = Array.from({ length: 10 }, (_, i) => ({
      id: i, name: "test", content: `v${i}`, timestamp: i * 1000,
    }));
    expect(snapshotsToPrune(snapshots)).toEqual([]);
  });

  it("returns oldest IDs when at limit", () => {
    const snapshots: Snapshot[] = Array.from({ length: MAX_SNAPSHOTS }, (_, i) => ({
      id: i, name: "test", content: `v${i}`, timestamp: i * 1000,
    }));
    const pruned = snapshotsToPrune(snapshots);
    expect(pruned.length).toBe(1);
    expect(pruned[0]).toBe(0); // oldest by timestamp
  });

  it("returns multiple oldest when well over limit", () => {
    const count = MAX_SNAPSHOTS + 5;
    const snapshots: Snapshot[] = Array.from({ length: count }, (_, i) => ({
      id: i, name: "test", content: `v${i}`, timestamp: i * 1000,
    }));
    const pruned = snapshotsToPrune(snapshots);
    expect(pruned.length).toBe(6); // count - MAX + 1
  });
});

describe("diffChars", () => {
  it("returns 0 for identical length", () => {
    expect(diffChars("hello", "world")).toBe(0);
  });

  it("returns difference in length", () => {
    expect(diffChars("hello world", "hi")).toBe(9);
  });

  it("handles empty strings", () => {
    expect(diffChars("", "hello")).toBe(5);
  });
});
