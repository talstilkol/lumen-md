/**
 * Plan W13.S1 — version history at Obsidian Sync's level: a retention
 * policy per vault (30 days / a year / forever, attachments two weeks by
 * default) that never deletes a document's newest version, the space it
 * frees, a bulk restore of deleted files that brings 200 back byte for byte,
 * and a log of renames that can be undone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import * as history from "../storage/history";
import {
  DEFAULT_RETENTION,
  getRetention,
  keepMsFor,
  planRetention,
  runRetention,
  setRetention,
  type RetentionSettings,
  type VersionRef,
} from "../storage/historyRetention";
import { listTrash, moveToTrash, restoreManyFromTrash } from "../storage/trash";
import { listWorkspace, readWorkspaceFile, workspaceHasEntry, writeWorkspaceFile } from "../storage/workspace";
import { safeMove } from "../storage/fileOps";
import { canUndoRename, forgetRenames, listRenames } from "../storage/renameLog";
import { clickSelect, emptySelection, matches, prune, toggleAll } from "../ui/trashSelection";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, swallowed: vi.fn() }));

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 17);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  history.__resetHistoryDb();
  localStorage.clear();
});

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
}

describe("planRetention (property: the newest version of every document always stays)", () => {
  const POLICIES: RetentionSettings[] = [
    { notes: "30d", attachmentDays: 14 },
    { notes: "1y", attachmentDays: 0 },
    { notes: "forever", attachmentDays: 7 },
    { notes: "30d", attachmentDays: 1 },
  ];
  it("2,000 random histories: never the newest, only versions past their keep time, idempotent", () => {
    const r = rng(1234);
    let removedSomewhere = 0;
    for (let run = 0; run < 2000; run++) {
      const s = POLICIES[run % POLICIES.length];
      const docs = 1 + Math.floor(r() * 6);
      const rows: VersionRef[] = [];
      let id = 1;
      for (let d = 0; d < docs; d++) {
        const name = r() < 0.4 ? `att/img${d}.png` : `notes/נ${d}.md`;
        const n = 1 + Math.floor(r() * 12);
        // Ages from minutes to 3 years, ties on purpose (two versions in one ms).
        for (let k = 0; k < n; k++) rows.push({ id: id++, name, timestamp: NOW - Math.floor(r() * 3 * 365) * DAY - (r() < 0.2 ? 0 : Math.floor(r() * DAY)), bytes: 10 });
      }
      // Rows arrive in any order (another tab interleaves).
      rows.sort(() => r() - 0.5);
      const plan = planRetention(rows, s, NOW);
      removedSomewhere += plan.victims.size;
      const byDoc = new Map<string, VersionRef[]>();
      for (const row of rows) byDoc.set(row.name, [...(byDoc.get(row.name) ?? []), row]);
      for (const list of byDoc.values()) {
        const newest = list.reduce((a, b) => (b.timestamp > a.timestamp || (b.timestamp === a.timestamp && b.id > a.id) ? b : a));
        expect(plan.victims.has(newest.id)).toBe(false);
        // Every document keeps at least one version.
        expect(list.some((v) => !plan.victims.has(v.id))).toBe(true);
      }
      for (const row of rows) {
        if (plan.victims.has(row.id)) expect(NOW - row.timestamp).toBeGreaterThan(keepMsFor(row.name, s));
      }
      expect(plan.bytes).toBe(plan.victims.size * 10);
      // Applying it again to what is left removes nothing more.
      const left = rows.filter((x) => !plan.victims.has(x.id));
      expect(planRetention(left, s, NOW).victims.size).toBe(0);
    }
    // The property is not vacuous: the policies did remove versions.
    expect(removedSomewhere).toBeGreaterThan(1000);
  });

  it("forever removes nothing; attachments follow their own days", () => {
    const rows: VersionRef[] = [
      { id: 1, name: "a.md", timestamp: NOW - 900 * DAY },
      { id: 2, name: "a.md", timestamp: NOW },
      { id: 3, name: "p.pdf", timestamp: NOW - 20 * DAY },
      { id: 4, name: "p.pdf", timestamp: NOW - 10 * DAY },
      { id: 5, name: "p.pdf", timestamp: NOW },
    ];
    expect([...planRetention(rows, { notes: "forever", attachmentDays: 0 }, NOW).victims]).toEqual([]);
    expect([...planRetention(rows, DEFAULT_RETENTION, NOW).victims]).toEqual([3]);
    expect([...planRetention(rows, { notes: "1y", attachmentDays: 7 }, NOW).victims].sort()).toEqual([1, 3, 4]);
    expect(planRetention([], DEFAULT_RETENTION, NOW).victims.size).toBe(0);
  });
});

describe("retention settings per vault", () => {
  it("defaults to forever for notes and 14 days for attachments; each vault has its own", () => {
    expect(getRetention("")).toEqual({ notes: "forever", attachmentDays: 14 });
    setRetention("v1", { notes: "30d", attachmentDays: 7 });
    expect(getRetention("v1")).toEqual({ notes: "30d", attachmentDays: 7 });
    expect(getRetention("v2")).toEqual(DEFAULT_RETENTION);
    // Back to the default: the key goes.
    setRetention("v1", DEFAULT_RETENTION);
    expect(localStorage.getItem("lumen.history.retention.v1.v1")).toBeNull();
  });

  it("a damaged stored value reads as the default, and an invalid one is refused", () => {
    localStorage.setItem("lumen.history.retention.v1.default", '{"notes":"5y","attachmentDays":-3}');
    expect(getRetention("")).toEqual(DEFAULT_RETENTION);
    localStorage.setItem("lumen.history.retention.v1.default", "not json");
    expect(getRetention("")).toEqual(DEFAULT_RETENTION);
    expect(() => setRetention("", { notes: "30d", attachmentDays: 1.5 })).toThrow(RangeError);
  });
});

describe("pruneHistory on the real store", () => {
  it("30 days: old versions go, the newest stays even when ancient, and every kept version reads back exactly", async () => {
    const texts: string[] = [];
    // 60 versions of one note, one a day for 60 days (deltas with a full text every 20).
    let text = "# יומן\n";
    for (let i = 0; i < 60; i++) {
      text += `שורה ${i} line ${i}\n`;
      texts.push(text);
      await history.recordSnapshot("journal.md", text, "save", NOW - (59 - i) * DAY);
    }
    // A note last touched two years ago: only its newest version can stay.
    await history.recordSnapshot("old.md", "v1", "save", NOW - 800 * DAY);
    await history.recordSnapshot("old.md", "v2", "save", NOW - 760 * DAY);
    // An attachment-like file (CSV) with three versions over three weeks.
    await history.recordSnapshot("data/t.csv", "a,b\n1,2", "save", NOW - 21 * DAY);
    await history.recordSnapshot("data/t.csv", "a,b\n1,3", "save", NOW - 15 * DAY);
    await history.recordSnapshot("data/t.csv", "a,b\n1,4", "save", NOW - 1 * DAY);

    const s: RetentionSettings = { notes: "30d", attachmentDays: 14 };
    const dry = await history.pruneHistory(s, NOW, { dryRun: true });
    expect(dry.versions).toBe(29 + 1 + 2);
    expect(dry.documents).toBe(3);
    expect(dry.bytes).toBeGreaterThan(0);
    // A dry run changes nothing.
    expect(await history.listSnapshots("journal.md")).toHaveLength(60);

    const done = await history.pruneHistory(s, NOW);
    expect(done.versions).toBe(dry.versions);
    const journal = await history.listSnapshots("journal.md");
    expect(journal).toHaveLength(31);
    // Newest first; every kept version is the exact text written, so no delta lost its base.
    journal.forEach((v, i) => expect(v.content).toBe(texts[59 - i]));
    const old = await history.listSnapshots("old.md");
    expect(old.map((v) => v.content)).toEqual(["v2"]);
    expect((await history.listSnapshots("data/t.csv")).map((v) => v.content)).toEqual(["a,b\n1,4"]);
    // Nothing left to do.
    expect((await history.pruneHistory(s, NOW, { dryRun: true })).versions).toBe(0);
  });

  it("only the active vault's history is pruned", async () => {
    history.setHistoryVault("other");
    await history.recordSnapshot("a.md", "other 1", "save", NOW - 400 * DAY);
    await history.recordSnapshot("a.md", "other 2", "save", NOW);
    history.setHistoryVault("");
    await history.recordSnapshot("a.md", "mine 1", "save", NOW - 400 * DAY);
    await history.recordSnapshot("a.md", "mine 2", "save", NOW);
    setRetention("", { notes: "30d", attachmentDays: 14 });
    expect((await runRetention(NOW))?.versions).toBe(1);
    expect((await history.listSnapshots("a.md")).map((v) => v.content)).toEqual(["mine 2"]);
    history.setHistoryVault("other");
    expect((await history.listSnapshots("a.md")).map((v) => v.content)).toEqual(["other 2", "other 1"]);
    // No vault open: nothing happens.
    history.setHistoryVault(null);
    expect(await runRetention(NOW)).toBeNull();
  });
});

/** SHA-256 through Web Crypto (Node and the browser alike). */
async function sha(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("bulk restore of deleted files", () => {
  beforeEach(() => installFakeOpfs());

  it("200 files deleted in several batches (one folder among them) come back to their place with the same sha256", async () => {
    const before = new Map<string, string>();
    for (let i = 0; i < 200; i++) {
      const dir = i < 40 ? "projects/קורס" : i < 120 ? `notes/${i % 7}` : "inbox";
      const path = `${dir}/פתק ${i} — note ${i}.md`;
      const body = `# ${i}\n${"שָׁלוֹם עוֹלָם ".repeat(1 + (i % 9))}\n‏${i}‎\r\nend`;
      await writeWorkspaceFile(path, body);
      before.set(path, await sha(body));
    }
    // The folder goes as one item; the rest in three batches.
    await moveToTrash(["projects/קורס"], { "projects/קורס": "directory" }, NOW - 3 * DAY);
    const rest = [...before.keys()].filter((p) => !p.startsWith("projects/"));
    await moveToTrash(rest.slice(0, 50), {}, NOW - 2 * DAY);
    await moveToTrash(rest.slice(50, 120), {}, NOW - DAY);
    await moveToTrash(rest.slice(120), {}, NOW);
    for (const p of before.keys()) expect(await workspaceHasEntry(p)).toBe(false);

    const items = await listTrash();
    expect(items).toHaveLength(161);
    const progress: number[] = [];
    const r = await restoreManyFromTrash(
      items.map((i) => i.id),
      (done) => progress.push(done),
    );
    expect(r.failed).toEqual([]);
    expect(r.restored).toHaveLength(161);
    expect(progress.at(-1)).toBe(161);
    for (const [p, h] of before) expect(await sha(await readWorkspaceFile(p)), p).toBe(h);
    expect(await listTrash()).toEqual([]);
    // Nothing else appeared in the vault (no "copy" names, nothing left in .trash but its index).
    const files = (await listWorkspace()).map((f) => f.path).filter((p) => !p.startsWith(".trash/"));
    expect(files.sort()).toEqual([...before.keys()].sort());
  });

  it("restores next to a file that took the old name, and keeps the rest of the trash", async () => {
    await writeWorkspaceFile("a.md", "old A");
    await writeWorkspaceFile("b.md", "B");
    const [a, b] = await moveToTrash(["a.md", "b.md"], {}, NOW);
    await writeWorkspaceFile("a.md", "new A");
    const r = await restoreManyFromTrash([a.id]);
    expect(r.restored[0].path).not.toBe("a.md");
    expect(await readWorkspaceFile(r.restored[0].path)).toBe("old A");
    expect(await readWorkspaceFile("a.md")).toBe("new A");
    expect((await listTrash()).map((i) => i.id)).toEqual([b.id]);
  });
});

describe("renames are logged and can be undone", () => {
  beforeEach(() => installFakeOpfs());

  it("a move is listed; moving it back restores the old name and logs nothing new", async () => {
    await writeWorkspaceFile("ideas/רעיון.md", "x");
    await safeMove("ideas/רעיון.md", "archive/רעיון ישן.md");
    const [e] = await listRenames();
    expect(e).toMatchObject({ from: "ideas/רעיון.md", to: "archive/רעיון ישן.md" });
    expect(await canUndoRename(e)).toBe(true);
    await safeMove(e.to, e.from, { noLog: true });
    await forgetRenames([e.id]);
    expect(await readWorkspaceFile("ideas/רעיון.md")).toBe("x");
    expect(await listRenames()).toEqual([]);
  });

  it("can't undo when the new file is gone or the old name is taken", async () => {
    await writeWorkspaceFile("a.md", "1");
    await safeMove("a.md", "b.md");
    await writeWorkspaceFile("a.md", "someone new");
    const [e] = await listRenames();
    expect(await canUndoRename(e)).toBe(false);
  });
});

describe("multi-select and search", () => {
  const ids = ["a", "b", "c", "d", "e"];
  it("click toggles and sets the anchor; Shift+click selects the range in either direction", () => {
    let s = clickSelect(emptySelection, ids, "b", false);
    s = clickSelect(s, ids, "e", true);
    expect([...s.selected].sort()).toEqual(["b", "c", "d", "e"]);
    // Shift+click above the anchor: the range b..a
    s = clickSelect(emptySelection, ids, "d", false);
    s = clickSelect(s, ids, "a", true);
    expect([...s.selected].sort()).toEqual(["a", "b", "c", "d"]);
    // Anchor turned off: Shift+click clears the range.
    s = clickSelect(s, ids, "c", false); // c off, anchor c
    s = clickSelect(s, ids, "a", true);
    expect([...s.selected].sort()).toEqual(["d"]);
  });

  it("a second Shift+click from the same anchor replaces the range: it grows and shrinks (Finder, Explorer)", () => {
    let s = clickSelect(emptySelection, ids, "a", false);
    s = clickSelect(s, ids, "d", true);
    expect([...s.selected].sort()).toEqual(["a", "b", "c", "d"]);
    s = clickSelect(s, ids, "b", true);
    expect([...s.selected].sort()).toEqual(["a", "b"]);
    // Selections made before, outside the range, stay.
    s = clickSelect(emptySelection, ids, "e", false);
    s = clickSelect(s, ids, "b", false);
    s = clickSelect(s, ids, "c", true);
    s = clickSelect(s, ids, "b", true);
    expect([...s.selected].sort()).toEqual(["b", "e"]);
  });

  it("Shift+click without an anchor is a plain click; select-all toggles the shown rows only", () => {
    expect([...clickSelect(emptySelection, ids, "c", true).selected]).toEqual(["c"]);
    let s = toggleAll(emptySelection, ["a", "b"]);
    expect([...s.selected]).toEqual(["a", "b"]);
    s = toggleAll(s, ["a", "b"]);
    expect(s.selected.size).toBe(0);
    s = prune({ selected: new Set(["a", "z"]), anchor: "z" }, ids);
    expect([...s.selected]).toEqual(["a"]);
    expect(s.anchor).toBeNull();
  });

  it("search ignores niqqud, accents and case", () => {
    expect(matches("notes/שָׁלוֹם.md", "שלום")).toBe(true);
    expect(matches("notes/שלום.md", "שָׁלוֹם")).toBe(true);
    expect(matches("Café/Résumé.md", "resume")).toBe(true);
    expect(matches("a.md", "")).toBe(true);
    expect(matches("a.md", "b")).toBe(false);
  });
});

describe("what counts as an attachment", () => {
  it("matches the sync rules' note list exactly", async () => {
    const { isAttachment } = await import("../sync/e2ee/rules");
    const { isAttachmentPath } = await import("../storage/historyRetention");
    for (const p of ["a.md", "b.MD", "c.markdown", "d.mdx", "e.txt", "f.canvas", "g.base", "h.png", "i.pdf", "j.csv", "noext", ".hidden", "dir.v2/k.json", "שלום.md", "תמונה.jpg"])
      expect(isAttachmentPath(p), p).toBe(isAttachment(p));
  });
});
