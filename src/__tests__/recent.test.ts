/**
 * Tests for the "recent files" persistence layer. Recents live in IndexedDB
 * via idb-keyval; the test setup polyfills IDB with fake-indexeddb so we can
 * exercise the real CRUD paths instead of a hand-rolled mock.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { clear } from "idb-keyval";
import { getRecents, pushRecent, removeRecent } from "../storage/recent";

describe("recent files store", () => {
  beforeEach(async () => {
    await clear();
  });

  it("returns an empty array when nothing has ever been pushed", async () => {
    expect(await getRecents()).toEqual([]);
  });

  it("pushRecent prepends the new entry (most-recent-first)", async () => {
    await pushRecent({ name: "first.md" });
    await pushRecent({ name: "second.md" });
    const list = await getRecents();
    expect(list.map((r) => r.name)).toEqual(["second.md", "first.md"]);
  });

  it("re-pushing the same file moves it to the top, not duplicates it", async () => {
    await pushRecent({ name: "a.md" });
    await pushRecent({ name: "b.md" });
    await pushRecent({ name: "a.md" });
    const names = (await getRecents()).map((r) => r.name);
    expect(names).toEqual(["a.md", "b.md"]);
  });

  it("caps the recents list at 10 entries", async () => {
    for (let i = 0; i < 15; i++) {
      await pushRecent({ name: `file-${i}.md` });
    }
    const list = await getRecents();
    expect(list).toHaveLength(10);
    // newest 10 in reverse-insertion order
    expect(list[0].name).toBe("file-14.md");
    expect(list[9].name).toBe("file-5.md");
  });

  it("each entry has a stable id derived from its name", async () => {
    await pushRecent({ name: "stable.md" });
    await pushRecent({ name: "stable.md" });
    const list = await getRecents();
    expect(list).toHaveLength(1); // dedup proves the id is stable
    expect(list[0].id).toBeTruthy();
  });

  it("each entry stamps openedAt with a real timestamp", async () => {
    const t0 = Date.now();
    await pushRecent({ name: "x.md" });
    const t1 = Date.now();
    const [entry] = await getRecents();
    expect(entry.openedAt).toBeGreaterThanOrEqual(t0);
    expect(entry.openedAt).toBeLessThanOrEqual(t1);
  });

  it("removeRecent drops the matching entry and leaves siblings", async () => {
    await pushRecent({ name: "keep.md" });
    await pushRecent({ name: "drop.md" });
    const before = await getRecents();
    const dropId = before.find((r) => r.name === "drop.md")!.id;

    await removeRecent(dropId);
    const after = await getRecents();
    expect(after.map((r) => r.name)).toEqual(["keep.md"]);
  });

  it("removeRecent on an unknown id is a safe no-op", async () => {
    await pushRecent({ name: "a.md" });
    await removeRecent("does-not-exist");
    expect((await getRecents()).map((r) => r.name)).toEqual(["a.md"]);
  });
});
