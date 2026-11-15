/**
 * Plan W12.A4 — saved searches in the vault (`.lumen/searches.json`), so they
 * sync between devices, with a one-time move of the old localStorage list;
 * and "Save as Base" for queries whose operators Bases can express.
 *
 * Two devices are two stores, each with its own in-memory vault file and its
 * own localStorage; "sync" copies the file from one vault to the other, as
 * the vault's sync does with any file.
 */
import { describe, it, expect } from "vitest";
import { createSavedSearchStore, LEGACY_KEY, MIGRATED_KEY, parseSearchesFile, SEARCHES_PATH, type SearchesBackend } from "../search/savedSearchStore";
import { queryToBase } from "../search/queryToBase";
import { matchesOps, noteTags, parseQuery } from "../search/queryOps";
import { basesFileFromText, parseBase, runBase } from "../views/bases/base";

const memVault = () => {
  let file: string | null = null;
  const b: SearchesBackend & { get text(): string | null; set text(v: string | null) } = {
    read: async () => file,
    write: async (t) => void (file = t),
    get text() {
      return file;
    },
    set text(v) {
      file = v;
    },
  };
  return b;
};
const memLocal = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
let clock = 1_000;
const tick = () => (clock += 10);

describe("migration from localStorage", () => {
  it("existing searches move into the vault file once, and are never doubled", async () => {
    const vault = memVault();
    const local = memLocal({ [LEGACY_KEY]: JSON.stringify([{ name: "Projects", query: "tag:project" }, { name: "Daily", query: "path:daily/" }]) });
    const s = createSavedSearchStore(vault, local, { now: tick });
    expect(await s.refresh()).toEqual([
      { name: "Projects", query: "tag:project" },
      { name: "Daily", query: "path:daily/" },
    ]);
    expect(SEARCHES_PATH).toBe(".lumen/searches.json");
    expect(parseSearchesFile(vault.text).searches.map((x) => x.query)).toEqual(["tag:project", "path:daily/"]);
    expect(local.m.get(MIGRATED_KEY)).toBe("1");
    expect(local.m.has(LEGACY_KEY)).toBe(false);
    // Opened again (another session, the old key written again by an old tab): nothing is added twice.
    local.m.set(LEGACY_KEY, JSON.stringify([{ name: "Projects", query: "tag:project" }]));
    const again = createSavedSearchStore(vault, local, { now: tick });
    expect((await again.refresh()).map((x) => x.query)).toEqual(["tag:project", "path:daily/"]);
    // A second device with the same old list, merging into the synced file: still one per query.
    const other = createSavedSearchStore(vault, memLocal({ [LEGACY_KEY]: JSON.stringify([{ name: "Projects", query: "tag:project" }, { name: "Mine", query: "tag:mine" }]) }), { now: tick });
    expect((await other.refresh()).map((x) => x.query).sort()).toEqual(["path:daily/", "tag:mine", "tag:project"]);
  });

  it("without a vault nothing is moved, and the old list stays where it was", async () => {
    const local = memLocal({ [LEGACY_KEY]: JSON.stringify([{ name: "a", query: "tag:a" }]) });
    const s = createSavedSearchStore({ ...memVault(), available: () => false }, local);
    await s.refresh();
    expect(local.m.has(LEGACY_KEY)).toBe(true);
    expect(local.m.has(MIGRATED_KEY)).toBe(false);
  });
});

describe("two devices, two vaults, synced", () => {
  it("a search saved on one device appears on the other after sync", async () => {
    const va = memVault();
    const vb = memVault();
    const a = createSavedSearchStore(va, memLocal(), { now: tick });
    const b = createSavedSearchStore(vb, memLocal(), { now: tick });
    a.save("tag:project", "Projects");
    expect(a.list()).toEqual([{ name: "Projects", query: "tag:project" }]); // at once, for the UI
    await a.flush();
    vb.text = va.text; // the vault's sync
    expect(await b.refresh()).toEqual([{ name: "Projects", query: "tag:project" }]);
  });

  it("both devices change the list before syncing: both additions are kept, a removal wins over an older copy", async () => {
    const va = memVault();
    const vb = memVault();
    const a = createSavedSearchStore(va, memLocal(), { now: tick });
    const b = createSavedSearchStore(vb, memLocal(), { now: tick });
    a.save("tag:shared");
    await a.flush();
    vb.text = va.text;
    await b.refresh();
    // Offline from each other: A adds one and removes the shared one; B adds another.
    a.save("tag:from-a");
    a.remove("tag:shared");
    b.save("tag:from-b");
    await a.flush();
    await b.flush();
    // B's file reaches A's vault (B synced last and overwrote): A's next read merges it with what A knows.
    va.text = vb.text;
    const merged = await a.refresh();
    expect(merged.map((x) => x.query).sort()).toEqual(["tag:from-a", "tag:from-b"]);
    vb.text = va.text;
    expect((await b.refresh()).map((x) => x.query).sort()).toEqual(["tag:from-a", "tag:from-b"]);
  });

  it("rename keeps one entry per query; an empty query is not saved", async () => {
    const s = createSavedSearchStore(memVault(), memLocal(), { now: tick });
    s.save("tag:project", "Projects");
    s.save("path:daily/");
    s.save("tag:project", "My projects");
    expect(s.list()).toEqual([
      { name: "My projects", query: "tag:project" },
      { name: "path:daily/", query: "path:daily/" },
    ]);
    expect(s.save("   ")).toBeNull();
    expect(s.isSaved(" tag:project ")).toBe(true);
  });
});

describe("Save as Base", () => {
  // SYNTHETIC notes, to compare the Base with the search on the same files.
  const notes: Record<string, string> = {
    "daily/2026-11-15.md": "---\ntags: [journal]\n---\nA day #project/alpha\n",
    "daily/2026-11-14.md": "Nothing tagged\n",
    "work/plan.md": "---\ntags: [project]\n---\n# Plan\n",
    "work/old.md": "#archive and #project\n",
    "Daily/Notes.md": "#project in a capitalised folder\n",
  };

  const searchHits = (query: string) => {
    const { ops } = parseQuery(query);
    return Object.entries(notes)
      .filter(([path, content]) => matchesOps(ops, { content, lower: content.toLowerCase(), pathLower: path.toLowerCase(), nameLower: path.split("/").pop()!.toLowerCase(), tags: noteTags(content) }))
      .map(([p]) => p)
      .sort();
  };
  const baseHits = (text: string) => {
    const parsed = parseBase(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const files = Object.entries(notes).map(([p, c]) => basesFileFromText(p, c));
    const r = runBase(parsed.base, files);
    expect(r.errors).toEqual([]);
    return r.rows.map((row) => row.file.path).sort();
  };

  for (const q of ["tag:project", "path:daily/", "tag:project path:daily/", "tag:project -tag:archive", "-path:work/ tag:project"]) {
    it(`"${q}" as a Base lists exactly what the search finds`, () => {
      const b = queryToBase(q, q);
      expect(b.ok).toBe(true);
      if (b.ok) expect(baseHits(b.text)).toEqual(searchHits(q));
    });
  }

  it("a query that searches the text stays a saved search, with the reason", () => {
    expect(queryToBase("x", 'tag:project "exact words"')).toEqual({ ok: false, unsupported: ['"exact words"'] });
    expect(queryToBase("x", "budget tag:project")).toMatchObject({ ok: false, unsupported: ["budget"] });
    expect(queryToBase("x", "/reg.x/ path:a")).toMatchObject({ ok: false, unsupported: ["/reg.x/"] });
    expect(queryToBase("x", "tag:a -draft")).toMatchObject({ ok: false, unsupported: ["-draft"] });
  });
});
