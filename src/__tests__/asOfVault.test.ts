/**
 * W12.S1 — the vault as of a date, rebuilt from the real history store
 * (deltas + a full text every 20 versions), and searched in a throwaway
 * BM25 index.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import * as history from "../storage/history";
import { coverageFrom, pickAsOf, vaultAsOf, type GitAsOfSource } from "../storage/asOf";
import { buildAsOfIndex, searchAsOf } from "../search/asOfSearch";
import { commitAsOf } from "../sync/gitAsOf";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let run = 0;
beforeEach(() => {
  try {
    globalThis.indexedDB = new IDBFactory();
  } catch {
    // Offline browser runner: the real IndexedDB; each test gets its own vault scope below.
  }
  history.__resetHistoryDb();
  history.setHistoryVault(`as-of-test-${Date.now()}-${run++}`);
});

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

describe("pickAsOf", () => {
  it("takes the newest snapshot at or before the date; the later write wins a tie", () => {
    const s = [
      { id: 1, timestamp: 10 },
      { id: 3, timestamp: 30 },
      { id: 2, timestamp: 20 },
      { id: 4, timestamp: 20 },
    ];
    expect(pickAsOf(s, 5)).toBeNull();
    expect(pickAsOf(s, 20)?.id).toBe(4);
    expect(pickAsOf(s, 29)?.id).toBe(4);
    expect(pickAsOf(s, 30)?.id).toBe(3);
  });
});

describe("vaultAsOf over the real history store", () => {
  it("50 timed edits across 3 notes: the vault at 10 moments is byte-identical to what was saved", async () => {
    const r = rng(7);
    const names = ["Notes/ירושלים.md", "Notes/plan.md", "journal.md"];
    const cur = new Map<string, string>(names.map((n) => [n, `# ${n}\n\nשורה ראשונה\n`]));
    const timeline: Array<{ at: number; state: Map<string, string> }> = [];
    let at = T0;
    for (let i = 0; i < 50; i++) {
      at += Math.floor(r() * 6 * 3_600_000) + 60_000;
      const n = names[Math.floor(r() * names.length)];
      const lines = cur.get(n)!.split("\n");
      const k = Math.floor(r() * lines.length);
      if (r() < 0.6) lines.splice(k, 0, `- עריכה ${i} edit ${Math.floor(r() * 1e6)}`);
      else lines[k] = `${lines[k]} ✎${i}`;
      cur.set(n, lines.join("\n"));
      expect(await history.recordSnapshot(n, cur.get(n)!, "save", at)).toBe(true);
      timeline.push({ at, state: new Map(cur) });
    }
    const enc = new TextEncoder();
    const picks = [0, 4, 9, 15, 21, 27, 33, 40, 46, 49];
    for (const p of picks) {
      // Halfway between this edit and the next: the state after edit p.
      const { at: t, state } = timeline[p];
      const mid = p + 1 < timeline.length ? Math.floor((t + timeline[p + 1].at) / 2) : t + DAY;
      const v = await vaultAsOf(mid);
      for (const [n, text] of state) {
        const firstSave = timeline.findIndex((e) => e.state.get(n) !== `# ${n}\n\nשורה ראשונה\n`);
        if (firstSave > p || firstSave === -1) {
          expect(v.notes.has(n), `${n} had no saved version yet at edit ${p}`).toBe(false);
          continue;
        }
        const got = v.notes.get(n);
        expect(got?.source).toBe("history");
        const a = enc.encode(got!.content);
        const b = enc.encode(text);
        expect(a.length === b.length && a.every((x, j) => x === b[j]), `${n} as of edit ${p}`).toBe(true);
      }
    }
    const v = await vaultAsOf(T0 + 365 * DAY);
    expect(v.historyFrom).toBe(timeline[0].at);
    expect(coverageFrom(v)).toBe(timeline[0].at);
  });

  it("before the first snapshot the vault is empty, and says from when history exists", async () => {
    await history.recordSnapshot("a.md", "alpha", "save", T0);
    const v = await vaultAsOf(T0 - 1);
    expect(v.notes.size).toBe(0);
    expect(v.historyFrom).toBe(T0);
    expect(v.gitFrom).toBeNull();
  });

  it("a git source fills in a note whose history starts later; the newer version wins", async () => {
    await history.recordSnapshot("repo/a.md", "from history", "save", T0 + 10 * DAY);
    const git: GitAsOfSource = async () => ({
      files: [
        { name: "repo/a.md", content: "from git", timestamp: T0 },
        { name: "repo/b.md", content: "only in git", timestamp: T0 },
      ],
      from: T0 - 100 * DAY,
    });
    const early = await vaultAsOf(T0 + DAY, { git });
    expect(early.notes.get("repo/a.md")).toMatchObject({ content: "from git", source: "git" });
    const late = await vaultAsOf(T0 + 20 * DAY, { git });
    expect(late.notes.get("repo/a.md")).toMatchObject({ content: "from history", source: "history" });
    expect(late.notes.get("repo/b.md")?.content).toBe("only in git");
    expect(coverageFrom(late)).toBe(T0 - 100 * DAY);
  });
});

describe("searching the vault as it was", () => {
  it("a search a month back finds a word deleted since; today's vault does not have it", async () => {
    const monthAgo = T0;
    const today = T0 + 31 * DAY;
    await history.recordSnapshot("trip.md", "# טיול\n\nנפגשנו בירושלים ליד השער.\n", "save", monthAgo);
    await history.recordSnapshot("other.md", "# אחר\n\nשום דבר על עיר.\n", "save", monthAgo);
    await history.recordSnapshot("trip.md", "# טיול\n\nנפגשנו ליד השער.\n", "save", today - DAY);

    const then = await vaultAsOf(monthAgo + DAY);
    const hitsThen = await searchAsOf(then, "בירושלים", { worker: null });
    expect(hitsThen.map((h) => h.id)).toEqual(["trip.md"]);
    expect(hitsThen[0].timestamp).toBe(monthAgo);

    const now = await vaultAsOf(today);
    expect(await searchAsOf(now, "בירושלים", { worker: null })).toEqual([]);
  });

  it("the throwaway index is a fresh instance per build", () => {
    const a = buildAsOfIndex([{ name: "x.md", content: "one", timestamp: 0 }]);
    const b = buildAsOfIndex([{ name: "y.md", content: "two", timestamp: 0 }]);
    expect(a).not.toBe(b);
    expect([...a.ids()]).toEqual(["x.md"]);
    expect([...b.ids()]).toEqual(["y.md"]);
  });

  it("a worker that cannot start falls back to searching inline", async () => {
    await history.recordSnapshot("n.md", "שלום עולם", "save", T0);
    const v = await vaultAsOf(T0);
    const hits = await searchAsOf(v, "עולם", {
      worker: () => {
        throw new Error("no workers here");
      },
    });
    expect(hits.map((h) => h.id)).toEqual(["n.md"]);
  });
});

describe("commitAsOf (git log is newest first)", () => {
  const log = [
    { oid: "c3", commit: { committer: { timestamp: 300 } } },
    { oid: "c2", commit: { committer: { timestamp: 200 } } },
    { oid: "c1", commit: { committer: { timestamp: 100 } } },
  ];
  it("picks the newest commit at or before the date (seconds → ms)", () => {
    expect(commitAsOf(log, 99_999)).toBeNull();
    expect(commitAsOf(log, 100_000)).toEqual({ oid: "c1", at: 100_000 });
    expect(commitAsOf(log, 250_000)?.oid).toBe("c2");
    expect(commitAsOf(log, 1e12)?.oid).toBe("c3");
  });
});
