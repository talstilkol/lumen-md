/**
 * Plan W11.S6: a per-device "conflict file" mode, as Obsidian 1.9.7 and
 * Syncthing do it. With sync.conflictMode = file, a note both devices changed
 * is not merged: the path gets the other device's version and this device's
 * version is kept as `<name>.sync-conflict-<YYYYMMDD-HHMMSS>-<device>.md`;
 * both are in the note's history. Other text files: last writer wins, and
 * the losing version is in the history. The mode is this device's only.
 *
 * Runs the real engine (E2eeSync) between two devices over an in-memory
 * provider, and the real history store.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { memoryProvider } from "../sync/e2ee/provider";
import { fileModeResolver, modeResolver, syncConflictPath, type ConflictResolver } from "../sync/e2ee/conflict";
import { CONFLICT_MODE_KEY, loadConflictMode, saveConflictMode } from "../sync/e2ee/conflictMode";
import { listSnapshots } from "../storage/history";
import { joinTrusted, newVault, snapshot } from "./helpers/e2ee";

const ROOT = resolve(__dirname, "..", "..");
const AT = Date.UTC(2026, 9, 20, 14, 5, 9);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

/** A changes `path` and syncs; B changes it too, then B's round meets the conflict. */
async function conflicted(resolver: ConflictResolver, path: string, base: string, onA: string, onB: string) {
  const provider = memoryProvider();
  const a = await newVault(provider);
  a.files.set(path, base);
  await a.sync.sync();
  const b = await joinTrusted("B", provider, resolver, () => AT);
  await b.sync.sync();
  a.files.set(path, onA);
  await a.sync.sync();
  b.files.set(path, onB);
  return { a, b, provider };
}

describe("Syncthing's conflict-file name", () => {
  it("<stem>.sync-conflict-<YYYYMMDD-HHMMSS>-<device>.<ext>, next to the file, free", () => {
    expect(syncConflictPath("notes/יומן.md", AT, "b7f3k2q9zz", () => false)).toBe("notes/יומן.sync-conflict-20261020-140509-B7F3K2Q.md");
    const taken = new Set(["a.sync-conflict-20261020-140509-ABCDEFG.md"]);
    expect(syncConflictPath("a.md", AT, "abcdefgh", (p) => taken.has(p))).toBe("a.sync-conflict-20261020-140509-ABCDEFG-2.md");
    expect(syncConflictPath("README", AT, "B-x_1", () => false)).toBe("README.sync-conflict-20261020-140509-BX1");
    expect(syncConflictPath("x.tar.gz", AT, "", () => false)).toBe("x.tar.sync-conflict-20261020-140509-DEVICE.gz");
  });
});

describe("file mode, through the real engine", () => {
  it("a note: the path gets the other device's version, this device's is a conflict file, both in history, on both devices", async () => {
    const { a, b } = await conflicted(fileModeResolver(), "note.md", "line 1", "line 1\nfrom A", "line 1\nfrom B");
    const r = await b.sync.sync();
    expect(r.conflicts).toEqual(["note.md"]);
    await b.sync.sync(); // uploads the new conflict file
    await a.sync.sync();
    const files = snapshot(b);
    expect(files).toHaveLength(2);
    const [copy, note] = files[0][0] === "note.md" ? [files[1], files[0]] : [files[0], files[1]];
    expect(note).toEqual(["note.md", "line 1\nfrom A"]);
    expect(copy[0]).toMatch(/^note\.sync-conflict-20261020-140509-[A-Z0-9]{1,7}\.md$/);
    expect(copy[1]).toBe("line 1\nfrom B");
    // Nothing was merged, and the other device has the same two files.
    expect(snapshot(a)).toEqual(files);
    // Both versions are in the note's history.
    const history = (await listSnapshots("note.md")).map((s) => s.content);
    expect(history).toEqual(expect.arrayContaining(["line 1\nfrom A", "line 1\nfrom B"]));
  });

  it("a non-Markdown text file: last writer wins (the vault's), and this device's version is in its history", async () => {
    const { a, b } = await conflicted(fileModeResolver(), "board.canvas", '{"nodes":[]}', '{"nodes":["A"]}', '{"nodes":["B"]}');
    await b.sync.sync();
    await a.sync.sync();
    expect(snapshot(b)).toEqual([["board.canvas", '{"nodes":["A"]}']]);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect((await listSnapshots("board.canvas")).map((s) => s.content)).toContain('{"nodes":["B"]}');
  });

  it("a binary file is never dropped: it gets a conflict file", async () => {
    const bin = String.fromCharCode(0) + "img";
    const { a, b } = await conflicted(fileModeResolver(), "pic.png", `${bin} 0`, `${bin} A`, `${bin} B`);
    await b.sync.sync();
    await b.sync.sync();
    await a.sync.sync();
    const paths = snapshot(a).map(([p]) => p);
    expect(paths).toHaveLength(2);
    expect(paths).toContain("pic.png");
    expect(paths.find((p) => p !== "pic.png")).toMatch(/^pic\.sync-conflict-20261020-140509-[A-Z0-9]+\.png$/);
    expect(snapshot(a).map(([, t]) => t).sort()).toEqual([`${bin} A`, `${bin} B`]);
  });

  it("merge mode (the default) still merges a clean change and makes no conflict file", async () => {
    const merged: string[] = [];
    const resolver = modeResolver(() => loadConflictMode(), async (c) => (merged.push(c.path), { kind: "content", data: new TextEncoder().encode("line 1\nfrom A\nfrom B") }));
    const { a, b } = await conflicted(resolver, "note.md", "line 1", "line 1\nfrom A", "line 1\nfrom B");
    await b.sync.sync();
    await a.sync.sync();
    expect(merged).toEqual(["note.md"]);
    expect(snapshot(a)).toEqual([["note.md", "line 1\nfrom A\nfrom B"]]);
  });
});

describe("the mode is this device's only", () => {
  it("defaults to merge, is read at every conflict, and lives in this browser's storage", async () => {
    expect(loadConflictMode()).toBe("merge");
    const seen: string[] = [];
    const r = modeResolver(() => loadConflictMode(), async () => (seen.push("merge"), { kind: "hold" }), async () => (seen.push("file"), { kind: "hold" }));
    const c = { path: "n.md", base: null, local: new Uint8Array([1]), remote: new Uint8Array([2]) };
    await r(c);
    saveConflictMode("file");
    expect(localStorage.getItem(CONFLICT_MODE_KEY)).toBe("file");
    await r(c);
    saveConflictMode("merge");
    expect(localStorage.getItem(CONFLICT_MODE_KEY)).toBeNull();
    await r(c);
    expect(seen).toEqual(["merge", "file", "merge"]);
    // Unreadable storage: merge, never a crash.
    expect(loadConflictMode({ getItem: () => { throw new Error("blocked"); } })).toBe("merge");
  });

  it("is not synced: a device in file mode leaves the other device's mode and the vault untouched", async () => {
    // Two devices, two browsers: B's storage says file, A's says nothing.
    const storageB = new Map<string, string>();
    const bStore = { getItem: (k: string) => storageB.get(k) ?? null, setItem: (k: string, v: string) => void storageB.set(k, v), removeItem: (k: string) => void storageB.delete(k) };
    saveConflictMode("file", bStore);
    const { a, b, provider } = await conflicted(modeResolver(() => loadConflictMode(bStore)), "note.md", "x", "x A", "x B");
    await b.sync.sync();
    await b.sync.sync();
    await a.sync.sync();
    expect(loadConflictMode(bStore)).toBe("file");
    expect(loadConflictMode()).toBe("merge"); // A's own storage
    // Nothing in the vault names the setting: every synced path is a note or its conflict file.
    expect(snapshot(a).map(([p]) => p).every((p) => p === "note.md" || /^note\.sync-conflict-/.test(p))).toBe(true);
    const objects = [...(provider as unknown as { objects: Map<string, { data: Uint8Array }> }).objects.values()].map((o) => new TextDecoder("utf-8", { fatal: false }).decode(o.data));
    expect(objects.some((t) => t.includes(CONFLICT_MODE_KEY))).toBe(false);
  });

  it("the app's session uses the device's mode", () => {
    expect(readFileSync(join(ROOT, "src/sync/e2ee/ui/session.ts"), "utf8")).toMatch(/resolver: deps\.resolver \?\? modeResolver\(\(\) => loadConflictMode\(\)\)/);
    expect(readFileSync(join(ROOT, "src/sync/e2ee/ui/SyncRulesForm.tsx"), "utf8")).toMatch(/saveConflictMode\(mode\)/);
  });
});
