/**
 * Plan W13.V6 — a vault with big hidden folders (.git, node_modules) opens
 * as fast as one without: the tree, the index and the watcher never walk
 * them, and the status bar says "Indexing 3,200 / 10,000" while a large
 * vault is read, then goes away.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createMemoryBackend } from "../storage/vault/memory";
import { setVaultBackend } from "../storage/vault";
import type { VaultBackend } from "../storage/vault/types";
import { DEFAULT_IGNORED_DIRS, IGNORE_SETTING_KEY, ignoreRule, isIgnoredDir, isUnderIgnoredDir } from "../storage/vault/ignore";
import { listWorkspaceTree, listWorkspace } from "../storage/workspace";
import { listSnapshot, watchExternalChanges, type Snapshot } from "../storage/vault/watcher";
import { mapLimit } from "../storage/workspaceIndexRead";
import { indexProgress, PROGRESS_MIN, subscribeIndexProgress } from "../storage/indexProgress";
import { IndexProgressStatus } from "../ui/IndexProgressStatus";
import { SETTINGS } from "../settings/schema";

const ROOT = resolve(__dirname, "..", "..");

/** A memory vault whose list() calls are counted per folder. */
function counted(): { backend: VaultBackend; lists: string[] } {
  const inner = createMemoryBackend();
  const lists: string[] = [];
  const backend = new Proxy(inner, {
    get(t, k, r) {
      if (k === "list") return (dir: string) => (lists.push(dir), t.list(dir));
      return Reflect.get(t, k, r);
    },
  }) as VaultBackend;
  return { backend, lists };
}

async function notes(b: VaultBackend, n: number) {
  for (let i = 0; i < n; i++) await b.write(`notes/n${i}.md`, `# ${i}\n`);
}

async function bigGit(b: VaultBackend, files: number) {
  for (let i = 0; i < files; i++) await b.write(`.git/objects/${(i % 256).toString(16).padStart(2, "0")}/${i}`, "x");
  for (let i = 0; i < 200; i++) await b.write(`node_modules/pkg${i % 20}/f${i}.js`, "x");
}

beforeEach(() => {
  localStorage.removeItem(IGNORE_SETTING_KEY);
});
afterEach(() => {
  setVaultBackend(null);
});

describe("the ignore rule", () => {
  it("skips version control, packages and Obsidian's cache by default", () => {
    for (const d of [".git", "a/b/.git", "node_modules", "code/node_modules", ".hg", ".svn", ".venv", "x/__pycache__", ".obsidian/cache"]) expect(isIgnoredDir(d), d).toBe(true);
    for (const d of ["notes", ".obsidian", "git", "node_modules2", "a/.obsidian/cache"]) expect(isIgnoredDir(d), d).toBe(false);
    expect(DEFAULT_IGNORED_DIRS).toContain(".git");
  });

  it("takes the user's extra folders and `!name` to walk a default again", () => {
    const r = ignoreRule(JSON.stringify(["Archive/old", "build", "!node_modules"]));
    expect(isIgnoredDir("Archive/old", r)).toBe(true);
    expect(isIgnoredDir("x/build", r)).toBe(true);
    expect(isIgnoredDir("node_modules", r)).toBe(false);
    expect(isIgnoredDir(".git", r)).toBe(true);
    expect(isUnderIgnoredDir("Archive/old/2019/a.md", r)).toBe(true);
    expect(isUnderIgnoredDir("Archive/new.md", r)).toBe(false);
  });

  it("is a device setting in the settings table", () => {
    expect(SETTINGS.find((s) => s.id === IGNORE_SETTING_KEY)).toMatchObject({ store: "local", kind: "setting", type: "list" });
  });
});

describe("opening a vault that is a git repository", () => {
  it("never lists inside .git or node_modules, for the tree or the index's listing", async () => {
    const { backend, lists } = counted();
    await notes(backend, 50);
    await bigGit(backend, 5000);
    setVaultBackend(backend);
    const tree = await listWorkspaceTree({ includeHidden: true, includeAssets: true });
    expect(tree.map((n) => n.name)).toEqual(["notes"]);
    expect(lists.filter((d) => isUnderIgnoredDir(d))).toEqual([]);
    expect((await listWorkspace()).length).toBe(50);
  });

  it("opens in the same time as without the 200,000-file .git (±10%): the same folders are listed", async () => {
    const plain = counted();
    await notes(plain.backend, 2000);
    const repo = counted();
    await notes(repo.backend, 2000);
    await bigGit(repo.backend, 200_000);

    const time = async (b: VaultBackend, lists: string[]) => {
      setVaultBackend(b);
      lists.length = 0;
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) await listWorkspace();
      return { ms: performance.now() - t0, listed: lists.length };
    };
    // Warm both once, then measure.
    await time(plain.backend, plain.lists);
    await time(repo.backend, repo.lists);
    const a = await time(plain.backend, plain.lists);
    const b = await time(repo.backend, repo.lists);
    // The work is identical (a deterministic measure), so the time is too, up to noise.
    expect(b.listed).toBe(a.listed);
    expect(b.ms <= a.ms * 1.1 || b.ms - a.ms < 25, `${b.ms.toFixed(1)} ms with .git vs ${a.ms.toFixed(1)} ms without`).toBe(true);
  }, 120_000);
});

describe("the watcher", () => {
  it("does not list skipped folders when it takes a snapshot", async () => {
    const { backend, lists } = counted();
    await notes(backend, 3);
    await bigGit(backend, 300);
    const snap = await listSnapshot(backend);
    expect([...snap.keys()].sort()).toEqual(["notes/n0.md", "notes/n1.md", "notes/n2.md"]);
    expect(lists.filter((d) => isUnderIgnoredDir(d))).toEqual([]);
  });

  it("drops skipped folders from a snapshot it is given (the desktop's, from Rust)", async () => {
    const backend = createMemoryBackend();
    const seen: string[] = [];
    backend.watch((e) => {
      if (e.origin === "external" && "path" in e) seen.push(e.path);
    });
    let n = 0;
    const snaps: Snapshot[] = [
      new Map([["a.md", { size: 1, mtime: 1 }]]),
      new Map([
        ["a.md", { size: 1, mtime: 1 }],
        [".git/index", { size: 9, mtime: 2 }],
        ["node_modules/x/y.js", { size: 3, mtime: 2 }],
        ["b.md", { size: 2, mtime: 2 }],
      ]),
    ];
    const stop = watchExternalChanges(backend, { snapshot: async () => new Map(snaps[Math.min(n++, 1)]), intervalMs: 5 });
    await new Promise((r) => setTimeout(r, 80));
    stop();
    expect(seen).toEqual(["b.md"]);
  });

  it("an observer record from inside .git does not wake it; one from a note does", () => {
    const src = readFileSync(join(ROOT, "src/storage/vault/watcher.ts"), "utf8");
    expect(src).toMatch(/records\.some\(\(r\) => !r\.relativePathComponents \|\| !isUnderIgnoredDir\(r\.relativePathComponents\.join\("\/"\)\)\)/);
  });
});

describe("the status bar while the index is read", () => {
  it("counts a large batch, then goes away; a small one shows nothing", async () => {
    const states: (string | null)[] = [];
    const off = subscribeIndexProgress(() => {
      const p = indexProgress();
      states.push(p ? `${p.done}/${p.total}` : null);
    });
    await mapLimit(Array.from({ length: 1000 }, (_, i) => i), 16, async () => {
      await Promise.resolve();
    });
    expect(states[0]).toBe("0/1000");
    expect(states).toContain("500/1000");
    expect(states.at(-2)).toBe("1000/1000");
    expect(states.at(-1)).toBeNull();
    // Updates per percent, not per note.
    expect(states.length).toBeLessThanOrEqual(103);
    states.length = 0;
    await mapLimit(Array.from({ length: PROGRESS_MIN - 1 }, (_, i) => i), 16, async () => undefined);
    expect(states).toEqual([]);
    off();
  });

  it("ends even when a read throws", async () => {
    await expect(
      mapLimit(Array.from({ length: 300 }, (_, i) => i), 4, async (i) => {
        if (i === 10) throw new Error("disk");
      }),
    ).rejects.toThrow("disk");
    expect(indexProgress()).toBeNull();
  });

  it("renders 'Indexing done / total' with the locale's digits, and a coarse status for screen readers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = mapLimit(Array.from({ length: 10_000 }, (_, i) => i), 16, async (i) => {
      if (i >= 3200) await gate;
    });
    const { container } = render(createElement(IndexProgressStatus));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const el = container.querySelector('[data-testid="index-progress"]');
    expect(el?.textContent).toMatch(/3,2\d\d \/ 10,000/);
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/25%/);
    await act(async () => {
      release();
      await run;
    });
    expect(container.querySelector('[data-testid="index-progress"]')).toBeNull();
  });

  it("review 14 Low 8: the live region is mounted before indexing starts, and the same element speaks", async () => {
    const { container } = render(createElement(IndexProgressStatus));
    const region = container.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe("");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = mapLimit(Array.from({ length: 1_000 }, (_, i) => i), 8, async (i) => {
      if (i >= 300) await gate;
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(region?.textContent).toMatch(/25%/);
    await act(async () => {
      release();
      await run;
    });
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(region?.textContent).toBe("");
  });

  it("is in the status bar", () => {
    expect(readFileSync(join(ROOT, "src/ui/StatusBar.tsx"), "utf8")).toMatch(/<IndexProgressStatus \/>/);
  });
});
