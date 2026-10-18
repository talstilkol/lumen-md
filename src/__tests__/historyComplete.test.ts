/**
 * Plan 3.2 — complete history: compressed deltas with a full text every
 * 20 versions (measured: ≤ 10 % of the full text per version over 1000
 * versions), chains that survive pruning, collab snapshots in the same
 * store, the old `backups/` folder migrated, storage state for the panel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import * as history from "../storage/history";
import { applyDelta, decodeDelta, diff, encodeDelta } from "../storage/historyDelta";
import { storageState } from "../storage/persistentStorage";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  history.__resetHistoryDb();
});

/** Deterministic pseudo-random edits on a ~6 KB note. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}
function baseNote(): string {
  const lines: string[] = ["# Meeting notes", ""];
  for (let i = 0; i < 120; i++) lines.push(`- item ${i}: ${"lorem ipsum dolor sit amet ".slice(0, 10 + (i % 17))} שלום ${i}`);
  return lines.join("\n") + "\n";
}
function edit(text: string, r: () => number): string {
  const lines = text.split("\n");
  const n = 1 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const at = Math.floor(r() * lines.length);
    const op = r();
    if (op < 0.5) lines[at] = `${lines[at]} edited ${Math.floor(r() * 1000)}`;
    else if (op < 0.8) lines.splice(at, 0, `- new line ${Math.floor(r() * 1e6)}`);
    else if (lines.length > 10) lines.splice(at, 1);
  }
  return lines.join("\n");
}

describe("deltas", () => {
  it("round-trip random edits exactly", async () => {
    const r = rng(7);
    let a = baseNote();
    for (let i = 0; i < 200; i++) {
      const b = i % 50 === 49 ? "completely different\r\ntext" : edit(a, r);
      const ops = await decodeDelta(await encodeDelta(diff(a, b)));
      expect(applyDelta(a, ops)).toBe(b);
      a = b;
    }
    expect(applyDelta("", diff("", "x"))).toBe("x");
    expect(applyDelta("abc", diff("abc", ""))).toBe("");
  });
});

describe("history store with deltas", () => {
  it("1000 versions cost ≤ 10 % of the full text each, on average, and all read back", async () => {
    const r = rng(42);
    let text = baseNote();
    const written: string[] = [];
    for (let i = 0; i < 1000; i++) {
      text = edit(text, r);
      await history.recordSnapshot("big.md", text, "save", 1_000_000 + i);
      written.push(text);
    }
    const stats = await history.historyStats("big.md");
    expect(stats.versions).toBe(1000);
    const ratio = stats.storedBytes / stats.textBytes;
    // Measured locally: 446,846 bytes stored for 7,647,248 bytes of text (5.8 %).
    expect(ratio).toBeLessThanOrEqual(0.1);
    const list = await history.listSnapshots("big.md");
    expect(list).toHaveLength(1000);
    expect(list[0].content).toBe(written[999]);
    expect(list[500].content).toBe(written[499]);
    expect(list[999].content).toBe(written[0]);
  }, 60_000);

  it("stores a full text every FULL_EVERY versions", async () => {
    let t = "start\n";
    for (let i = 0; i < 45; i++) await history.recordSnapshot("a.md", (t += `line ${i}\n`), "save", i);
    const db = await new Promise<IDBDatabase>((res) => {
      const req = indexedDB.open("lumen-history", 1);
      req.onsuccess = () => res(req.result);
    });
    const rows = await new Promise<Array<{ content?: string }>>((res) => {
      const q = db.transaction("snapshots").objectStore("snapshots").getAll();
      q.onsuccess = () => res(q.result);
    });
    const fullAt = rows.map((row, i) => (typeof row.content === "string" ? i : -1)).filter((i) => i >= 0);
    expect(fullAt).toEqual([0, history.FULL_EVERY, history.FULL_EVERY * 2]);
    db.close();
  });

  it("pruning keeps every remaining version readable (the new oldest becomes a full text)", async () => {
    let t = "x\n";
    for (let i = 0; i < 30; i++) await history.recordSnapshot("a.md", (t += `${i}\n`), "save", i);
    await history.recordSnapshot("b.md", "only", "save", 0);
    await history.pruneOldest(0.3);
    const list = await history.listSnapshots("a.md");
    expect(list.length).toBeGreaterThan(10);
    expect(list.length).toBeLessThan(30);
    expect(list[0].content).toBe(t);
    for (const s of list) expect(s.content.startsWith("x\n")).toBe(true);
    expect((await history.listSnapshots("b.md")).map((s) => s.content)).toEqual(["only"]);
  });

  it("caps a document at MAX_PER_DOC without breaking its chain", async () => {
    let t = "";
    const n = history.MAX_PER_DOC + 25;
    for (let i = 0; i < n; i++) await history.recordSnapshot("c.md", (t = `v${i}\n` + t.slice(0, 200)), "save", i);
    const list = await history.listSnapshots("c.md");
    expect(list).toHaveLength(history.MAX_PER_DOC);
    expect(list[0].content).toBe(t);
    expect(list.at(-1)!.content.startsWith(`v${n - history.MAX_PER_DOC}\n`)).toBe(true);
  }, 60_000);

  it("reads rows written before deltas (full texts) and appends deltas after them", async () => {
    const db = await new Promise<IDBDatabase>((res) => {
      const req = indexedDB.open("lumen-history", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("snapshots", { keyPath: "id", autoIncrement: true }).createIndex("name", "name");
      req.onsuccess = () => res(req.result);
    });
    await new Promise<void>((res) => {
      const tx = db.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").add({ name: "old.md", content: "legacy text\n", timestamp: 1, reason: "save" });
      tx.oncomplete = () => res();
    });
    db.close();
    await history.recordSnapshot("old.md", "legacy text\nmore\n", "save", 2);
    expect((await history.listSnapshots("old.md")).map((s) => s.content)).toEqual(["legacy text\nmore\n", "legacy text\n"]);
  });

  it("records collab snapshots in the same store, with the author", async () => {
    const { useAppStore } = await import("../store/useStore");
    useAppStore.getState().setDoc({ name: "Shared.md", content: "", workspaceName: "team/Shared.md", dirty: false });
    const { recordCollabSnapshot, startSnapshotInterval } = await import("../collab/versionHistory");
    expect(await recordCollabSnapshot("room-1", "peer edit", "Blue Fox", 5)).toBe(true);
    const stop = startSnapshotInterval("room-1", () => "peer edit 2", () => ({ name: "Blue Fox", clientId: 1 }), 60_000);
    stop(); // a session's end records the final text
    await vi.waitFor(async () => expect((await history.listSnapshots("team/Shared.md")).length).toBe(2));
    const [latest, first] = await history.listSnapshots("team/Shared.md");
    expect(first).toMatchObject({ content: "peer edit", reason: "collab", author: "Blue Fox" });
    expect(latest.content).toBe("peer edit 2");
  });

  it("warns past 80 % of the quota", async () => {
    const warn = vi.fn();
    const off = history.onQuotaWarning(warn);
    const storage = navigator.storage;
    Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate: async () => ({ usage: 85, quota: 100 }) } });
    await history.checkQuota(Date.now(), true);
    expect(warn).toHaveBeenCalledWith({ usage: 85, quota: 100 });
    Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate: async () => ({ usage: 10, quota: 100 }) } });
    warn.mockClear();
    await history.checkQuota(Date.now(), true);
    expect(warn).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "storage", { configurable: true, value: storage });
    off();
  });
});

describe("old backups/ folder", () => {
  it("becomes history of the notes it belonged to, then goes to the trash", async () => {
    const { installFakeOpfs } = await import("./helpers/fakeOpfs");
    installFakeOpfs();
    const ws = await import("../storage/workspace");
    const { backupDirName, migrateLegacyBackups } = await import("../sync/autoBackup");
    await ws.writeWorkspaceFile("notes/שלום.md", "current");
    const dir = backupDirName("notes/שלום.md");
    await ws.writeWorkspaceFile(`backups/${dir}/1700000000000.md`, "first");
    await ws.writeWorkspaceFile(`backups/${dir}/1700000600000.md`, "second");
    await ws.writeWorkspaceFile("backups/Gone-0badc0de/1700000000000.md", "orphan");
    expect(await migrateLegacyBackups()).toBe(3);
    const list = await history.listSnapshots("notes/שלום.md");
    expect(list.map((s) => [s.content, s.reason, s.timestamp])).toEqual([
      ["second", "migrated", 1700000600000],
      ["first", "migrated", 1700000000000],
    ]);
    expect((await history.listSnapshots("Gone.md")).map((s) => s.content)).toEqual(["orphan"]);
    expect(await ws.workspaceHasEntry("backups")).toBe(false);
    const { listTrash } = await import("../storage/trash");
    expect((await listTrash()).map((i) => i.originalPath)).toContain("backups");
    expect(await migrateLegacyBackups()).toBe(0);
  });

  it("leaves a backups/ folder that holds the user's own notes", async () => {
    const { installFakeOpfs } = await import("./helpers/fakeOpfs");
    installFakeOpfs();
    const ws = await import("../storage/workspace");
    const { migrateLegacyBackups } = await import("../sync/autoBackup");
    await ws.writeWorkspaceFile("backups/my plan.md", "mine");
    await ws.writeWorkspaceFile("backups/x-12345678/1700000000000.md", "old");
    expect(await migrateLegacyBackups()).toBe(1);
    expect(await ws.readWorkspaceFile("backups/my plan.md")).toBe("mine");
  });
});

describe("storage state", () => {
  it("reports persistence and usage, and copes without the APIs", async () => {
    expect(await storageState({ persisted: async () => true, estimate: async () => ({ usage: 5, quota: 50 }) })).toEqual({ persisted: true, usage: 5, quota: 50 });
    expect(await storageState({ persisted: async () => false })).toEqual({ persisted: false, usage: null, quota: null });
    expect(await storageState(undefined)).toEqual({ persisted: null, usage: null, quota: null });
  });
});
