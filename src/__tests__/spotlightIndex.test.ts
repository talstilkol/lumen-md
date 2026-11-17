/**
 * W13.M3: notes in Spotlight and Siri, by choice. Off by default; "recent"
 * or "all"; a locked note — sealed on disk or unlocked right now — and a
 * private note are never indexed; each sync sends only what changed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCKED_NOTE_MAGIC } from "../storage/lockedNotesRegistry";
import { LIMITS, cachedReader, excluded, noteSnippet, noteTitle, spotlightDiff, spotlightEntries, spotlightMode, syncSpotlight, type NoteFile, type SpotlightPlugin } from "../mobile/spotlightIndex";
import { chooseSpotlightMode } from "../mobile/spotlightActions";
import { parseNativeUrl } from "../mobile/nativeActions";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const note = (path: string, text: string, modified = 1): NoteFile => ({ path, text, modified });
const fake = () => {
  const calls: Array<Parameters<SpotlightPlugin["updateSpotlight"]>[0]> = [];
  const recents: Array<Array<{ path: string; title: string }>> = [];
  const p: SpotlightPlugin = { updateSpotlight: async (o) => void calls.push(o), setRecentNotes: async (o) => void recents.push(o.notes) };
  return { p, calls, recents };
};

describe("what may be indexed", () => {
  it("a locked note is never indexed — sealed on disk, or open and unlocked now", () => {
    expect(excluded(`${LOCKED_NOTE_MAGIC}\nciphertext`, "a.md")).toBe(true);
    expect(excluded("# plain now", "b.md", (p) => p === "b.md")).toBe(true);
    const files = [note("locked.md", `${LOCKED_NOTE_MAGIC}\nxyz`, 9), note("open-locked.md", "# Secret plan\nbody", 8), note("ok.md", "# Shopping\nmilk", 7)];
    const e = spotlightEntries(files, "all", (p) => p === "open-locked.md");
    expect(e.map((x) => x.path)).toEqual(["ok.md"]);
    expect(JSON.stringify(e)).not.toMatch(/Secret|ciphertext/);
  });

  it("front matter spotlight: false or private: true keeps a note out", () => {
    expect(excluded("---\nspotlight: false\n---\nx", "a.md")).toBe(true);
    expect(excluded("---\nprivate: true\n---\nx", "a.md")).toBe(true);
    expect(excluded("---\ntags: [private]\n---\nx", "a.md")).toBe(false);
  });

  it("off by default; recent is the 50 newest; all stops at 5,000; hidden folders and non-notes are skipped", () => {
    expect(spotlightMode(mem())).toBe("off");
    expect(spotlightMode({ getItem: () => { throw new Error("blocked"); } })).toBe("off");
    const files = Array.from({ length: 120 }, (_, i) => note(`n${i}.md`, `# Note ${i}\ntext`, i));
    files.push(note(".obsidian/x.md", "# hidden", 999), note("pic.png", "", 1000));
    expect(spotlightEntries(files, "off")).toEqual([]);
    const recent = spotlightEntries(files, "recent");
    expect(recent).toHaveLength(LIMITS.recent);
    expect(recent[0].path).toBe("n119.md");
    expect(spotlightEntries(files, "all")).toHaveLength(120);
  });
});

describe("what is sent: path, title and a short plain snippet", () => {
  it("titles from front matter, then the first heading, then the file name (Hebrew too)", () => {
    expect(noteTitle("---\ntitle: \"רשימת קניות\"\n---\n# x", "a.md")).toBe("רשימת קניות");
    expect(noteTitle("intro\n## פגישה עם דנה ##\n", "a.md")).toBe("פגישה עם דנה");
    expect(noteTitle("just text", "folder/יומן 2026.md")).toBe("יומן 2026");
  });

  it("snippets drop markup, links' targets and code, and stop at a word", () => {
    const s = noteSnippet("---\nx: 1\n---\n# Title\nSee [[Other note|the other]] and [a link](https://example.com).\n```js\nsecret()\n```\n**bold** text " + "word ".repeat(60));
    expect(s.startsWith("See the other and a link. bold text word")).toBe(true);
    expect(s).not.toMatch(/https|secret|\*\*|```/);
    expect(s.length).toBeLessThanOrEqual(LIMITS.snippet + 1);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("syncs send only the difference", () => {
  it("first sync upserts, an unchanged sync sends nothing, a change and a delete send just those", async () => {
    const f = fake();
    const storage = mem({ "lumen-spotlight": "all" });
    const v1 = [note("a.md", "# A", 1), note("b.md", "# B", 1)];
    expect(await syncSpotlight(f.p, v1, { storage })).toEqual({ upserted: 2, removed: 0 });
    expect(await syncSpotlight(f.p, v1, { storage })).toEqual({ upserted: 0, removed: 0 });
    expect(f.calls).toHaveLength(1);
    expect(await syncSpotlight(f.p, [note("a.md", "# A2", 2)], { storage })).toEqual({ upserted: 1, removed: 1 });
    expect(f.calls[1]).toMatchObject({ upsert: [{ path: "a.md", title: "A2" }], remove: ["b.md"], reset: false });
    expect(f.recents.at(-1)).toEqual([{ path: "a.md", title: "A2" }]);
  });

  it("turning it off removes everything that was indexed, once", async () => {
    const f = fake();
    const storage = mem({ "lumen-spotlight": "recent" });
    await syncSpotlight(f.p, [note("a.md", "# A")], { storage });
    storage.setItem("lumen-spotlight", "off");
    await syncSpotlight(f.p, [note("a.md", "# A")], { storage });
    expect(f.calls.at(-1)).toEqual({ upsert: [], remove: ["a.md"], reset: true });
    const n = f.calls.length;
    await syncSpotlight(f.p, [note("a.md", "# A")], { storage });
    expect(f.calls.length).toBe(n);
  });

  it("locking a note that was indexed removes it on the next sync", async () => {
    const f = fake();
    const storage = mem({ "lumen-spotlight": "all" });
    await syncSpotlight(f.p, [note("a.md", "# Diary", 1)], { storage });
    await syncSpotlight(f.p, [note("a.md", `${LOCKED_NOTE_MAGIC}\nxx`, 2)], { storage });
    expect(f.calls.at(-1)).toMatchObject({ upsert: [], remove: ["a.md"] });
  });

  it("diff by modification time", () => {
    const d = spotlightDiff([{ path: "a", title: "A", snippet: "", modified: 2 }], new Map([["a", 1], ["b", 1]]));
    expect(d.upsert.map((e) => e.path)).toEqual(["a"]);
    expect(d.remove).toEqual(["b"]);
  });
});

describe("10,000 notes", () => {
  it("re-reads only the notes whose mtime changed, and builds the entries quickly", async () => {
    const list = Array.from({ length: 10_000 }, (_, i) => ({ path: `notes/${i}.md`, modified: 1 }));
    let reads = 0;
    const files = cachedReader(async () => list, async (p) => (reads++, `# ${p}\nbody`));
    await files();
    expect(reads).toBe(10_000);
    list[5] = { path: "notes/5.md", modified: 2 };
    const t0 = performance.now();
    const again = await files();
    const entries = spotlightEntries(again, "all");
    const ms = performance.now() - t0;
    expect(reads).toBe(10_001);
    expect(entries).toHaveLength(LIMITS.all);
    expect(ms).toBeLessThan(1500);
  });
});

describe("the choice and the native halves", () => {
  it("the palette command cycles off → recent → all → off and tells the sync", () => {
    const s = mem();
    let told = 0;
    const on = () => told++;
    window.addEventListener("lumen-spotlight-changed", on);
    expect(chooseSpotlightMode(s)).toBe("recent");
    expect(chooseSpotlightMode(s)).toBe("all");
    expect(chooseSpotlightMode(s)).toBe("off");
    window.removeEventListener("lumen-spotlight-changed", on);
    expect(told).toBe(3);
  });

  it("opening a result comes back as lumen://open?path=…", () => {
    expect(parseNativeUrl("lumen://open?path=%D7%99%D7%95%D7%9E%D7%9F%2F2026.md")?.action).toEqual({ kind: "open", path: "יומן/2026.md" });
  });

  it("iOS: NoteEntity is an App Entity, IndexedEntity on 18, with an iOS 26 snippet; the plugin applies syncs", () => {
    const swift = read("ios/App/App/NoteEntity.swift");
    expect(swift).toMatch(/struct NoteEntity: AppEntity/);
    expect(swift).toMatch(/@available\(iOS 18\.0, \*\)\nextension NoteEntity: IndexedEntity \{\}/);
    expect(swift).toMatch(/struct NoteSnippetIntent: SnippetIntent/);
    expect(swift).toMatch(/indexAppEntities/);
    expect(swift).toMatch(/completeFileProtection/);
    expect(read("ios/App/App/LumenNative.swift")).toMatch(/CAPPluginMethod\(name: "updateSpotlight"/);
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).toMatch(/NoteEntity\.swift in Sources/);
  });

  it("Android: recent notes become dynamic App Shortcuts opening lumen://open", () => {
    const java = read("android/app/src/main/java/com/lumen/editor/LumenNativePlugin.java");
    expect(java).toMatch(/public void setRecentNotes\(PluginCall call\)/);
    expect(java).toMatch(/ShortcutManagerCompat\.setDynamicShortcuts/);
    expect(java).toMatch(/authority\("open"\)\.appendQueryParameter\("path", path\)/);
  });
});
