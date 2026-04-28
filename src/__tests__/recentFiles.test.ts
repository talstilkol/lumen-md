/**
 * Recent files — tests for the hashName function and list management.
 */
import { describe, it, expect } from "vitest";

const MAX = 10;

/** Extracted from src/storage/recent.ts */
function hashName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return `${name}.${h}`;
}

interface RecentFile {
  id: string;
  name: string;
  openedAt: number;
}

/** Simulate pushRecent logic */
function pushRecent(list: RecentFile[], name: string, id?: string): RecentFile[] {
  const resolvedId = id ?? hashName(name);
  const now = Date.now();
  const filtered = list.filter((r) => r.id !== resolvedId);
  return [
    { id: resolvedId, name, openedAt: now },
    ...filtered,
  ].slice(0, MAX);
}

describe("hashName", () => {
  it("produces deterministic hashes", () => {
    expect(hashName("notes.md")).toBe(hashName("notes.md"));
  });

  it("includes the filename in the result", () => {
    const result = hashName("README.md");
    expect(result).toContain("README.md");
  });

  it("produces different hashes for different names", () => {
    expect(hashName("a.md")).not.toBe(hashName("b.md"));
  });

  it("handles empty string", () => {
    expect(hashName("")).toBe(".0");
  });

  it("handles unicode filenames", () => {
    const result = hashName("שלום.md");
    expect(result).toContain("שלום.md");
    expect(typeof result).toBe("string");
  });
});

describe("pushRecent", () => {
  it("adds to the front of the list", () => {
    const list: RecentFile[] = [
      { id: "old", name: "old.md", openedAt: 1000 },
    ];
    const result = pushRecent(list, "new.md", "new");
    expect(result[0].name).toBe("new.md");
    expect(result[1].name).toBe("old.md");
  });

  it("moves existing entry to front (deduplication)", () => {
    const list: RecentFile[] = [
      { id: "a", name: "a.md", openedAt: 3000 },
      { id: "b", name: "b.md", openedAt: 2000 },
      { id: "c", name: "c.md", openedAt: 1000 },
    ];
    const result = pushRecent(list, "c.md", "c");
    expect(result[0].name).toBe("c.md");
    expect(result).toHaveLength(3);
  });

  it("caps at MAX entries", () => {
    const list: RecentFile[] = Array.from({ length: MAX }, (_, i) => ({
      id: `f${i}`, name: `f${i}.md`, openedAt: i * 1000,
    }));
    const result = pushRecent(list, "new.md", "new");
    expect(result).toHaveLength(MAX);
    expect(result[0].name).toBe("new.md");
  });

  it("handles empty list", () => {
    const result = pushRecent([], "first.md");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("first.md");
  });

  it("auto-generates id from hashName when not provided", () => {
    const result = pushRecent([], "test.md");
    expect(result[0].id).toBe(hashName("test.md"));
  });
});
