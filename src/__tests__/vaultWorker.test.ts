/**
 * Plan 8.4 — a large vault and a long document.
 *
 * A 10,000-note in-memory vault (the VaultBackend reference
 * implementation) behind the workspace index, driven through the same
 * message protocol the index worker speaks (a fake Worker here: jsdom has
 * none). The work is counted, not timed: a save reads one note and
 * re-indexes one note, a rename or delete reads none, backlinks read only
 * the linking notes. Wall-clock limits appear only where the work is a
 * few milliseconds and the margin is wide.
 *
 * The incremental outline and preview are checked against the one-pass
 * versions they replace, on random documents and random edits.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryBackend, setVaultBackend, type VaultBackend } from "../storage/vault";
import { writeWorkspaceFile } from "../storage/workspace";
import { notifyWorkspaceChanged } from "../storage/workspaceEvents";
import {
  __resetWorkspaceIndex,
  ensureIndex,
  findBacklinks,
  indexedFiles,
  indexStats,
  REVALIDATE_MS,
  searchWorkspace,
  workspaceTree,
} from "../storage/workspaceIndex";
import { VaultIndex, foldForSearch, fuzzyMatch, snippetAround, type IndexInput } from "../storage/vaultIndexCore";
import { workerEngine, type IndexRequest, type IndexResponse, type WorkerLike } from "../storage/vaultIndexProtocol";
import { handleIndexRequest, localEngine } from "../storage/vaultIndexLocal";
import { hasHebrew, hebrewFind, normalizeWithMap } from "../text/hebrew";
import { noteKey } from "../lib/slug";
import { BlockTracker, splitBlocks } from "../renderer/blocks";
import { IncrementalToc } from "../renderer/incrementalToc";
import { IncrementalPreview, canRenderInBlocks, withoutCode } from "../renderer/incrementalPreview";
import { extractToc, renderMarkdown } from "../renderer/pipeline";
import { bestChunk, packVectors } from "../ai/semanticSearch";
import { LARGE_VAULT_FOLDER_ROWS, visibleChildren } from "../ui/FileTree";
import type { WorkspaceNode } from "../storage/workspace";

const N = 10_000;

/** A worker that answers through the real protocol, with a structured-clone-like copy each way. */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<IndexResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private readonly index = new VaultIndex();
  crashOnNext = false;
  terminate(): void {}
  postMessage(message: IndexRequest): void {
    const req = JSON.parse(JSON.stringify(message)) as IndexRequest;
    queueMicrotask(() => {
      if (this.crashOnNext) {
        this.onerror?.({ message: "boom", preventDefault() {} } as ErrorEvent);
        return;
      }
      this.onmessage?.({ data: JSON.parse(JSON.stringify(handleIndexRequest(this.index, req))) } as MessageEvent<IndexResponse>);
    });
  }
}

/** The memory backend, counting the file reads that go through it. */
function countingBackend(): { backend: VaultBackend; reads: () => number } {
  const inner = createMemoryBackend();
  let reads = 0;
  const backend: VaultBackend = {
    ...inner,
    read: (p) => {
      reads++;
      return inner.read(p);
    },
    readText: (p) => {
      reads++;
      return inner.readText(p);
    },
  };
  return { backend, reads: () => reads };
}

const notePath = (i: number) => `notes/${Math.floor(i / 500)}/n${i}.md`;

describe("the workspace index over a 10,000-note vault (worker protocol)", () => {
  let vault: ReturnType<typeof countingBackend>;
  let previous: VaultBackend | null;
  let worker: FakeWorker;

  beforeAll(async () => {
    vault = countingBackend();
    previous = setVaultBackend(vault.backend);
    worker = new FakeWorker();
    __resetWorkspaceIndex(() => workerEngine(worker));
    for (let i = 0; i < N; i++) {
      const hebrew = i % 10 === 0 ? "\nשָׁלוֹם עולם" : "";
      await vault.backend.write(notePath(i), `# Note ${i}\nlinks to [[n${(i + 1) % N}]] word${i}${hebrew}\n`);
    }
  }, 120_000);

  afterAll(() => {
    __resetWorkspaceIndex();
    setVaultBackend(previous);
  });

  it("builds once, reading every note once", async () => {
    const before = vault.reads();
    await ensureIndex();
    expect(vault.reads() - before).toBe(N);
    const stats = await indexStats();
    expect(stats).toMatchObject({ files: N, indexed: N, engine: "worker" });
    expect(indexedFiles()).toHaveLength(N);
  }, 120_000);

  it("a save reads and re-indexes only the saved note — O(changed file)", async () => {
    const before = { reads: vault.reads(), stats: await indexStats() };
    await writeWorkspaceFile(notePath(1), "# Note 1\nnow about zebracorns and [[n42]]\n");
    notifyWorkspaceChanged({ kind: "content", paths: [notePath(1)] });
    const t0 = performance.now();
    await ensureIndex();
    const ms = performance.now() - t0;
    expect(vault.reads() - before.reads).toBe(1);
    const after = await indexStats();
    expect(after.indexed - before.stats.indexed).toBe(1);
    expect(after.files).toBe(N);
    // One note: a few milliseconds; 50 ms is the acceptance budget.
    expect(ms).toBeLessThan(50);
    expect((await searchWorkspace("zebracorns")).map((h) => h.path)).toEqual([notePath(1)]);
  });

  it("backlinks read only the notes that link to the target", async () => {
    const before = (await indexStats()).backlinkReads;
    const hits = await findBacklinks(notePath(42));
    expect(hits.map((h) => h.fromPath).sort()).toEqual([notePath(1), notePath(41)].sort());
    expect((await indexStats()).backlinkReads - before).toBe(2);
  });

  it("search answers from the index: word, Hebrew (prefix + niqqud), path filter", async () => {
    const t0 = performance.now();
    const word = await searchWorkspace("word4321");
    expect(performance.now() - t0).toBeLessThan(100);
    expect(word[0].path).toBe(notePath(4321));
    expect(word[0].snippet).toContain("word4321");
    const hebrew = await searchWorkspace("והעולם", { limit: 5 });
    expect(hebrew).toHaveLength(5);
    expect(hebrew[0].snippet!.slice(hebrew[0].match!.start, hebrew[0].match!.end)).toBe("עולם");
    const scoped = await searchWorkspace("note", { filter: (p) => p.startsWith("notes/3/"), limit: 1000 });
    expect(scoped.length).toBe(500);
    expect(scoped.every((h) => h.path.startsWith("notes/3/"))).toBe(true);
  });

  it("a rename moves entries and a delete drops them — nothing is read", async () => {
    const before = { reads: vault.reads(), indexed: (await indexStats()).indexed };
    await vault.backend.rename("notes/19", "archive/19");
    await vault.backend.remove(notePath(5));
    await ensureIndex();
    expect(vault.reads() - before.reads).toBe(0);
    const paths = new Set(indexedFiles().map((f) => f.path));
    expect(paths.has("archive/19/n9999.md")).toBe(true);
    expect(paths.has(notePath(9999))).toBe(false);
    expect(paths.has(notePath(5))).toBe(false);
    expect(paths.size).toBe(N - 1);
    // The 500 moved notes are re-sent to the index without being re-read.
    expect((await indexStats()).indexed - before.indexed).toBe(500);
    expect((await searchWorkspace("word9999"))[0].path).toBe("archive/19/n9999.md");
  });

  it("a structural event re-lists once for the tree and the index, and re-reads only changed mtimes", async () => {
    notifyWorkspaceChanged(); // e.g. a folder created in the tree
    const tree = await workspaceTree();
    expect(tree.map((n) => n.name)).toEqual(["archive", "notes"]);
    const before = vault.reads();
    let lists = 0;
    const list = vault.backend.list;
    vault.backend.list = (dir) => {
      lists++;
      return list(dir);
    };
    await ensureIndex();
    expect(lists).toBe(0); // the tree's listing was reused
    expect(vault.reads() - before).toBe(0); // nothing changed on disk
    // The timed check for unannounced changes (another tab) lists afresh:
    // the tree's snapshot would hide them.
    await workspaceTree();
    lists = 0;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + REVALIDATE_MS + 1000);
    try {
      await ensureIndex();
    } finally {
      clock.mockRestore();
      vault.backend.list = list;
    }
    expect(lists).toBeGreaterThan(0);
  });

  it("falls back to an in-thread index when the worker dies, with the same results", async () => {
    worker.crashOnNext = true;
    const hits = await searchWorkspace("word4321");
    expect(hits[0].path).toBe(notePath(4321));
    expect((await indexStats()).engine).toBe("local");
  });
});

// ── The index core gives what the old full scan gave ───────────────────

const WIKI_RE = /\[\[([^\]\r\n|]+?)(?:\|[^\]\r\n]+?)?\]\]/g;
const base = (p: string) => p.split("/").filter(Boolean).pop() ?? "";

/** The scan src/storage/workspaceIndex.ts did on every query before plan 8.4. */
function scanBacklinks(files: IndexInput[], targetPath: string) {
  const wanted = noteKey(base(targetPath).replace(/\.md$/i, ""));
  const out: { fromPath: string; fromName: string; offset: number; snippet: string }[] = [];
  for (const file of files) {
    if (file.path === targetPath) continue;
    let m: RegExpExecArray | null;
    WIKI_RE.lastIndex = 0;
    while ((m = WIKI_RE.exec(file.content)) !== null) {
      const target = m[1].split("#")[0].trim();
      if (target && noteKey(base(target)) === wanted)
        out.push({ fromPath: file.path, fromName: file.name, offset: m.index, snippet: snippetAround(file.content, m.index) });
    }
  }
  return out;
}

function findIn(text: string, lower: string, q: string) {
  const at = lower.indexOf(q);
  if (at >= 0) return { start: at, end: at + q.length };
  return hasHebrew(q) ? hebrewFind(text, q) : null;
}

function scanSearch(files: IndexInput[], query: string, limit = 30) {
  const q = query.trim().toLowerCase();
  if (!q) return [...files].sort((a, b) => b.modified - a.modified).slice(0, limit).map((f) => ({ path: f.path, name: f.name, score: 0, snippet: null }));
  const out: { path: string; name: string; score: number; snippet: string | null; match?: { start: number; end: number } }[] = [];
  for (const file of files) {
    const nameLower = file.name.toLowerCase();
    const pathLower = file.path.toLowerCase();
    let score = 0;
    let snippet: string | null = null;
    let match: { start: number; end: number } | undefined;
    if (nameLower.includes(q)) score += 10;
    if (nameLower === q) score += 20;
    if (nameLower.startsWith(q)) score += 5;
    if (pathLower.includes(q) && pathLower !== nameLower) score += 6;
    const found = findIn(file.content, file.content.toLowerCase(), q);
    if (!nameLower.includes(q) && hasHebrew(q) && hebrewFind(file.name, q)) score += 10;
    if (found) {
      score += 4;
      const ctx = snippetAround(file.content, found.start, 80);
      const local = findIn(ctx, ctx.toLowerCase(), file.content.slice(found.start, found.end).replace(/\s+/g, " ").toLowerCase());
      snippet = ctx;
      if (local) match = local;
    } else if (fuzzyMatch(nameLower, q) || fuzzyMatch(pathLower, q)) score += 1;
    if (score > 0) out.push(match ? { path: file.path, name: file.name, score, snippet, match } : { path: file.path, name: file.name, score, snippet });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

describe("VaultIndex", () => {
  it("folds text exactly like normalizeWithMap", () => {
    for (const t of ["Hello World", "שָׁלוֹם עוֹלָם", "מלכים ךםןףץ", "café É", "אַוֹ", "צה״ל ׳", "mixed שלום ABC"]) {
      expect(foldForSearch(t)).toBe(normalizeWithMap(t).text);
    }
  });

  it("answers search and backlinks like the old scan, through edits", async () => {
    const random = rng(7);
    const pick = <T,>(a: T[]) => a[Math.floor(random() * a.length)];
    const words = ["alpha", "Beta", "שָׁלוֹם", "שלום", "הבית", "בַּיִת", "ספרים", "מלך", "עולם", "café", "note"];
    const make = (i: number): IndexInput => {
      const name = `${random() < 0.3 ? pick(words) : `n${i}`}.md`;
      let content = `# ${pick(words)} ${i}\n`;
      for (let k = 0; k < 4; k++) content += `${pick(words)} ${pick(words)} ${random() < 0.4 ? `[[${pick(words)}${random() < 0.3 ? "#h|x" : ""}]]` : ""}\n`;
      return { path: `d${i % 5}/${name}`, name, content, modified: Math.floor(random() * 1000) };
    };
    const files = new Map<string, IndexInput>();
    // Through the in-thread engine, as the facade uses it without a worker.
    const index = new VaultIndex();
    const engine = localEngine(index);
    for (let i = 0; i < 300; i++) {
      const f = make(i);
      files.set(f.path, f);
    }
    await engine.upsert([...files.values()]);
    const check = async () => {
      const all = [...files.values()];
      for (const q of ["alpha", "", " BETA ", "והבית", "שלום", "בית", "a", "zz", "d3/", "café", "שלום עולם", "note"]) {
        expect(await engine.search(q, { limit: 30 })).toEqual(scanSearch(all, q));
      }
      for (const t of ["d1/n1.md", "שלום.md", "x/עולם.md", "Beta.md"]) expect(await engine.backlinks(t)).toEqual(scanBacklinks(all, t));
    };
    await check();
    for (let r = 0; r < 150; r++) {
      const p = pick([...files.keys()]);
      if (random() < 0.2) {
        files.delete(p);
        await engine.remove([p]);
      } else {
        const f = { ...make(r + 400), path: p, name: base(p) };
        files.set(p, f);
        await engine.upsert([f]);
      }
    }
    await check();
  });
});

// ── Incremental outline and preview ────────────────────────────────────

const PIECES = [
  "# Head", "## Head", "para text", "- item", "- item\n\n  more", "1. one", "```js\ncode\n\n# not\n```", "~~~\n\n~~~",
  "<!--\n\n# hidden\n\n-->", "$$\nx\n\n$$", ":::note\n\n# in\n\n:::", "<div>\n\n# d\n\n</div>", "    indented", "> quote",
  "Setext\n===", "[ref]: http://x", "# [ref] link", "---", "| a | b |\n|---|---|\n| 1 | 2 |", "- a\n  ```\n  x\n\n  # in\n  ```\n- b",
  "1. x\n\n   <!--\n\n# h\n", "<span>\n```\n\n# s\n", "para\n<span>\n```\n\n# p\n```", "# crlf\r\n\r\ntext\r\n", " - item\n\n # x",
];
const INSERTS = ["\n\n", "```", "\n```\n", "# ", "x", "<!--", "-->", "[ref]: u\n", "- ", "    ", "\n", "<div>", "\r\n", "<span>"];

function randomDoc(random: () => number): string {
  let s = "";
  const n = 5 + Math.floor(random() * 20);
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(random() * PIECES.length)] + ["\n\n", "\n", "\n\n\n"][Math.floor(random() * 3)];
  return s;
}

function edit(text: string, random: () => number): string {
  const pos = Math.floor(random() * (text.length + 1));
  if (random() < 0.35) return text.slice(0, pos) + text.slice(Math.min(text.length, pos + 1 + Math.floor(random() * 8)));
  return text.slice(0, pos) + INSERTS[Math.floor(random() * INSERTS.length)] + text.slice(pos);
}

describe("blocks and the incremental outline", () => {
  it("re-scans to the same blocks, and the outline equals extractToc, through random edits", () => {
    const random = rng(2024);
    for (let d = 0; d < 60; d++) {
      for (const preview of [false, true]) {
        let text = randomDoc(random);
        const tracker = new BlockTracker({ preview });
        const toc = new IncrementalToc();
        for (let e = 0; e < 15; e++) {
          const { blocks } = tracker.update(text);
          expect(blocks).toEqual(splitBlocks(text, { preview }).blocks);
          // The blocks tile the text.
          expect(blocks.map((b) => text.slice(b.start, b.end)).join("")).toBe(text);
          if (!preview) expect(toc.update(text)).toEqual(extractToc(text));
          text = edit(text, random);
        }
      }
    }
  });

  it("autolinks and code spans are not open HTML elements: preview blocks still split after them", () => {
    const doc = "See <https://example.com>, <a@b.co> and `<div>`.\n\n# Next\n\n<div>\n\nin\n\n</div>\n\nText\n";
    expect(splitBlocks(doc, { preview: true }).blocks.map((b) => doc.slice(b.start, b.end))).toEqual([
      "See <https://example.com>, <a@b.co> and `<div>`.\n\n",
      "# Next\n\n",
      "<div>\n\nin\n\n</div>\n\n",
      "Text\n",
    ]);
  });

  it("an HTML comment is opaque: a tag inside it opens nothing", () => {
    const doc = "<!--\n<div>\n-->\n\n# Next\n\nText\n";
    expect(splitBlocks(doc, { preview: true }).blocks.map((b) => doc.slice(b.start, b.end))).toEqual([
      "<!--\n<div>\n-->\n\n",
      "# Next\n\n",
      "Text\n",
    ]);
  });

  it("an opening tag spread over lines keeps its element in one preview block", () => {
    const doc = '<div\nclass="note">\n\nInside\n\n</div>\n\nAfter\n';
    expect(splitBlocks(doc, { preview: true }).blocks.map((b) => doc.slice(b.start, b.end))).toEqual([
      '<div\nclass="note">\n\nInside\n\n</div>\n\n',
      "After\n",
    ]);
  });

  it("a keystroke in a long document re-parses one block, not the document", () => {
    let doc = "";
    for (let i = 0; i < 3000; i++) doc += `## Section ${i}\n\nSome text for section ${i}.\n\n`;
    const toc = new IncrementalToc();
    expect(toc.update(doc)).toHaveLength(3000);
    const parsed = toc.parsed;
    const at = doc.indexOf("Some text for section 1500");
    doc = doc.slice(0, at) + "X" + doc.slice(at);
    expect(toc.update(doc)).toEqual(extractToc(doc));
    expect(toc.parsed - parsed).toBe(1);
    // A changed heading still numbers its repeats over the whole document.
    doc = doc.replace("## Section 2999", "## Section 1");
    expect(toc.update(doc)).toEqual(extractToc(doc));
  });

  it("a fence opened mid-document swallows the rest; a definition change re-parses [bracket] headings", () => {
    let doc = "# A\n\ntext\n\n# B [x]\n\nmore\n\n# C\n\n";
    const toc = new IncrementalToc();
    toc.update(doc);
    doc = doc.replace("text", "```\ntext");
    expect(toc.update(doc)).toEqual(extractToc(doc));
    expect(toc.update(doc).map((h) => h.text)).toEqual(["A"]);
    doc = doc.replace("```\ntext", "text");
    expect(toc.update(doc).map((h) => h.text)).toEqual(["A", "B [x]", "C"]);
    const parsed = toc.parsed;
    doc += "[x]: https://example.com\n";
    expect(toc.update(doc)).toEqual(extractToc(doc));
    expect(toc.update(doc).map((h) => h.text)).toContain("B x");
    // Only the new block and the one heading with a bracket were parsed again.
    expect(toc.parsed - parsed).toBe(2);
  });
});

describe("the block-by-block preview", () => {
  const html = (el: ReactElement | null) => renderToStaticMarkup(el!).replace(/>\s+</g, "><").trim();

  it("renders what the full pipeline renders, then only the changed block", async () => {
    const doc = [
      "# Title",
      "Intro with a [[Wiki Link]] and **bold**.",
      "## Repeat",
      "- loose item\n\n- second item\n\n  continued",
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "> a quote",
      ":::note\nA callout.\n:::",
      "## Repeat",
      "Last paragraph.",
    ].join("\n\n");
    expect(canRenderInBlocks(doc)).toBe(true);
    const preview = new IncrementalPreview();
    const first = await preview.render(doc, () => false);
    expect(html(first)).toBe(html(await renderMarkdown(doc, () => false)));
    // Repeated headings are numbered across blocks, as in the full render.
    expect(html(first)).toContain('id="repeat-1"');
    const rendered = preview.rendered;
    const edited = doc.replace("Last paragraph.", "Last paragraph, edited.");
    const second = await preview.render(edited, () => false);
    expect(preview.rendered - rendered).toBe(1);
    expect(html(second)).toBe(html(await renderMarkdown(edited, () => false)));
  });

  it("leaves footnotes, reference definitions and CriticMarkup to the full pipeline", () => {
    expect(canRenderInBlocks("Text[^1]\n\n[^1]: note")).toBe(false);
    expect(canRenderInBlocks("[x]\n\n[x]: https://example.com")).toBe(false);
    expect(canRenderInBlocks("a {++b++} c")).toBe(false);
    // …but not when they are only examples in code.
    expect(canRenderInBlocks("Use `[^1]` and `{++x++}`.\n\n```md\n[x]: https://example.com\nText[^1]\n```\n")).toBe(true);
    expect(withoutCode("a `b` c\n```\nd\n```\ne")).toBe("a  c\ne");
    // A code span may cross a line, not a paragraph.
    expect(withoutCode("a `x\n[^1] y` b")).toBe("a  b");
    expect(withoutCode("a `x\n\n[^1] y` b")).toBe("a `x\n\n[^1] y` b");
  });

  it("stops when a newer text is on its way", async () => {
    const preview = new IncrementalPreview();
    let doc = "";
    for (let i = 0; i < 400; i++) doc += `## S${i}\n\nText ${i}.\n\n`;
    expect(await preview.render(doc, () => false, () => true)).toBeNull();
  });
});

describe("the file tree of a large vault", () => {
  it("a flat vault: the first rows of a folder and the active note — not 10,000 rows", () => {
    const nodes: WorkspaceNode[] = [
      { path: "a", name: "a", kind: "directory", children: [] },
      ...Array.from({ length: N }, (_, i): WorkspaceNode => ({ path: `n${i}.md`, name: `n${i}.md`, kind: "file" })),
    ];
    const { shown, hidden } = visibleChildren(nodes, LARGE_VAULT_FOLDER_ROWS, "n9000.md");
    expect(shown.map((n) => n.path)).toEqual([
      "a",
      ...Array.from({ length: LARGE_VAULT_FOLDER_ROWS - 1 }, (_, i) => `n${i}.md`),
      "n9000.md",
    ]);
    expect(hidden).toBe(nodes.length - LARGE_VAULT_FOLDER_ROWS - 1);
    expect(visibleChildren(nodes, null, null)).toEqual({ shown: nodes, hidden: 0 });
  });

  it("a wide vault: 10,000 folders are limited too, the active note's folder kept", () => {
    const nodes = Array.from({ length: N }, (_, i): WorkspaceNode => ({ path: `d${i}`, name: `d${i}`, kind: "directory", children: [] }));
    const { shown, hidden } = visibleChildren(nodes, LARGE_VAULT_FOLDER_ROWS, "d5000/x.md");
    expect(shown).toHaveLength(LARGE_VAULT_FOLDER_ROWS + 1);
    expect(shown[shown.length - 1].path).toBe("d5000");
    expect(hidden).toBe(N - LARGE_VAULT_FOLDER_ROWS - 1);
  });
});

describe("semantic vectors packed per file", () => {
  const cosine = (a: Float32Array, b: Float32Array) => {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const d = Math.sqrt(na) * Math.sqrt(nb);
    return d === 0 ? 0 : dot / d;
  };

  it("one Float32Array per file scores like per-chunk cosine", () => {
    const random = rng(5);
    const vecs = Array.from({ length: 12 }, () => Float32Array.from({ length: 64 }, () => random() - 0.5));
    const packed = packVectors(vecs)!;
    expect(packed.data).toBeInstanceOf(Float32Array);
    expect(packed.data.length).toBe(12 * 64);
    const q = Float32Array.from({ length: 64 }, () => random() - 0.5);
    const scores = vecs.map((v) => cosine(q, v));
    const best = scores.indexOf(Math.max(...scores));
    expect(bestChunk(q, packed)).toEqual({ index: best, score: scores[best] });
    expect(bestChunk(new Float32Array(3), packed)).toEqual({ index: 0, score: 0 });
    expect(packVectors([new Float32Array(2), new Float32Array(3)])).toBeNull();
  });
});
