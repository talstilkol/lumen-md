/**
 * W12.S1, wave g5: the git half of "What I knew then" reaches the dialog.
 *
 * `vaultAsOf` could already take a git log as a second source (asOfVault
 * test), but the dialog called it without one, so a vault cloned from git
 * showed nothing before the day Lumen was installed. The dialog's loader
 * (src/storage/asOfLoad.ts) now lists the cloned repositories and adds
 * their log. The repositories and the log here are SYNTHETIC (in memory);
 * the history store is the real one (IndexedDB).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import * as history from "../storage/history";
import { coverageFrom, type GitAsOfSource } from "../storage/asOf";
import { makeAsOfLoad } from "../storage/asOfLoad";
import { readFileSync } from "node:fs";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let run = 0;
beforeEach(() => {
  try {
    globalThis.indexedDB = new IDBFactory();
  } catch {
    // why: offline browser runner: the real IndexedDB; each test gets its own vault scope below.
  }
  history.__resetHistoryDb();
  history.setHistoryVault(`as-of-git-${Date.now()}-${run++}`);
});

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);

const gitLog = (calls: number[]): GitAsOfSource => async (date) => {
  calls.push(date);
  return {
    files: date >= T0 - 30 * DAY ? [{ name: "repo/notes/idea.md", content: "# רעיון\n\nהגרסה מ-git, לפני ההתקנה.\n", timestamp: T0 - 30 * DAY }] : [],
    from: T0 - 60 * DAY,
  };
};

describe("the As-of dialog's loader", () => {
  it("with a cloned repository: a note from before the history store is there, and history starts at the first commit", async () => {
    await history.recordSnapshot("repo/notes/idea.md", "# רעיון\n\nאחרי ההתקנה.\n", "save", T0 + DAY);
    const calls: number[] = [];
    const repos = vi.fn(async () => ["repo"]);
    const load = makeAsOfLoad({ repos, gitSource: () => gitLog(calls) });
    const before = await load(T0 - 10 * DAY);
    expect(before.notes.get("repo/notes/idea.md")).toMatchObject({ source: "git" });
    expect(before.notes.get("repo/notes/idea.md")!.content).toContain("לפני ההתקנה");
    expect(coverageFrom(before)).toBe(T0 - 60 * DAY);
    const after = await load(T0 + 2 * DAY);
    expect(after.notes.get("repo/notes/idea.md")).toMatchObject({ source: "history", content: "# רעיון\n\nאחרי ההתקנה.\n" });
    // Listed once per dialog, not once per move of the slider.
    expect(repos).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([T0 - 10 * DAY, T0 + 2 * DAY]);
  });

  it("no repository: history only, and git is never loaded", async () => {
    await history.recordSnapshot("a.md", "x", "save", T0);
    const gitSource = vi.fn();
    const v = await makeAsOfLoad({ repos: async () => [], gitSource })(T0 + DAY);
    expect(v.notes.get("a.md")?.content).toBe("x");
    expect(v.gitFrom).toBeNull();
    expect(gitSource).not.toHaveBeenCalled();
  });

  it("a repository list or a log that fails is no git, never an empty dialog", async () => {
    await history.recordSnapshot("a.md", "x", "save", T0);
    const listFails = await makeAsOfLoad({ repos: async () => Promise.reject(new Error("no /git")), gitSource: vi.fn() })(T0 + DAY);
    expect(listFails.notes.get("a.md")?.content).toBe("x");
    const logFails = await makeAsOfLoad({ repos: async () => ["repo"], gitSource: () => async () => Promise.reject(new Error("broken clone")) })(T0 + DAY);
    expect(logFails.notes.get("a.md")?.content).toBe("x");
  });

  it("the dialog uses it when no loader is passed", () => {
    const src = readFileSync("src/ui/AsOfDialog.tsx", "utf8");
    expect(src).toMatch(/makeAsOfLoad\(\)/);
    expect(src).toMatch(/const load = loadProp \?\? defaultLoad/);
  });
});
