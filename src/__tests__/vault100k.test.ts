/**
 * W2.22 / W10.E17 — the synthetic large vault: "open < 2 s" measured as the
 * open from the stored snapshot (not the build), and 5 GB of attachments
 * that are sparse, so they cost no disk and no write time. Here the vault is
 * small; the 100,000-note number is `npm run perf:vault100k`'s, on the Mac.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureOpen, OPEN_LIMIT_MS, treeOf } from "../../scripts/perf/vaultOpen";
// @ts-expect-error — plain .mjs module without type declarations
import { makeSparseAttachments } from "../../scripts/perf/sparseAttachments.mjs";

// A synthetic vault (made up for this test): 3,000 notes in 30 folders, Hebrew and English, with tags and links.
const files = Array.from({ length: 3000 }, (_, i) => ({
  path: `f${i % 30}/note-${i}.md`,
  name: `note-${i}.md`,
  modified: i + 1,
  content: `---\ntags: [t${i % 7}]\n---\n# פתק ${i}\n\nשלום עולם, a note with [[note-${(i * 7) % 3000}]] #tag${i % 5}\n`,
}));

describe("open from the snapshot (W10.E17)", () => {
  it("measures the open on its own: read, decode, summaries and the tree, then the deferred index fill", () => {
    let clock = 0;
    const ticks: number[] = [];
    // A fake clock that advances 1 ms per reading: the phases are the reads between the marks.
    const r = measureOpen(files, "f7/note-7.md", () => (ticks.push(clock), clock++));
    expect(r.notes).toBe(3000);
    expect(ticks).toHaveLength(6);
    expect(r.openMs).toBe(4);
    expect(r.indexMs).toBe(1);
    expect(r.phases).toEqual({ readMs: 1, decodeMs: 1, summariesMs: 1, treeMs: 1 });
    // Large-vault view: folders collapsed except the active note's.
    expect(r.rows).toBe(30 + 100);
  });

  it("is under the limit with a real clock (3,000 notes; the 100,000 number is the nightly's)", () => {
    const r = measureOpen(files, null);
    expect(r.rows).toBe(30);
    expect(r.openMs).toBeLessThan(OPEN_LIMIT_MS);
    expect(OPEN_LIMIT_MS).toBe(2000);
  });

  it("the tree is the listing's: folders first, then files, by name", () => {
    expect(JSON.stringify(treeOf(["b.md", "a/z.md", "a/c/y.md", "a.md"]).map((n) => [n.path, n.children?.map((c) => c.path) ?? null]))).toBe(
      JSON.stringify([["a", ["a/c", "a/z.md"]], ["a.md", null], ["b.md", null]]),
    );
  });

  it("the perf script asserts the open, not the build", () => {
    const src = readFileSync(join(__dirname, "../../scripts/perf/vault-100k.ts"), "utf8");
    expect(src).toMatch(/openMs: OPEN_LIMIT_MS/);
    expect(src).toMatch(/open\.openMs > LIMITS\.openMs/);
  });
});

describe("sparse attachments (W10.E17)", () => {
  it("makes the apparent size without writing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-sparse-"));
    try {
      const total = 512 * 1024 * 1024; // 512 MB apparent; the nightly asks for 5 GB the same way
      const r = makeSparseAttachments(dir, total, 30);
      expect(r.files).toHaveLength(30);
      expect(r.apparentBytes).toBe(total);
      // Sparse: what the disk allocated is a tiny fraction (a block or two per file for the magic bytes).
      expect(r.allocatedBytes).toBeLessThan(total / 100);
      expect(readFileSync(r.files[0]).subarray(0, 8).toString("latin1")).toBe("%PDF-1.7");
      expect(statSync(r.files[1]).size).toBe(Math.floor(total / 30));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
