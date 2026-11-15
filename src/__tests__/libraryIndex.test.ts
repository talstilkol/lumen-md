/**
 * Plan 7.6 / W10.E36 — the reading library's own embedding index: clips
 * only, updated when a clip is saved, searched by meaning.
 *
 * The embedder here is a synthetic one (hashed character trigrams, 256
 * dimensions), not a model: no embedding model runs offline. It is close
 * for texts that share word pieces, which is enough to test the index's own
 * work (what is indexed, when, with which offsets, how hits are ranked and
 * dropped). The search quality of the real model is measured on the models
 * day (W10.M7).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createMemoryBackend, setVaultBackend } from "../storage/vault";
import { writeWorkspaceFile } from "../storage/workspace";
import { useAppStore } from "../store/useStore";
import { saveClip } from "../commands/domains/research";
import { clipToNote } from "../research/clipper";
import {
  __setLibraryDeps,
  indexClip,
  indexClipOnSave,
  isClip,
  readClip,
  removeClip,
  searchLibrary,
  syncLibrary,
  type LibraryDeps,
  type LibraryIndex,
} from "../research/library/clipIndex";

/** Synthetic embedder: hashed character trigrams of the lower-cased text, L2-normalised. */
function trigramVector(text: string, dims = 256): Float32Array {
  const v = new Float32Array(dims);
  const s = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  for (let i = 0; i + 3 <= s.length; i++) {
    let h = 2166136261;
    for (let j = i; j < i + 3; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619);
    v[(h >>> 0) % dims] += 1;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dims; i++) v[i] /= n;
  return v;
}

function testDeps(id = "test:trigram-256"): LibraryDeps & { stored: LibraryIndex | undefined; embedded: string[]; kinds: string[] } {
  const d = {
    stored: undefined as LibraryIndex | undefined,
    embedded: [] as string[],
    kinds: [] as string[],
    embedder: async () => ({
      id,
      embed: async (texts: string[], kind: "query" | "passage") => {
        d.embedded.push(...texts);
        d.kinds.push(kind);
        return texts.map((t) => trigramVector(t));
      },
    }),
    load: async () => (d.stored ? (JSON.parse(JSON.stringify(d.stored)) as LibraryIndex) : undefined),
    save: async (i: LibraryIndex) => {
      d.stored = JSON.parse(JSON.stringify(i)) as LibraryIndex;
    },
  };
  return d;
}

const DATE = new Date("2026-11-15T10:00:00Z");
const clip = (title: string, source: string, body: string) => clipToNote({ title, source, body, date: DATE });

const BIRDS = clip("נדידת ציפורים בעמק החולה", "https://example.org/birds", "מדי סתיו עוברות בעמק החולה עגורים רבים בדרכם לאפריקה.\n\nהאגם משמש תחנת מנוחה, והחקלאים מאכילים את העגורים כדי שלא יפגעו בשדות.");
const BREAD = clip("Sourdough starter basics", "https://example.com/bread", "Feed the starter flour and water every day. A healthy sourdough starter doubles in size within a few hours.");
const TRAINS = clip("Rail electrification in Israel", "https://example.net/rail", "The electrification of the railway between Tel Aviv and Jerusalem cut travel times and replaced diesel locomotives.");

describe("what a clip is", () => {
  it("in the library folder, or with a clipped: field; title and source from the frontmatter", () => {
    expect(isClip("Library/a.md", "# x")).toBe(true);
    expect(isClip("ספרייה/a.md", "# x")).toBe(true);
    expect(isClip("Clips/news/a.md", BREAD)).toBe(true);
    expect(isClip("notes/a.md", "---\ntitle: x\n---\n# a note")).toBe(false);
    expect(isClip("notes/a.md", "just text with clipped: in it")).toBe(false);
    const r = readClip("Library/Sourdough.md", BREAD);
    expect(r).toMatchObject({ title: "Sourdough starter basics", source: "https://example.com/bread" });
    expect(BREAD.slice(r.offset).startsWith("\n# Sourdough") || BREAD.slice(r.offset).startsWith("# Sourdough")).toBe(true);
    expect(readClip("Library/x.md", "no frontmatter\n").title).toBe("x");
  });
});

describe("the index", () => {
  it("a new clip is found by searching what it is about; the others rank lower", async () => {
    const deps = testDeps();
    await indexClip("Library/birds.md", BIRDS, deps);
    await indexClip("Library/bread.md", BREAD, deps);
    await indexClip("Library/rail.md", TRAINS, deps);
    const hits = await searchLibrary("עגורים בעמק החולה", 3, deps);
    expect(hits[0]).toMatchObject({ path: "Library/birds.md", title: "נדידת ציפורים בעמק החולה", source: "https://example.org/birds" });
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect((await searchLibrary("feeding a sourdough starter", 1, deps))[0].path).toBe("Library/bread.md");
    expect((await searchLibrary("railway electrification", 1, deps))[0].path).toBe("Library/rail.md");
    // Passages are embedded as passages, the query as a query (e5 models use different prefixes).
    expect(deps.kinds.at(-1)).toBe("query");
    expect(deps.kinds.slice(0, 3)).toEqual(["passage", "passage", "passage"]);
  });

  it("each passage's offsets point at its text in the note; the snippet is that text", async () => {
    const deps = testDeps();
    await indexClip("Library/birds.md", BIRDS, deps);
    const entry = deps.stored!.clips["Library/birds.md"];
    for (const c of entry.chunks) expect(BIRDS.slice(c.start, c.end).trim().startsWith(c.preview.slice(0, 40))).toBe(true);
    // The frontmatter is not embedded.
    expect(deps.embedded.join("\n")).not.toContain("clipped:");
  });

  it("an unchanged clip is not embedded again; a changed one is", async () => {
    const deps = testDeps();
    await indexClip("Library/bread.md", BREAD, deps);
    const n = deps.embedded.length;
    await indexClip("Library/bread.md", BREAD, deps);
    expect(deps.embedded.length).toBe(n);
    await indexClip("Library/bread.md", BREAD + "\nRye flour works too.\n", deps);
    expect(deps.embedded.length).toBeGreaterThan(n);
  });

  it("another model: the old vectors are dropped, not compared", async () => {
    const a = testDeps("model:a");
    await indexClip("Library/bread.md", BREAD, a);
    const b = { ...testDeps("model:b"), stored: a.stored };
    b.load = async () => b.stored;
    b.save = async (i) => void (b.stored = i);
    expect(await searchLibrary("sourdough", 5, b)).toEqual([]);
    await indexClip("Library/rail.md", TRAINS, b);
    expect(Object.keys(b.stored!.clips)).toEqual(["Library/rail.md"]);
    expect(b.stored!.embedding).toBe("model:b");
  });

  it("a removed clip is not found; an empty query finds nothing", async () => {
    const deps = testDeps();
    await indexClip("Library/bread.md", BREAD, deps);
    await removeClip("Library/bread.md", deps);
    expect(await searchLibrary("sourdough", 5, deps)).toEqual([]);
    expect(await searchLibrary("   ", 5, deps)).toEqual([]);
  });

  it("sync: clips only (notes are left out), deleted clips dropped, progress reported", async () => {
    const deps = testDeps();
    const vault: Record<string, string> = { "Library/birds.md": BIRDS, "Clips/bread.md": BREAD, "notes/todo.md": "# todo\nsourdough shopping", "img.png": "" };
    const progress: number[] = [];
    expect(await syncLibrary(Object.keys(vault), async (p) => vault[p], deps, (d) => progress.push(d))).toBe(2);
    expect(progress).toEqual([1, 2, 3]);
    expect((await searchLibrary("sourdough", 5, deps)).map((h) => h.path)).toEqual(["Clips/bread.md", "Library/birds.md"]);
    delete vault["Clips/bread.md"];
    expect(await syncLibrary(Object.keys(vault), async (p) => vault[p], deps)).toBe(1);
    expect((await searchLibrary("sourdough", 5, deps)).map((h) => h.path)).toEqual(["Library/birds.md"]);
  });

  it("a failing embedder fails the operation and leaves the stored index as it was", async () => {
    const deps = testDeps();
    await indexClip("Library/bread.md", BREAD, deps);
    const before = JSON.stringify(deps.stored);
    const bad = { ...deps, embedder: async () => ({ id: "test:trigram-256", embed: async () => [] as Float32Array[] }) };
    await expect(indexClip("Library/rail.md", TRAINS, bad)).rejects.toThrow(/returned 0 vectors/);
    expect(JSON.stringify(deps.stored)).toBe(before);
  });
});

describe("updated when a clip is saved", () => {
  beforeEach(() => {
    setVaultBackend(createMemoryBackend());
    useAppStore.setState({ openTabs: [], doc: { name: "Welcome.md", content: "", dirty: false }, locale: "en" });
  });

  it("saving a clip into the library indexes it, and it is found by search right after", async () => {
    const deps = testDeps();
    deps.stored = { embedding: "test:trigram-256", builtAt: 1, clips: {} };
    __setLibraryDeps(deps);
    try {
      await saveClip({ title: "Sourdough starter basics", markdown: BREAD });
      await expect.poll(async () => (await searchLibrary("sourdough starter", 1, deps))[0]?.path, { timeout: 5000 }).toBe("Library/Sourdough starter basics.md");
    } finally {
      __setLibraryDeps(null);
    }
  });

  it("before the library is set up on this device, saving embeds nothing (no model download as a side effect)", async () => {
    const deps = testDeps();
    expect(await indexClipOnSave("Library/a.md", BREAD, deps, async () => false)).toBe(false);
    expect(deps.embedded).toEqual([]);
    // With smart search built here, it does.
    expect(await indexClipOnSave("Library/a.md", BREAD, deps, async () => true)).toBe(true);
    expect(Object.keys(deps.stored!.clips)).toEqual(["Library/a.md"]);
  });

  it("an embedder that throws never fails the save", async () => {
    const deps = testDeps();
    deps.stored = { embedding: "test:trigram-256", builtAt: 1, clips: {} };
    const bad = { ...deps, embedder: async () => Promise.reject(new Error("model download refused")) };
    await expect(indexClipOnSave("Library/a.md", BREAD, bad)).resolves.toBe(false);
  });

  it("a clip already in the vault is picked up by the next sync", async () => {
    await writeWorkspaceFile("Library/rail.md", TRAINS);
    const deps = testDeps();
    const { listWorkspace, readWorkspaceFile } = await import("../storage/workspace");
    const files = (await listWorkspace()).map((e) => e.path);
    expect(await syncLibrary(files, readWorkspaceFile, deps)).toBe(1);
    expect((await searchLibrary("electrification", 1, deps))[0].path).toBe("Library/rail.md");
  });
});
